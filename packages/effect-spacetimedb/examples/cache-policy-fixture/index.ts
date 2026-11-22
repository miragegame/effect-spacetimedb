import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import { cacheModule } from "./contract"

// The live test builds two editions from this entry. Only the storage settings change.
declare const ROTATE_CACHE_POLICIES: boolean
const module = cacheModule(ROTATE_CACHE_POLICIES)
const compiled = build(module, [
  Stdb.Builder.group(module, "Storage", {
    record: Effect.fn(function* ({ id }) {
      const db = yield* module.Db
      yield* db.memory.insert({ id })
      yield* db.disk.insert({ id })
      yield* db.flexible.insert({ id })
      yield* db.inherited.insert({ id })
    }),
  }),
])
export const ModuleExports = compiled.exportGroup()
export default compiled.schema
