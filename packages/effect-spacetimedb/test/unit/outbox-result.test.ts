import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stdb from "effect-spacetimedb"
import { databaseCaller, OutboxResult } from "effect-spacetimedb/server"
import { build } from "effect-spacetimedb/server-compiler"
import * as StdbTesting from "effect-spacetimedb/testing"
import { Identity } from "spacetimedb"
import { outboxResultFromHost } from "../../src/contract/outbox-result"
import { IdcFixtureInboxBinding } from "../fixtures/idc/binding"
import { IdcSenderModule } from "../fixtures/idc/sender/contract"
import {
  IdcSenderSendsLive,
  IdcSenderSettlesLive,
} from "../fixtures/idc/sender/live"
import { invokeModuleExport } from "../helpers/spacetimedb-server"

const { describe, expect, it } = EffectVitest

const receiverIdentity = new Identity(0x4ecen)

/** A sender harness with one pending ping, and that ping's raw host row. */
const withPendingPing = () => {
  const harness = StdbTesting.makeTestModuleHarness(IdcSenderModule.spec, {
    databaseIdentity: new Identity(0x5e4dn),
    environment: { IDC_FIXTURE_PEER: receiverIdentity.toHexString() },
  })
  const callables = StdbTesting.bindCallables(IdcSenderModule, [
    IdcSenderSendsLive,
    IdcSenderSettlesLive,
  ])
  callables.sendPing?.invoke(harness.makeMutationCtx(), {
    note: "hello",
    requestId: "r1",
  })
  const [rawRow] = [...harness.db.pingOutbox.iter()]
  const [row] = harness.outboxRows("pingOutbox")
  return { harness, callables, rawRow, row }
}

const outcomes = (harness: ReturnType<typeof withPendingPing>["harness"]) =>
  [...harness.db.settlement.iter()].map((row) => row.outcome)

const hostSettleAuth = { isInternal: false, hasJWT: false, jwt: null } as const

describe("outbox results", () => {
  it("reads the host's Result<(), String> as Delivered or Refused", () => {
    expect(outboxResultFromHost({ ok: {} })).toEqual(OutboxResult.Delivered())
    expect(outboxResultFromHost({ err: "rejected" })).toEqual(
      OutboxResult.Refused({ message: "rejected" }),
    )
    expect(() => outboxResultFromHost({ neither: true })).toThrow()
    expect(() => outboxResultFromHost({ err: 7 })).toThrow()
  })

  it("runs a compiled settle reducer only as the zero identity", () => {
    const { harness, rawRow } = withPendingPing()
    const compiled = build(
      IdcSenderModule,
      [IdcSenderSendsLive, IdcSenderSettlesLive],
      {
        runtimeMode: "dev-guarded",
        receiverBindings: [IdcFixtureInboxBinding],
      },
    )
    const settle = compiled.exports.ping_settled

    expect(() =>
      invokeModuleExport(
        settle,
        harness.makeMutationCtx({ senderAuth: hostSettleAuth }),
        { row: rawRow, result: { ok: {} } },
      ),
    ).toThrow("only invocable by the host settling its outbox")
    expect(() =>
      invokeModuleExport(
        settle,
        harness.makeMutationCtx({
          sender: harness.databaseIdentity,
          senderAuth: { isInternal: true, hasJWT: false, jwt: null },
        }),
        { row: rawRow, result: { ok: {} } },
      ),
    ).toThrow("only invocable by the host settling its outbox")
    expect(outcomes(harness)).toEqual([])

    invokeModuleExport(
      settle,
      harness.makeMutationCtx({
        sender: Identity.zero(),
        senderAuth: hostSettleAuth,
      }),
      { row: rawRow, result: { ok: {} } },
    )
    invokeModuleExport(
      settle,
      harness.makeMutationCtx({
        sender: Identity.zero(),
        senderAuth: hostSettleAuth,
      }),
      { row: rawRow, result: { err: "rejected" } },
    )
    expect(outcomes(harness)).toEqual(["delivered", "refused: rejected"])
  })

  it("refuses a bound settle reducer called by anyone but the host", () => {
    const { harness, callables, row } = withPendingPing()
    const settle = callables.pingSettled

    expect(() =>
      settle?.invoke(harness.makeMutationCtx(), {
        row,
        result: OutboxResult.Delivered(),
      }),
    ).toThrow("only invocable by the host settling its outbox")
    settle?.invoke(
      harness.makeMutationCtx({
        sender: Identity.zero(),
        senderAuth: hostSettleAuth,
      }),
      { row, result: OutboxResult.Delivered() },
    )
    expect(outcomes(harness)).toEqual(["delivered"])
  })

  it("settles as the host behind reducer middleware its group keeps for other callers", () => {
    const { harness, row } = withPendingPing()
    // The group's reducer middleware refuses every caller, as a player guard
    // would refuse the host's tokenless zero identity.
    const guardedSettles = Stdb.StdbBuilder.group(
      IdcSenderModule,
      "IdcSenderSettles",
      {
        pingSettled: ({ row: settledRow }) =>
          Effect.gen(function* () {
            const db = yield* IdcSenderModule.Db
            yield* db.settlement.insert({
              id: 0n,
              outbox: "pingOutbox",
              msgId: settledRow.msgId,
              requestId: settledRow.requestId,
              outcome: "settled behind middleware",
            })
          }).pipe(Effect.orDie),
        detailsSettled: () => Effect.void,
      },
      { middleware: { reducers: Effect.die("players only") } },
    )
    const callables = StdbTesting.bindCallables(IdcSenderModule, [
      IdcSenderSendsLive,
      guardedSettles,
    ])
    callables.pingSettled?.invoke(
      harness.makeMutationCtx({
        sender: Identity.zero(),
        senderAuth: hostSettleAuth,
      }),
      { row, result: OutboxResult.Delivered() },
    )
    expect(outcomes(harness)).toEqual(["settled behind middleware"])
    // Anyone else still meets the settle reducer's own host check.
    expect(() =>
      callables.pingSettled?.invoke(harness.makeMutationCtx(), {
        row,
        result: OutboxResult.Delivered(),
      }),
    ).toThrow("only invocable by the host settling its outbox")
  })

  it("names the calling database only for a call without a JWT from elsewhere", () => {
    const sender = new Identity(0x5e4dn)
    expect(
      databaseCaller({
        sender,
        senderAuth: { isInternal: false, hasJWT: false, jwt: null },
      }),
    ).toEqual(Option.some(sender))
    expect(
      databaseCaller({
        sender,
        senderAuth: { isInternal: true, hasJWT: false, jwt: null },
      }),
    ).toEqual(Option.none())
    expect(
      databaseCaller({
        sender,
        senderAuth: {
          isInternal: false,
          hasJWT: true,
          jwt: {
            rawPayload: "{}",
            subject: "player",
            issuer: "issuer",
            audience: [],
            identity: sender,
            fullPayload: {},
          },
        },
      }),
    ).toEqual(Option.none())
  })

  it("keeps settle reducers out of the client-callable surface", () => {
    expect(IdcSenderModule.spec.reducers.pingSettled.public).toBe(false)
    expect(Stdb.validate(IdcSenderModule.spec)).toEqual([])
  })
})
