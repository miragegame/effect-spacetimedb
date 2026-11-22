import "effect-spacetimedb/server-polyfills"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import {
  StdbSenderError,
  StdbUniqueAlreadyExistsError,
} from "effect-spacetimedb/server"
import * as files from "@spacetimedb/files/submodule"
import * as native from "./native.ts"
import { App, Audit, Library } from "./contract.ts"
import { IdcFixtureInboxBinding } from "../../test/fixtures/idc/binding.ts"

const save = Effect.fn(function* (id: number) {
  const db = yield* Library.Db
  yield* db.storedItem.insert({ id })
})
const list = Effect.map(Library.From, (from) => from.storedItem)
const libraryLive = Stdb.Builder.group(Library, "Inventory", {
  queueItem: Effect.fn(function* ({ id }) {
    const db = yield* Library.Db
    const ctx = yield* Library.MutationCtx
    yield* db.auditTrail.entry.insert({ id })
    yield* db.auditTrail.tagged_item.insert({ entry_id: id, bucket_id: id % 2 })
    yield* db.pendingJob.schedule({
      value: id,
      scheduledAt: Stdb.ScheduleAt.after(ctx.timestamp, "1 second"),
    })
  }),
  completeJob: ({ data }) => save(data.value),
  settleMail: ({ row }) => save(Number(row.msgId)).pipe(Effect.orDie),
  save_item: ({ item_ref }) =>
    Library.withTx(save(item_ref.value.item_id)).pipe(Effect.as(item_ref)),
  auditEntries: () =>
    Library.mounts.auditTrail.run(Effect.map(Audit.From, (from) => from.entry)),
  listedItems: () => list,
  matchingItems: ({ id }) =>
    Effect.map(Library.From, (from) =>
      from.storedItem.where((row) => row.id.eq(id)),
    ),
})
// files 0.1.0 types its argument as a standalone ReducerCtx (including env).
// Its mount helpers use db and timestamp, both supplied by the SDK alias.
const filesContext = (ctx: Omit<files.FilesCtx, "env">) => ctx as files.FilesCtx

const readFile = App.mounts.files
  .use((ctx) =>
    Uint8Array.from(
      files.readFileBytes(
        filesContext(ctx),
        { path: "/proof.bin" },
        ctx.sender.toHexString(),
      ).bytes,
    ),
  )
  .pipe(Effect.catchTag("StdbSenderError", Effect.die))

const scoped = App.mounts.stockRoom
const appLive = Stdb.Builder.group(App, "Warehouse", {
  writeItems: Effect.fn(function* ({ id, refuse }) {
    const db = yield* App.Db
    yield* db.receipt.insert({ id })
    yield* db.stockRoom.privateItem.insert({ id })
    yield* scoped.run(save(id))
    yield* scoped.run(
      Library.mounts.auditTrail.run(
        Effect.flatMap(Audit.Db, (audit) => audit.entry.insert({ id })),
      ),
    )
    if (refuse)
      return yield* new StdbSenderError({ value: "undo warehouse write" })
  }),
  uploadFile: ({ bytes }) =>
    App.mounts.files
      .use((ctx) =>
        files.uploadFile(
          filesContext(ctx),
          {
            path: "/proof.bin",
            bytes: Array.from(bytes),
            mimeType: "application/octet-stream",
            visibility: files.FILE_VISIBILITY_OWNER,
          },
          ctx.sender.toHexString(),
        ),
      )
      .pipe(Effect.asVoid),
  readFile: () => App.withTx(readFile),
  nativeInsert: Effect.fn(function* ({ id, value }) {
    const result = yield* Effect.result(
      App.mounts.tools.use((ctx) => native.insert(ctx, id, value)),
    )
    if (Result.isFailure(result)) {
      if (StdbUniqueAlreadyExistsError.is(result.failure))
        return yield* new StdbSenderError({ value: "duplicate native item" })
      return yield* result.failure
    }
  }),
  saveBoth: ({ id }) =>
    App.withTx(
      Effect.gen(function* () {
        yield* scoped.run(save(id))
        yield* App.mounts.tools
          .use((ctx) => native.insert(ctx, id))
          .pipe(Effect.catchTag("StdbSenderError", Effect.die))
      }),
    ),
  openScopedTx: Effect.fn(function* ({ id }) {
    yield* scoped.run(Library.withTx(save(id)))
    yield* App.mounts.tools
      .use("procedure", (ctx) => ctx.withTx((tx) => native.insert(tx, id)))
      .pipe(Effect.catchTag("StdbSenderError", Effect.die))
  }),
  inventoryItems: () =>
    Effect.flatMap(App.ReadonlyDb, (db) => db.stockRoom.storedItem.toArray()),
  inventoryQuery: () => scoped.run(list),
})

const compiled = build(
  App,
  [
    appLive,
    Stdb.Builder.group(App, "Delivery", {
      deliver: Effect.fn(function* () {
        yield* scoped.run(
          Effect.flatMap(Library.HttpTx, (tx) => tx.run(save(8))),
        )
        yield* App.mounts.tools
          .use("http", (ctx) => ctx.withTx((tx) => native.insert(tx, 8)))
          .pipe(Effect.catchTag("StdbSenderError", Effect.die))
        return new Stdb.SyncResponse("delivered")
      }),
    }),
    Stdb.Builder.mount(App, "stockRoom", {
      module: Library,
      implementations: [
        libraryLive,
        Stdb.Builder.mount(Library, "auditTrail", {
          module: Audit,
          implementations: [],
        }),
      ],
    }),
    Stdb.Builder.mountNative(App, "tools", native),
    Stdb.Builder.mountNative(App, "files", files),
  ],
  {
    receiverBindings: [IdcFixtureInboxBinding],
  },
)
export const ModuleExports = compiled.exportGroup()
export default compiled.schema
