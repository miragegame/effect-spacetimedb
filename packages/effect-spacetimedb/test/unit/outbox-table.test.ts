import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Stdb from "effect-spacetimedb"
import {
  OutboxRowTooLarge,
  OutboxSelfTargetDefect,
  OutboxSendOutsideMutationDefect,
} from "effect-spacetimedb/server"
import { build } from "effect-spacetimedb/server-compiler"
import * as StdbTesting from "effect-spacetimedb/testing"
import { Identity } from "spacetimedb"
import { IdcFixtureInboxBinding } from "../fixtures/idc/binding"
import { IdcFixtureInbox } from "../fixtures/idc/inbox"
import { IdcFixtureInboxInterface } from "../fixtures/idc/interface"
import { IdcReceiverModule } from "../fixtures/idc/receiver/contract"
import idcFixtureInboxBinding from "../fixtures/idc/remote/idc_fixture_inbox/index.js"
import { IdcFixtureInboxLive } from "../fixtures/idc/receiver/live"
import {
  detailsOutbox,
  IdcSenderModule,
  pingOutbox,
  pingOutboxRowBytesMax,
} from "../fixtures/idc/sender/contract"
import {
  IdcSenderSendsLive,
  IdcSenderSettlesLive,
} from "../fixtures/idc/sender/live"
import {
  type TestOutboxDef,
  registerCompiledModule,
} from "../helpers/spacetimedb-server"

const { describe, expect, it } = EffectVitest

const receiverIdentity = new Identity(0x4ecen)
const peer = Stdb.RemoteInterface.peer(
  IdcFixtureInboxInterface,
  receiverIdentity,
)

const makeSender = () => {
  const harness = StdbTesting.makeTestModuleHarness(IdcSenderModule.spec, {
    databaseIdentity: new Identity(0x5e4dn),
    environment: { IDC_FIXTURE_PEER: receiverIdentity.toHexString() },
  })
  const callables = StdbTesting.bindCallables(IdcSenderModule, [
    IdcSenderSendsLive,
    IdcSenderSettlesLive,
  ])
  return { harness, callables }
}

const diagnosticsOf = (
  run: () => unknown,
): ReadonlyArray<{
  readonly code: string
  readonly path: ReadonlyArray<string | number>
}> => {
  try {
    run()
  } catch (cause) {
    if (cause instanceof Stdb.StdbValidationError) {
      return cause.diagnostics.map(({ code, path }) => ({ code, path }))
    }
    throw cause
  }
  return []
}

const settleGroupFor = (table: Stdb.AnyOutboxTableSpec, name: string) =>
  Stdb.StdbGroup.make(`${name}Settles`).add(
    Stdb.StdbFn.outboxResult(`${name}Settled`, { table }),
  )

describe("outbox tables", () => {
  it("lays out metadata, receiver parameters, local columns and the stream index", () => {
    expect(Object.keys(pingOutbox.columns)).toEqual([
      "msgId",
      "target",
      "note",
      "requestId",
      "enqueuedAt",
    ])
    expect(pingOutbox.public).toBe(false)
    expect(pingOutbox.indexes).toContainEqual({
      name: Stdb.outboxTargetIndexName,
      algorithm: "btree",
      columns: ["target", "msgId"],
    })
    expect(pingOutbox.outbox.reducer).toBe("receivePing")
    expect(pingOutbox.outbox.rowBytesMax).toBe(pingOutboxRowBytesMax)
    expect(detailsOutbox.outbox.rowBytesMax).toBe(Stdb.outboxRowBytesMaxDefault)
  })

  it("refuses local columns named like metadata or receiver parameters", () => {
    // Untyped on purpose: the typed signature already rejects these columns.
    const outboxTableUntyped = Stdb.outboxTable as unknown as (
      name: string,
      options: object,
    ) => unknown
    const declare = (columns: Record<string, Stdb.AnyValueType>) => () =>
      outboxTableUntyped("collidingOutbox", {
        interface: IdcFixtureInboxInterface,
        reducer: "receivePing",
        columns,
      })

    expect(diagnosticsOf(declare({ msgId: Stdb.u64() }))).toEqual([
      {
        code: "InvalidOutboxTable",
        path: ["tables", "collidingOutbox", "columns", "msgId"],
      },
    ])
    expect(diagnosticsOf(declare({ note: Stdb.string() }))).toEqual([
      {
        code: "InvalidOutboxTable",
        path: ["tables", "collidingOutbox", "columns", "note"],
      },
    ])
    expect(
      diagnosticsOf(declare({ sentAt: Stdb.timestamp().name("enqueued_at") })),
    ).toEqual([
      {
        code: "InvalidOutboxTable",
        path: ["tables", "collidingOutbox", "columns", "sentAt"],
      },
    ])
    expect(
      diagnosticsOf(() =>
        Stdb.outboxTable("unknownReceiverOutbox", {
          interface: IdcFixtureInboxInterface,
          reducer: "receiveNothing" as never,
        }),
      ),
    ).toEqual([
      {
        code: "OutboxReceiverUnknown",
        path: ["tables", "unknownReceiverOutbox", "outbox", "reducer"],
      },
    ])
  })

  it("requires exactly one settle reducer and a bound within the ceiling", () => {
    const oversized = Stdb.outboxTable("oversizedOutbox", {
      interface: IdcFixtureInboxInterface,
      reducer: "receivePing",
      rowBytesMax: 2 * 1024 * 1024,
    })
    expect(
      diagnosticsOf(
        () =>
          Stdb.StdbModule.make("oversized_outbox", {})
            .addTables(oversized)
            .add(settleGroupFor(oversized, "oversized")).spec,
      ),
    ).toEqual([
      {
        code: "OutboxRowBytesMaxOutOfRange",
        path: ["tables", "oversizedOutbox", "outbox", "rowBytesMax"],
      },
    ])

    const unsettled = Stdb.outboxTable("unsettledOutbox", {
      interface: IdcFixtureInboxInterface,
      reducer: "receivePing",
    })
    expect(
      diagnosticsOf(
        () =>
          Stdb.StdbModule.make("unsettled_outbox", {}).addTables(unsettled)
            .spec,
      ),
    ).toEqual([
      {
        code: "OutboxWithoutResult",
        path: ["tables", "unsettledOutbox", "outbox"],
      },
    ])

    const twice = Stdb.outboxTable("twiceOutbox", {
      interface: IdcFixtureInboxInterface,
      reducer: "receivePing",
    })
    expect(
      diagnosticsOf(
        () =>
          Stdb.StdbModule.make("twice_settled", {})
            .addTables(twice)
            .add(settleGroupFor(twice, "first"))
            .add(settleGroupFor(twice, "second")).spec,
      ),
    ).toEqual([
      {
        code: "DuplicateOutboxResult",
        path: ["tables", "twiceOutbox", "outbox"],
      },
    ])

    const unregistered = Stdb.outboxTable("unregisteredOutbox", {
      interface: IdcFixtureInboxInterface,
      reducer: "receivePing",
    })
    expect(
      diagnosticsOf(
        () =>
          Stdb.StdbModule.make("unregistered_outbox", {}).add(
            settleGroupFor(unregistered, "unregistered"),
          ).spec,
      ),
    ).toEqual([
      {
        code: "InvalidOutboxResult",
        path: ["reducers", "unregisteredSettled", "outboxResult", "table"],
      },
    ])
  })

  it.effect(
    "fills msgId and the sending transaction's time and keeps local columns",
    () =>
      Effect.gen(function* () {
        const { harness, callables } = makeSender()
        callables.sendPing?.invoke(harness.makeMutationCtx(), {
          note: "hello",
          requestId: "r1",
        })
        const inserted = yield* harness.effectDb.pingOutbox.insert({
          target: peer,
          note: "again",
          requestId: "r2",
        })

        expect(inserted.msgId).toBe(2n)
        expect(harness.outboxRows("pingOutbox")).toMatchObject([
          {
            msgId: 1n,
            note: "hello",
            requestId: "r1",
            enqueuedAt: harness.makeMutationCtx().timestamp,
          },
          { msgId: 2n, note: "again", requestId: "r2" },
        ])
        expect(
          (yield* harness.effectDb.pingOutbox.byTarget.filterToArray({
            target: receiverIdentity,
          })).map((row) => row.note),
        ).toEqual(["hello", "again"])
      }),
  )

  it.effect("refuses a row over its bound and inserts nothing", () =>
    Effect.gen(function* () {
      const { harness, callables } = makeSender()
      const note = "x".repeat(pingOutboxRowBytesMax)

      const failure = yield* harness.effectDb.pingOutbox
        .insert({ target: peer, note, requestId: "r1" })
        .pipe(Effect.flip)

      expect(failure).toBeInstanceOf(OutboxRowTooLarge)
      expect(failure).toMatchObject({
        table: "pingOutbox",
        rowBytesMax: pingOutboxRowBytesMax,
      })
      expect(
        failure instanceof OutboxRowTooLarge ? failure.rowBytes : 0,
      ).toBeGreaterThan(pingOutboxRowBytesMax)
      // The fixture's sender refuses its own caller with a declared error.
      expect(() =>
        callables.sendPing?.invoke(harness.makeMutationCtx(), {
          note,
          requestId: "r2",
        }),
      ).toThrow("FixturePingTooLarge")
      expect(harness.outboxRows("pingOutbox")).toEqual([])
    }),
  )

  it.effect(
    "sizes a lone surrogate as the three bytes the host writes for it",
    () =>
      Effect.gen(function* () {
        const { harness } = makeSender()
        // 100 surrogate pairs: 400 bytes, within the bound.
        const pairs = "😀".repeat(100)
        yield* harness.effectDb.pingOutbox.insert({
          target: peer,
          note: pairs,
          requestId: "r1",
        })
        // The same 200 code units with no pair among them: each lone high
        // surrogate is written as U+FFFD, so 600 bytes, over the bound.
        const lone = "\ud800ࠀ".repeat(100)
        const failure = yield* harness.effectDb.pingOutbox
          .insert({ target: peer, note: lone, requestId: "r2" })
          .pipe(Effect.flip)
        expect(failure).toBeInstanceOf(OutboxRowTooLarge)
        expect(
          failure instanceof OutboxRowTooLarge ? failure.rowBytes : 0,
        ).toBeGreaterThan(pingOutboxRowBytesMax)
        expect(
          harness.outboxRows("pingOutbox").map((row) => row.requestId),
        ).toEqual(["r1"])
      }),
  )

  it.effect("dies on a row addressed to the sending database itself", () =>
    Effect.gen(function* () {
      const { harness } = makeSender()
      const self = Stdb.RemoteInterface.peer(
        IdcFixtureInboxInterface,
        harness.databaseIdentity,
      )

      const exit = yield* harness.effectDb.pingOutbox
        .insert({ target: self, note: "loop", requestId: "r1" })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit) && Exit.hasDies(exit)).toBe(true)
      expect(JSON.stringify(exit)).toContain(
        new OutboxSelfTargetDefect({ table: "", target: "" })._tag,
      )
      expect(harness.outboxRows("pingOutbox")).toEqual([])
    }),
  )

  it.effect(
    "dies when sent from outside a reducer or procedure transaction",
    () =>
      Effect.gen(function* () {
        const { harness } = makeSender()
        // An HTTP handler's transaction gets a handle without a send context.
        const db = StdbTesting.makeDbHandleFactory(
          IdcSenderModule.spec,
        ).readwrite(harness.db as never)

        const exit = yield* db.pingOutbox
          .insert({ target: peer, note: "hello", requestId: "r1" })
          .pipe(Effect.exit)

        expect(Exit.isFailure(exit) && Exit.hasDies(exit)).toBe(true)
        expect(JSON.stringify(exit)).toContain(
          new OutboxSendOutsideMutationDefect({ table: "" })._tag,
        )
      }),
  )

  it("offers no update, delete or clear, in either handle", () => {
    const { harness } = makeSender()

    expect(Object.keys(harness.effectDb.pingOutbox).sort()).toEqual([
      "byTarget",
      "count",
      "first",
      "insert",
      "msgId",
      "stream",
      "toArray",
      "unsafe",
    ])
    expect(Object.keys(harness.effectDb.pingOutbox.msgId).sort()).toEqual([
      "exists",
      "find",
      "findOrFail",
    ])
    expect("delete" in harness.db.pingOutbox).toBe(false)
    expect("clear" in harness.db.pingOutbox).toBe(false)
  })

  it("sends receiver parameters under the binding's variant names", () => {
    const { harness, callables } = makeSender()
    callables.sendDetails?.invoke(harness.makeMutationCtx(), {
      body: "with details",
      labels: ["a"],
    })

    const [raw] = [...harness.db.detailsOutbox.iter()]
    expect(raw?.details).toEqual({ labels: ["a"], state: { tag: "Ready" } })
    expect(harness.outboxRows("detailsOutbox")[0]?.details).toEqual({
      labels: ["a"],
      state: "ready",
    })
  })

  it("compiles each outbox against its receiver and registers its settle reducer", () => {
    const sender = build(
      IdcSenderModule,
      [IdcSenderSendsLive, IdcSenderSettlesLive],
      {
        runtimeMode: "dev-guarded",
        receiverBindings: [IdcFixtureInboxBinding],
      },
    )
    registerCompiledModule(sender.schema, sender.exportGroup())
    const receiver = build(IdcReceiverModule, [IdcFixtureInboxLive], {
      runtimeMode: "dev-guarded",
    })
    registerCompiledModule(receiver.schema, receiver.exportGroup())

    const outboxes = (
      sender.schema as {
        readonly moduleDef: { readonly outboxes: ReadonlyArray<TestOutboxDef> }
      }
    ).moduleDef.outboxes
    expect(outboxes).toEqual([
      {
        tableName: "pingOutbox",
        remoteReducer: "receive_ping",
        signatureHash:
          IdcFixtureInboxBinding.binding.reducers.receivePing?.signatureHash,
        onResultReducer: "ping_settled",
      },
      {
        tableName: "detailsOutbox",
        remoteReducer: "receive_details",
        signatureHash:
          IdcFixtureInboxBinding.binding.reducers.receiveDetails?.signatureHash,
        onResultReducer: "details_settled",
      },
    ])
    expect(
      (
        receiver.schema as {
          readonly moduleDef: {
            readonly explicitNames: {
              readonly entries: ReadonlyArray<{
                readonly tag: string
                readonly value: unknown
              }>
            }
          }
        }
      ).moduleDef.explicitNames.entries.filter(
        (entry) => entry.tag === "Function",
      ),
    ).toEqual([
      {
        tag: "Function",
        value: {
          sourceName: "receive_details",
          canonicalName: "receive_details",
        },
      },
      {
        tag: "Function",
        value: { sourceName: "receive_ping", canonicalName: "receive_ping" },
      },
    ])
  })

  it("refuses to build an outbox whose interface the module entry did not bind", () => {
    const impls = [IdcSenderSendsLive, IdcSenderSettlesLive] as const
    // Same group, another name: a different interface, so its binding is no
    // binding for the fixture outboxes, and unused bindings are accepted.
    const OtherInboxBinding = Stdb.RemoteInterface.bind(
      Stdb.RemoteInterface.make({
        name: "other_inbox",
        group: IdcFixtureInbox,
      }),
      idcFixtureInboxBinding,
    )
    const missing = [
      {
        code: "OutboxReceiverBindingMissing",
        path: ["tables", "pingOutbox", "outbox", "interface"],
      },
      {
        code: "OutboxReceiverBindingMissing",
        path: ["tables", "detailsOutbox", "outbox", "interface"],
      },
    ]

    expect(
      diagnosticsOf(() =>
        build(IdcSenderModule, impls, { runtimeMode: "dev-guarded" }),
      ),
    ).toEqual(missing)
    expect(
      diagnosticsOf(() =>
        build(IdcSenderModule, impls, {
          runtimeMode: "dev-guarded",
          receiverBindings: [OtherInboxBinding],
        }),
      ),
    ).toEqual(missing)
    expect(
      diagnosticsOf(() =>
        build(IdcSenderModule, impls, {
          runtimeMode: "dev-guarded",
          receiverBindings: [IdcFixtureInboxBinding, IdcFixtureInboxBinding],
        }),
      ),
    ).toEqual([
      { code: "DuplicateReceiverBinding", path: ["receiverBindings", 1] },
    ])
    expect(
      diagnosticsOf(() =>
        build(IdcSenderModule, impls, {
          runtimeMode: "dev-guarded",
          receiverBindings: [OtherInboxBinding, IdcFixtureInboxBinding],
        }),
      ),
    ).toEqual([])
    // Only compilation reads bindings; planning a sender needs none.
    expect(
      diagnosticsOf(() => Stdb.StdbBuilder.plan(IdcSenderModule, impls)),
    ).toEqual([])
  })
})
