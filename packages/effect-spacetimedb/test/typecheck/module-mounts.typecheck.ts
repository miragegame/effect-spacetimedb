import * as Effect from "effect/Effect"
import { wsTableAtomFamily } from "effect-spacetimedb/client/atom"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import { App, Audit, Library } from "../../examples/mounted-module/contract.ts"
import type * as native from "../../examples/mounted-module/native.ts"

const stock = App.mounts.stockRoom
void Effect.gen(function* () {
  const db = yield* App.Db
  yield* db.stockRoom.auditTrail.entry.insert({ id: 1 })
  // @ts-expect-error A native mount supplies its database through use.
  void db.tools
  // @ts-expect-error Scoped handles retain the library row's id type.
  yield* db.stockRoom.storedItem.insert({ id: "one" })
  const read = yield* App.ReadonlyDb
  // @ts-expect-error A readonly view cannot mutate a mounted table.
  void read.stockRoom.storedItem.insert
  // @ts-expect-error Only declared mount keys have an accessor.
  void App.mounts.stockroom
})
const insert = stock.run(
  Effect.flatMap(Library.Db, (db) => db.storedItem.insert({ id: 1 })),
)
void App.withTx(insert)
void App.withTx(stock.run(Library.TxCtx))
// @ts-expect-error A transaction cannot reach a library procedure's HTTP or withTx service.
void App.withTx(stock.run(Library.ProcedureCtx))
// @ts-expect-error The effect needs Audit's service, outside this mount.
void stock.run(Audit.Db)
void stock.run(Library.mounts.auditTrail.run(Audit.Db))
const host = App.mounts.tools
void App.withTx(
  host.use((ctx) => {
    void ctx.db.nativeItem.id.find(1)
    // @ts-expect-error A native mutation context cannot start another transaction.
    void ctx.withTx
  }),
)
void host.use("procedure", (ctx) => {
  ctx.withTx((tx) => tx.db.nativeItem.id.find(1))
  ctx.sleep
  // @ts-expect-error Procedures have no db outside withTx.
  void ctx.db
})
void host.use("http", (ctx) => {
  ctx.withTx((tx) => tx.db.nativeItem.id.find(1))
  // @ts-expect-error HTTP handlers cannot sleep.
  void ctx.sleep
})
// @ts-expect-error A native procedure alias cannot be requested inside a transaction.
void App.withTx(host.use("procedure", (ctx) => ctx.sender))
// @ts-expect-error Cannot supply a native library for an Effect mount.
void Stdb.Builder.mountNative(App, "stockRoom", {})
// @ts-expect-error Concrete native namespace must match the type-only declaration.
void Stdb.Builder.mountNative(App, "tools", {})
const root = Stdb.Module.make("root")
const consumer = root.mount("library", Audit).mountNative<typeof native>()(
  "files",
)
declare const sdk: typeof native
const impl = Stdb.Builder.mount(consumer, "library", {
  module: Audit,
  implementations: [],
})
const files = Stdb.Builder.mountNative(consumer, "files", sdk)
void build(consumer, [impl, files])
// @ts-expect-error Missing the library mount implementation.
void build(consumer, [files])
// @ts-expect-error Duplicate library implementation.
void build(consumer, [impl, impl, files])
// @ts-expect-error Same parent id, but this earlier contract has no mounts.
void build(root, [files])
void Stdb.Builder.mount(App, "stockRoom", {
  module: Library,
  // @ts-expect-error Child declarations must be implemented recursively.
  implementations: [],
})

const projected = Stdb.project(App)
void Effect.gen(function* () {
  const session = yield* projected.client.ws.Session
  yield* session.reducers.stockRoom.queueItem({ id: 1 })
  yield* session.procedures.stockRoom.save_item({
    item_ref: { tag: "by_id", value: { item_id: 1 } },
  })
  yield* session.subscribe(
    projected.targets.tables.stockRoom.auditTrail.entry.where((row) =>
      row.id.eq(1),
    ),
  )
  yield* session.subscribe(
    projected.targets.views.stockRoom.matchingItems({ id: 1 }),
  )
  yield* session.subscribeTableRef("stockRoom.auditTrail.entry")
  void wsTableAtomFamily<typeof App.spec>(session)("stockRoom.auditTrail.entry")
  yield* session.cache.tables.stockRoom.auditTrail.entry.id.find(1)
  yield* session.cache.views.stockRoom.listedItems.toArray()
  // @ts-expect-error Private tables have no typed cache.
  void session.cache.tables.stockRoom.privateItem
  // @ts-expect-error Native mounts have no typed projection.
  void projected.targets.tables.tools
  // @ts-expect-error Host-dispatched functions have no client callable.
  void session.reducers.stockRoom.settleMail
  yield* session.procedures.stockRoom.save_item({
    // @ts-expect-error Mounted parameters retain their declared types.
    item_ref: { tag: "by_id", value: { item_id: "one" } },
  })
  // @ts-expect-error This target belongs to the library when published on its own.
  yield* session.subscribe(Stdb.project(Library).targets.tables.storedItem)
})
