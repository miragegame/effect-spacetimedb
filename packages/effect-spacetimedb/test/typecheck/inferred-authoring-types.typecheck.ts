import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { CallableOnlyModule } from "../fixtures/callable-only-module"
import { FullModule, UserId, type UserName } from "../fixtures/full-module"
import type { Assert, Expand, IsEqual } from "./helpers"

type _UserRow = Assert<
  IsEqual<
    Stdb.TableRow<typeof FullModule.tables.user>,
    { readonly id: UserId; readonly name: UserName }
  >
>

const MixedCount = Schema.BigInt.pipe(
  Schema.check(Schema.isGreaterThanOrEqualToBigInt(0n)),
)
const MixedNote = Schema.String.pipe(Schema.check(Schema.isMaxLength(255)))

const MixedTable = Stdb.table("inferred_authoring_mixed", {
  columns: {
    id: Stdb.string(UserId).primaryKey(),
    count: Stdb.u64(MixedCount),
    kind: Stdb.literal("a", "b"),
    note: Stdb.string(MixedNote),
  },
})

type _MixedRow = Assert<
  IsEqual<
    Stdb.TableRow<typeof MixedTable>,
    {
      readonly id: UserId
      readonly count: bigint
      readonly kind: "a" | "b"
      readonly note: string
    }
  >
>

type _PingParams = Assert<
  IsEqual<
    Expand<Stdb.TypeOf<typeof CallableOnlyModule.reducers.ping.params>>,
    {}
  >
>

type _UserUpsertParams = Assert<
  IsEqual<
    Expand<Stdb.TypeOf<typeof FullModule.reducers.userUpsert.params>>,
    { readonly userId: UserId; readonly name: UserName }
  >
>

type _EchoParams = Assert<
  IsEqual<
    Expand<Stdb.TypeOf<typeof CallableOnlyModule.procedures.echo.params>>,
    { readonly value: string }
  >
>

type _EchoReturns = Assert<
  IsEqual<
    Stdb.TypeOf<typeof CallableOnlyModule.procedures.echo.returns>,
    string
  >
>

type _UserGetReturns = Assert<
  IsEqual<
    Expand<Stdb.TypeOf<typeof FullModule.procedures.userGet.returns>>,
    { readonly id: UserId; readonly name: UserName } | undefined
  >
>

type _AllUsersReturns = Assert<
  IsEqual<
    Expand<Stdb.TypeOf<typeof FullModule.views.allUsers.returns>>,
    ReadonlyArray<{ readonly id: UserId; readonly name: UserName }>
  >
>
