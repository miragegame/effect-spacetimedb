import * as Stdb from "effect-spacetimedb"
import { FullStdbModule } from "../fixtures/full-module"
import type { Assert, IsEqual } from "./helpers"

type UserRow = Stdb.RowOf<typeof FullStdbModule, "user">
type DirectUserRow = Stdb.TableRow<
  (typeof FullStdbModule)["spec"]["tables"]["user"]
>
type _rowOfMatchesTableRow = Assert<IsEqual<UserRow, DirectUserRow>>

// @ts-expect-error RowOf only accepts table names from the selected module.
type _unknownTable = Stdb.RowOf<typeof FullStdbModule, "unknownTable">

const exports = Stdb.moduleExports(FullStdbModule)
type _dbPreserved = Assert<
  IsEqual<typeof exports.Db, (typeof FullStdbModule)["Db"]>
>
type _withTxPreserved = Assert<
  IsEqual<typeof exports.withTx, (typeof FullStdbModule)["withTx"]>
>

void exports
