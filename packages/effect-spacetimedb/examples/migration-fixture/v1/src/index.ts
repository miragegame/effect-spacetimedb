import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

import { MigrationModule } from "./contract"

const { Db, ReadonlyDb, Tx } = MigrationModule

const AccountFunctionsLive = Stdb.Builder.group(MigrationModule, "Account", {
  accountCreate: Effect.fn(function* ({ owner }) {
    const db = yield* Db
    yield* db.account.insert({
      id: 0n,
      owner,
    })
  }),
  accountOwners: Effect.fn(function* () {
    const tx = yield* Tx
    return yield* tx.run(
      Effect.gen(function* () {
        const db = yield* Db
        const rows = yield* db.account.toArray()
        return rows.map((row) => row.owner)
      }),
    )
  }),
  allAccounts: Effect.fn(function* () {
    const db = yield* ReadonlyDb
    const rows = yield* db.account.toArray()
    return rows.map((row) => ({
      id: row.id ?? 0n,
      owner: row.owner,
    }))
  }),
})

const compiled = build(MigrationModule, [AccountFunctionsLive])

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
