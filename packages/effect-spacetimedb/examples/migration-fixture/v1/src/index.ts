import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

const moduleName = "effect_spacetimedb_migration_fixture" as const
const String255 = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)
const U64 = Stdb.u64(
  Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(0n)),
)

const account = Stdb.table("account", {
  public: true,
  columns: {
    id: U64.primaryKey().autoInc(),
    owner: String255,
  },
})

const tables = [account] as const

const AccountFunctions = Stdb.StdbGroup.make("Account")
  .add(
    Stdb.StdbFn.reducer("accountCreate", {
      params: Stdb.struct({
        owner: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("accountOwners", {
      params: Stdb.struct({}),
      returns: Stdb.array(String255),
    }),
  )
  .add(
    Stdb.StdbFn.anonymousView("allAccounts", {
      returns: Stdb.array(account.row),
    }),
  )

const MigrationModule = Stdb.StdbModule.make(moduleName, {})
  .addTables(...tables)
  .add(AccountFunctions)

const { Db, ReadonlyDb, Tx } = MigrationModule

const AccountFunctionsLive = Stdb.StdbBuilder.group(
  MigrationModule,
  "Account",
  {
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
  },
)

const compiled = build(MigrationModule, [AccountFunctionsLive])

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
