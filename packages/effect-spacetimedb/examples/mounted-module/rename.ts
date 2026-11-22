import "effect-spacetimedb/server-polyfills"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

declare const MOUNT_ACCESSOR: "inventory" | "warehouse"
declare const MOUNT_NAME: string
const item = Stdb.table("item", { columns: { id: Stdb.u32().primaryKey() } })
const library = Stdb.Module.make("library")
  .addTables(item)
  .add(
    Stdb.Group.make("Items").add(
      Stdb.Fn.reducer("save", {}),
      Stdb.Fn.reducer("clear", {}),
    ),
  )
const live = Stdb.Builder.group(library, "Items", {
  clear: Effect.fn(function* () {
    const db = yield* library.Db
    yield* db.item.id.delete(1)
  }),
  save: Effect.fn(function* () {
    const db = yield* library.Db
    yield* db.item.insert({ id: 1 })
  }),
})
const parent = Stdb.Module.make("parent")
const compile = () => {
  // Each edition has a single statically known namespace and implementation.
  if (MOUNT_ACCESSOR === "inventory") {
    const module = parent.mount("inventory", library, { name: MOUNT_NAME })
    return build(module, [
      Stdb.Builder.mount(module, "inventory", {
        module: library,
        implementations: [live],
      }),
    ])
  }
  const module = parent.mount("warehouse", library, { name: MOUNT_NAME })
  return build(module, [
    Stdb.Builder.mount(module, "warehouse", {
      module: library,
      implementations: [live],
    }),
  ])
}
const compiled = compile()
export const ModuleExports = compiled.exportGroup()
export default compiled.schema
