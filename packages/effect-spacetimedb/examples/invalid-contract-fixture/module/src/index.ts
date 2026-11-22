import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

// A contract that typechecks and fails validation when the host loads it: the
// host's account of that failure is all an author gets to read.

const twice = Stdb.table("twice", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})

const InvalidContractModule = Stdb.Module.make(
  "effect_spacetimedb_invalid_contract",
  {},
).addTables(twice, twice)

const compiled = build(InvalidContractModule, [])

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
