import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { OutboxResult } from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { Identity } from "spacetimedb"
import { IdcFixtureInbox, refusedNote } from "../fixtures/idc/inbox"
import { IdcReceiverModule } from "../fixtures/idc/receiver/contract"
import { IdcFixtureInboxLive } from "../fixtures/idc/receiver/live"
import { IdcSenderModule } from "../fixtures/idc/sender/contract"
import {
  IdcSenderSendsLive,
  IdcSenderSettlesLive,
} from "../fixtures/idc/sender/live"

const { describe, expect, it } = EffectVitest

class GateRefusalDefect extends Data.TaggedError("GateRefusalDefect") {}

const senderIdentity = new Identity(0x5e4dn)
const receiverIdentity = new Identity(0x4ecen)
const strangerIdentity = new Identity(0x0dd0n)

const makeSender = () => ({
  module: IdcSenderModule.spec,
  harness: StdbTesting.makeTestModuleHarness(IdcSenderModule.spec, {
    databaseIdentity: senderIdentity,
    environment: { IDC_FIXTURE_PEER: receiverIdentity.toHexString() },
  }),
  callables: StdbTesting.bindCallables(IdcSenderModule, [
    IdcSenderSendsLive,
    IdcSenderSettlesLive,
  ]),
})

const makeReceiver = (trusted: Identity) => ({
  module: IdcReceiverModule.spec,
  harness: StdbTesting.makeTestModuleHarness(IdcReceiverModule.spec, {
    databaseIdentity: receiverIdentity,
    environment: { IDC_FIXTURE_TRUSTED_PEER: trusted.toHexString() },
  }),
  callables: StdbTesting.bindCallables(IdcReceiverModule, [
    IdcFixtureInboxLive,
  ]),
})

const makeWorld = (options: { readonly trusted?: Identity } = {}) => {
  const sender = makeSender()
  const receiver = makeReceiver(options.trusted ?? senderIdentity)
  const pump = StdbTesting.makeIdcPump({
    links: [{ sender, receivers: [receiver] }],
  })
  const send = (name: "sendPing" | "sendDetails", args: unknown): void => {
    sender.callables[name]?.invoke(sender.harness.makeMutationCtx(), args)
  }
  const settlements = () =>
    [...sender.harness.db.settlement.iter()].map((row) => ({
      outbox: row.outbox,
      requestId: row.requestId,
      outcome: row.outcome,
    }))
  const pings = () =>
    [...receiver.harness.db.pingLog.iter()].map((row) => ({
      note: row.note,
      sender: row.sender.toHexString(),
      labels: row.labels,
    }))
  return { sender, receiver, pump, send, settlements, pings }
}

describe("in-memory inter-database pump", () => {
  it("delivers a row as the sending database and settles it Delivered", () => {
    const world = makeWorld()
    world.send("sendPing", { note: "hello", requestId: "r1" })

    const [pending] = world.pump.pending("pingOutbox")
    expect(pending).toMatchObject({ note: "hello", requestId: "r1" })

    const delivery = world.pump.deliverNext("pingOutbox")

    expect(delivery).toMatchObject({
      _tag: "Settled",
      outbox: "pingOutbox",
      result: OutboxResult.Delivered(),
    })
    expect(world.pings()).toEqual([
      { note: "hello", sender: senderIdentity.toHexString(), labels: [] },
    ])
    expect(world.settlements()).toEqual([
      { outbox: "pingOutbox", requestId: "r1", outcome: "delivered" },
    ])
    expect(world.pump.pending("pingOutbox")).toEqual([])
  })

  it("settles a receiver's refusal as Refused and rolls the receiver back", () => {
    const world = makeWorld()
    world.send("sendPing", { note: refusedNote, requestId: "r1" })

    const delivery = world.pump.deliverNext("pingOutbox")

    expect(delivery).toMatchObject({
      _tag: "Settled",
      result: { _tag: "Refused" },
    })
    expect(world.pings()).toEqual([])
    const [settled] = world.settlements()
    expect(settled?.outcome).toContain("refused: ")
    expect(settled?.outcome).toContain("FixtureRejected")
    expect(world.pump.pending("pingOutbox")).toEqual([])
  })

  it("refuses a database the receiver's guard does not trust", () => {
    const world = makeWorld({ trusted: strangerIdentity })
    world.send("sendPing", { note: "hello", requestId: "r1" })

    world.pump.deliverNext("pingOutbox")

    expect(world.pings()).toEqual([])
    expect(world.settlements()[0]?.outcome).toContain("FixtureUnknownPeer")
  })

  it("delivers one stream in insert order and lets the test interleave streams", () => {
    const world = makeWorld()
    world.send("sendPing", { note: "first", requestId: "r1" })
    world.send("sendDetails", { body: "details", labels: ["x"] })
    world.send("sendPing", { note: "second", requestId: "r2" })

    // The details stream goes first although its row is not the oldest.
    world.pump.deliverNext("detailsOutbox", receiverIdentity)
    world.pump.deliverNext("pingOutbox", receiverIdentity)
    world.pump.deliverNext("pingOutbox", receiverIdentity)

    expect(world.pings().map((ping) => ping.note)).toEqual([
      "details",
      "first",
      "second",
    ])
    expect(world.pings()[0]?.labels).toEqual(["x"])
    expect(world.settlements().map((row) => row.requestId)).toEqual([
      "",
      "r1",
      "r2",
    ])
  })

  it("drains every outbox oldest first within its bound", () => {
    const world = makeWorld()
    world.send("sendPing", { note: "first", requestId: "r1" })
    world.send("sendPing", { note: "second", requestId: "r2" })

    expect(() => world.pump.drain({ deliveriesMax: 1 })).toThrow(RangeError)
    expect(world.pump.drain({ deliveriesMax: 4 })).toHaveLength(1)
    expect(world.pings().map((ping) => ping.note)).toEqual(["first", "second"])
  })

  it("records calls to a stand-in receiver and settles with its answer", () => {
    const sender = makeSender()
    const recorder = StdbTesting.IdcPump.recording({
      databaseIdentity: receiverIdentity,
      answer: () => OutboxResult.Refused({ message: "not today" }),
    })
    const pump = StdbTesting.makeIdcPump({
      links: [{ sender, receivers: [recorder] }],
    })
    sender.callables.sendPing?.invoke(sender.harness.makeMutationCtx(), {
      note: "hello",
      requestId: "r1",
    })

    pump.deliverNext("pingOutbox")

    // Only the receiver's parameters travel; local columns stay behind.
    expect(recorder.calls).toEqual([
      {
        sender: senderIdentity,
        outbox: "pingOutbox",
        reducer: "receive_ping",
        args: { note: "hello" },
      },
    ])
    expect(
      [...sender.harness.db.settlement.iter()].map((row) => row.outcome),
    ).toEqual(["refused: not today"])
  })

  it("leaves a row at its stream's head when the receiver refuses the connection", () => {
    const GatedReceiverModule = Stdb.StdbModule.make("idc_gated_receiver", {
      lifecycle: { clientConnected: Stdb.StdbFn.clientConnected() },
      environment: { IDC_FIXTURE_TRUSTED_PEER: Stdb.Environment.string() },
    }).add(IdcFixtureInbox)
    const GatedInboxLive = Stdb.StdbBuilder.group(
      GatedReceiverModule,
      "IdcFixtureInbox",
      {
        receivePing: () => Effect.void,
        receiveDetails: () => Effect.void,
      },
      { middleware: { reducers: Effect.void } },
    )
    const GatedLifecycleLive = Stdb.StdbBuilder.lifecycle(GatedReceiverModule, {
      clientConnected: () => Effect.die(new GateRefusalDefect()),
    })
    const sender = makeSender()
    const receiver = {
      module: GatedReceiverModule.spec,
      harness: StdbTesting.makeTestModuleHarness(GatedReceiverModule.spec, {
        databaseIdentity: receiverIdentity,
        environment: { IDC_FIXTURE_TRUSTED_PEER: senderIdentity.toHexString() },
      }),
      callables: StdbTesting.bindCallables(
        Stdb.StdbBuilder.plan(GatedReceiverModule, [
          GatedInboxLive,
          GatedLifecycleLive,
        ]),
      ),
    }
    const pump = StdbTesting.makeIdcPump({
      links: [{ sender, receivers: [receiver] }],
    })
    sender.callables.sendPing?.invoke(sender.harness.makeMutationCtx(), {
      note: "hello",
      requestId: "r1",
    })

    const delivery = pump.deliverNext("pingOutbox")

    expect(delivery._tag).toBe("ConnectionRefused")
    expect(pump.pending("pingOutbox")).toHaveLength(1)
    expect([...sender.harness.db.settlement.iter()]).toEqual([])
  })
})
