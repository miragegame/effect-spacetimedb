import * as StdbInternal from "effect-spacetimedb/testing/internal"
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import * as Testing from "effect-spacetimedb/testing"
import { StdbSenderError } from "effect-spacetimedb/server"
import { Identity } from "spacetimedb"
import { IdcFixtureInboxInterface } from "../fixtures/idc/interface.ts"

const { expect, it } = EffectVitest
const serial = Stdb.table("serial", {
  columns: { id: Stdb.u64().primaryKey().autoInc() },
})
const outbox = Stdb.outboxTable("mail", {
  interface: IdcFixtureInboxInterface,
  reducer: "receivePing",
  rowBytesMax: 4096,
})
const leaf = Stdb.Module.make("ledger")
  .addTables(serial, outbox)
  .add(
    Stdb.Group.make("Ledger").add(
      Stdb.Fn.reducer("sendNote", {
        params: Stdb.struct({ target: Stdb.identity() }),
      }),
      Stdb.Fn.outboxResult("noteSettled", { table: outbox }),
      Stdb.Fn.procedure("append", { returns: Stdb.u64() }),
      Stdb.Fn.anonymousView("entries", { returns: Stdb.array(serial.row) }),
    ),
  )
const append = Effect.flatMap(leaf.Db, (db) => db.serial.insert({ id: 0n }))
const leafLive = Stdb.Builder.group(leaf, "Ledger", {
  entries: () => Effect.flatMap(leaf.ReadonlyDb, (db) => db.serial.toArray()),
  append: () => leaf.withTx(append.pipe(Effect.map((row) => row.id))),
  sendNote: ({ target }) =>
    Effect.flatMap(leaf.Db, (db) =>
      db.mail.insert({
        target: Stdb.RemoteInterface.peer(IdcFixtureInboxInterface, target),
        note: "hello",
      }),
    ).pipe(Effect.orDie, Effect.asVoid),
  noteSettled: () => append.pipe(Effect.orDie, Effect.asVoid),
})
const library = Stdb.Module.make("records").mount("auditTrail", leaf, {
  name: "ledger",
})
const root = Stdb.Module.make("issuer")
  .addTables(serial)
  .mount("stockRoom", library)
  .add(
    Stdb.Group.make("Write").add(
      Stdb.Fn.reducer("write", {
        params: Stdb.struct({ refuse: Stdb.bool() }),
      }),
    ),
  )
const live = Stdb.Builder.group(root, "Write", {
  write: Effect.fn(function* ({ refuse }) {
    const db = yield* root.Db
    yield* db.serial.insert({ id: 0n })
    yield* root.mounts.stockRoom.run(library.mounts.auditTrail.run(append))
    if (refuse) return yield* new StdbSenderError({ value: "rollback" })
  }),
})
const implementations = [
  live,
  Stdb.Builder.mount(root, "stockRoom", {
    module: library,
    implementations: [
      Stdb.Builder.mount(library, "auditTrail", {
        module: leaf,
        implementations: [leafLive],
      }),
    ],
  }),
] as const

it("uses a single rollback boundary and namespace-local sequences across mounts", () => {
  const harness = Testing.makeTestModuleHarness(root.spec)
  const calls = Testing.bindCallables(root, implementations)
  expect(() =>
    calls.write!.invoke(harness.makeMutationCtx(), { refuse: true }),
  ).toThrow("rollback")
  expect([...harness.db.serial.iter()]).toEqual([])
  expect([...harness.db.stockRoom.auditTrail.serial.iter()]).toEqual([])
  calls.stockRoom.auditTrail.append!.invoke(harness.makeProcedureCtx(), {})
  calls.write!.invoke(harness.makeMutationCtx(), { refuse: false })
  expect([...harness.db.serial.iter()]).toEqual([{ id: 2n }])
  expect([...harness.db.stockRoom.auditTrail.serial.iter()]).toEqual([
    { id: 2n },
    { id: 3n },
  ])
  const view = harness.makeAnonymousViewCtx()
  expect(view).not.toHaveProperty("as")
  expect(calls.stockRoom.auditTrail.entries!.invoke(view, {})).toEqual([
    { id: 2n },
    { id: 3n },
  ])
  harness.reset()
  expect([...harness.db.stockRoom.auditTrail.serial.iter()]).toEqual([])
})

it("delivers and settles the mounted outbox by its qualified wire callable", () => {
  const harness = Testing.makeTestModuleHarness(root.spec)
  const callables = Testing.bindCallables(
    StdbInternal.planModule(root, implementations),
  )
  const target = new Identity(20n)
  const receiver = Testing.IdcPump.recording({ databaseIdentity: target })
  const pump = Testing.makeIdcPump({
    links: [
      {
        sender: { module: root.spec, harness, callables },
        receivers: [receiver],
      },
    ],
  })
  callables["stock_room.ledger.send_note"]!.invoke(harness.makeMutationCtx(), {
    target,
  })
  expect(harness.outboxRows("stockRoom.auditTrail.mail")).toMatchObject([
    { msgId: 1n },
  ])
  expect(pump.drain()).toMatchObject([
    { outbox: "stockRoom.auditTrail.mail", result: { _tag: "Delivered" } },
  ])
  expect(receiver.calls).toMatchObject([
    { reducer: "receive_ping", args: { note: "hello" } },
  ])
  expect(harness.outboxRows("stockRoom.auditTrail.mail")).toEqual([])
  expect([...harness.db.stockRoom.auditTrail.serial.iter()]).toEqual([
    { id: 1n },
  ])
})

it("requests a native stand-in only when its handler uses the mount", () => {
  const mod = Stdb.Module.make("native_consumer")
    .mountNative<typeof import("../../examples/mounted-module/native.ts")>()(
      "tools",
    )
    .add(Stdb.Group.make("Count").add(Stdb.Fn.reducer("probe", {})))
  const calls = Testing.bindCallables(mod, [
    Stdb.Builder.group(mod, "Count", {
      probe: () =>
        mod.mounts.tools
          .use((ctx) => ctx.db.nativeItem.count())
          .pipe(Effect.asVoid),
    }),
  ])
  const empty = Testing.makeTestModuleHarness(mod.spec)
  expect(() => calls.probe!.invoke(empty.makeMutationCtx(), {})).toThrow(
    /tools.*stand-in/,
  )
  let reads = 0
  const fake = Testing.makeTestModuleHarness(mod.spec, {
    nativeMounts: {
      tools: () => ({ db: { nativeItem: { count: () => ++reads } } }),
    },
  })
  calls.probe!.invoke(fake.makeMutationCtx(), {})
  expect(reads).toBe(1)
})

it("rejects a native callback for the wrong handler kind before entering the alias", () => {
  const calls: string[] = []
  const mod = Stdb.Module.make("wrong_frame")
    .mountNative<typeof import("../../examples/mounted-module/native.ts")>()(
      "tools",
    )
    .add(Stdb.Group.make("Test").add(Stdb.Fn.reducer("probe", {})))
  const harness = Testing.makeTestModuleHarness(mod.spec, {
    nativeMounts: { tools: () => ({}) },
  })
  const bound = Testing.bindCallables(mod, [
    Stdb.Builder.group(mod, "Test", {
      // Simulate an untyped caller asking for a procedure inside a reducer.
      probe: () =>
        mod.mounts.tools.use("procedure", () => {
          calls.push("called")
        }) as never,
    }),
  ])
  expect(() => bound.probe!.invoke(harness.makeMutationCtx(), {})).toThrow(
    /tools.*procedure.*reducer/,
  )
  expect(calls).toHaveLength(0)
})
