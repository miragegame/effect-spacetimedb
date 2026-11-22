// The declarations exercise both snake_case and camelCase names.
import * as Stdb from "effect-spacetimedb"
import { IdcFixtureInboxInterface } from "../../test/fixtures/idc/interface.ts"

const columns = { id: Stdb.u32().primaryKey() }
export const Audit = Stdb.Module.make("audit").addTables(
  Stdb.table("entry", { columns, public: true }),
  Stdb.table("tagged_item", {
    columns: { entry_id: Stdb.u32().primaryKey(), bucket_id: Stdb.u32() },
    indexes: (c) => [
      Stdb.index("by_bucket", [c.bucket_id], { algorithm: "btree" }),
    ],
    public: true,
  }),
)
const item = Stdb.table("storedItem", { columns, public: true })
const job = Stdb.scheduledTable("pendingJob", {
  scheduledId: Stdb.u64(),
  columns: { value: Stdb.u32() },
})
export const mail = Stdb.outboxTable("mail", {
  interface: IdcFixtureInboxInterface,
  reducer: "receivePing",
  rowBytesMax: 4096,
})
const idParams = Stdb.struct({ id: Stdb.u32() })
const items = Stdb.array(item.row)
export const itemRef = Stdb.sum({ by_id: Stdb.struct({ item_id: Stdb.u32() }) })
export const Library = Stdb.Module.make("inventory")
  .addTables(item, Stdb.table("privateItem", { columns }), job, mail)
  .mount("auditTrail", Audit)
  .add(
    Stdb.Group.make("Inventory").add(
      Stdb.Fn.reducer("queueItem", { params: idParams }),
      Stdb.Fn.scheduledReducer("completeJob", { table: job }),
      Stdb.Fn.outboxResult("settleMail", { table: mail }),
      Stdb.Fn.procedure("save_item", {
        params: Stdb.struct({ item_ref: itemRef }),
        returns: itemRef,
      }),
      Stdb.Fn.anonymousView("auditEntries", { returns: items }),
      Stdb.Fn.anonymousView("listedItems", { returns: items }),
      Stdb.Fn.view("matchingItems", { params: idParams, returns: items }),
    ),
  )

export const App = Stdb.Module.make("warehouse", {
  environment: {
    WAREHOUSE_ZONE: Stdb.Environment.optional(Stdb.Environment.string()),
  },
})
  .addTables(Stdb.table("receipt", { columns }))
  .mount("stockRoom", Library)
  .mountNative<typeof import("./native.ts")>()("tools")
  .mountNative<typeof import("@spacetimedb/files/submodule")>()("files")
  .add(
    Stdb.Group.make("Warehouse").add(
      Stdb.Fn.reducer("writeItems", {
        params: Stdb.struct({ id: Stdb.u32(), refuse: Stdb.bool() }),
      }),
      Stdb.Fn.reducer("uploadFile", {
        params: Stdb.struct({ bytes: Stdb.bytes() }),
      }),
      Stdb.Fn.procedure("readFile", { returns: Stdb.bytes() }),
      Stdb.Fn.reducer("nativeInsert", {
        params: Stdb.struct({ id: Stdb.u32(), value: Stdb.u32() }),
      }),
      Stdb.Fn.procedure("saveBoth", {
        params: idParams,
        returns: Stdb.unit(),
      }),
      Stdb.Fn.procedure("openScopedTx", {
        params: idParams,
        returns: Stdb.unit(),
      }),
      Stdb.Fn.anonymousView("inventoryItems", { returns: items }),
      Stdb.Fn.anonymousView("inventoryQuery", { returns: items }),
    ),
  )
  .add(
    Stdb.HttpGroup.make("Delivery").add(Stdb.Http.post("deliver", "/deliver")),
  )
