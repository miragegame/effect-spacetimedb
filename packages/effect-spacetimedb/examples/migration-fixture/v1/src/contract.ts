import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

const moduleName = "effect_spacetimedb_migration_fixture" as const
const String255 = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)
const U64 = Stdb.u64(
  Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(0n)),
)

// Result sets returned by the fixture's views and procedures; the migration
// suite seeds a handful of rows.

const account = Stdb.table("account", {
  public: true,
  columns: {
    id: U64.primaryKey().autoInc(),
    owner: String255,
  },
})

const tables = [account] as const

const AccountFunctions = Stdb.Group.make("Account")
  .add(
    Stdb.Fn.reducer("accountCreate", {
      params: Stdb.struct({
        owner: String255,
      }),
    }),
  )
  .add(
    Stdb.Fn.procedure("accountOwners", {
      params: Stdb.struct({}),
      returns: Stdb.array(String255),
    }),
  )
  .add(
    Stdb.Fn.anonymousView("allAccounts", {
      returns: Stdb.array(account.row),
    }),
  )

export const MigrationModule = Stdb.Module.make(moduleName, {})
  .addTables(...tables)
  .add(AccountFunctions)
