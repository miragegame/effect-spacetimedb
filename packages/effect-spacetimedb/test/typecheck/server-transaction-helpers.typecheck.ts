import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import * as Server from "effect-spacetimedb/server"
import { FullModule, FullStdbModule, UserId } from "../fixtures/full-module"
import type { Assert, ErrorOf, IsEqual, RequirementsOf } from "./helpers"

const userId = "user_1" as UserId
type FullTables = (typeof FullStdbModule.spec)["tables"]
type UserTableOnly = Pick<FullTables, "user">
type UnrelatedTables = {
  readonly missing: FullTables["user"]
}

declare const fullDb: Server.DbService<typeof FullModule>
declare const readonlyFullDb: Server.ReadonlyDbService<typeof FullModule>
declare const fragmentCtx: Server.FragmentTxCtx

const userDb: Server.DbHandleFor<UserTableOnly> = fullDb
// @ts-expect-error readonly handles must not satisfy writable fragment handles.
const writableUserDb: Server.DbHandleFor<UserTableOnly> = readonlyFullDb

type _FindHasNoError = Assert<
  IsEqual<ErrorOf<ReturnType<typeof fullDb.user.id.find>>, never>
>
type _DeleteHasNoError = Assert<
  IsEqual<ErrorOf<ReturnType<typeof fullDb.user.id.delete>>, never>
>
type _ReadAllHasNoError = Assert<
  IsEqual<ErrorOf<ReturnType<typeof fullDb.user.toArray>>, never>
>
type _UnconstrainedInsertHasNoError = Assert<
  IsEqual<ErrorOf<ReturnType<typeof fullDb.presenceEvent.insert>>, never>
>
type _UniqueInsertFailure = Assert<
  IsEqual<
    ErrorOf<ReturnType<typeof fullDb.user.insert>>,
    Server.StdbUniqueAlreadyExistsError
  >
>
type _UpdateFailure = Assert<
  IsEqual<
    ErrorOf<ReturnType<typeof fullDb.user.id.update>>,
    Server.StdbUniqueAlreadyExistsError | Server.StdbNoSuchRowError
  >
>
type _ScheduleFailure = Assert<
  IsEqual<
    ErrorOf<ReturnType<typeof fullDb.reminder.schedule>>,
    | Server.StdbUniqueAlreadyExistsError
    | Server.StdbAutoIncOverflowError
    | Server.StdbScheduleDelayTooLongError
  >
>

class FragmentExternalService extends Context.Service<
  FragmentExternalService,
  {
    readonly value: string
  }
>()(
  "effect-spacetimedb/test/typecheck/server-transaction-helpers.typecheck/FragmentExternalService",
) {}

const withTxComposes = FullStdbModule.withTx(
  Effect.gen(function* () {
    const db = yield* FullStdbModule.Db
    return yield* db.user.id.find(userId)
  }),
)

type _ServerWithTxResidualIsModuleScoped = Assert<
  IsEqual<
    RequirementsOf<typeof withTxComposes>,
    Server.TxRunner & Stdb.ModuleBrand<"example">
  >
>

const procedureScopedDbTx: Server.ScopedDbTx<
  UserTableOnly,
  Server.HostFailure,
  Server.TxRunner & Stdb.ModuleBrand<"example">
> = Server.scopedDbTx<typeof FullStdbModule.spec, UserTableOnly>(FullStdbModule)

const scopedDbTxRejectsUnrelatedTables = Server.scopedDbTx<
  typeof FullStdbModule.spec,
  UnrelatedTables
>(
  // @ts-expect-error scopedDbTx table overrides must be satisfied by module tables.
  FullStdbModule,
)

const scopedDbTxComposes = procedureScopedDbTx(
  Effect.fn(function* ({ db, ctx }) {
    void ctx.timestamp
    void ctx.random
    return yield* db.user.id.find(userId)
  }),
)

type _ScopedDbTxResidualIsModuleScoped = Assert<
  IsEqual<
    RequirementsOf<typeof scopedDbTxComposes>,
    Server.TxRunner & Stdb.ModuleBrand<"example">
  >
>

const scopedDbTxPreservesExternalRequirement = procedureScopedDbTx(() =>
  Effect.map(FragmentExternalService, (service) => service.value),
)

type _ScopedDbTxPreservesExternalRequirement = Assert<
  IsEqual<
    RequirementsOf<typeof scopedDbTxPreservesExternalRequirement>,
    FragmentExternalService | (Server.TxRunner & Stdb.ModuleBrand<"example">)
  >
>

const reducerScopedDbTx: Server.ScopedDbTx<UserTableOnly> =
  Server.scopedDbTxFromCtx({
    db: userDb,
    ctx: fragmentCtx,
  })

const reducerScopedDbTxComposes = reducerScopedDbTx(({ db }) =>
  db.user.id.find(userId),
)

type _ReducerScopedDbTxHasNoResidualRequirements = Assert<
  IsEqual<RequirementsOf<typeof reducerScopedDbTxComposes>, never>
>

const fragmentWithRelease = () =>
  Effect.acquireRelease(Effect.succeed(1), () => Effect.void)

const scopedDbTxOwnsItsScope = procedureScopedDbTx(fragmentWithRelease)

type _ScopedDbTxOwnsItsScope = Assert<
  IsEqual<
    RequirementsOf<typeof scopedDbTxOwnsItsScope>,
    Server.TxRunner & Stdb.ModuleBrand<"example">
  >
>

const reducerScopedDbTxOwnsItsScope = reducerScopedDbTx(fragmentWithRelease)

type _ReducerScopedDbTxOwnsItsScope = Assert<
  IsEqual<RequirementsOf<typeof reducerScopedDbTxOwnsItsScope>, never>
>

const withTxRejectsProcedureCtx = FullStdbModule.withTx(
  // @ts-expect-error withTx must reject requirements outside the tx scope.
  FullStdbModule.ProcedureCtx,
)

const withTxRejectsHttp = FullStdbModule.withTx(
  // @ts-expect-error withTx must reject Http, which a transaction cannot reach.
  FullStdbModule.Http,
)

const withTxRejectsRawTag = FullStdbModule.withTx(
  // @ts-expect-error withTx must reject a raw context tag.
  Server.Db,
)

const withTxOwnsItsScope = FullStdbModule.withTx(
  Effect.acquireRelease(Effect.void, () => Effect.void),
)

type _WithTxBodyScopeEndsWithTheTransaction = Assert<
  IsEqual<
    RequirementsOf<typeof withTxOwnsItsScope>,
    Server.TxRunner & Stdb.ModuleBrand<"example">
  >
>

const scopedDbTxRejectsServerRequirements = procedureScopedDbTx(
  // @ts-expect-error scoped db fragments must not require server context tags.
  () => FullStdbModule.Db,
)

const scopedDbTxRejectsScopedDbReturn = procedureScopedDbTx(({ db }) =>
  // @ts-expect-error scoped db fragments must not return scoped db handles.
  Effect.succeed(db),
)

void withTxComposes
void scopedDbTxComposes
void scopedDbTxPreservesExternalRequirement
void reducerScopedDbTxComposes
void withTxRejectsProcedureCtx
void withTxRejectsHttp
void withTxRejectsRawTag
void withTxOwnsItsScope
void scopedDbTxOwnsItsScope
void reducerScopedDbTxOwnsItsScope
void scopedDbTxRejectsServerRequirements
void scopedDbTxRejectsUnrelatedTables
void scopedDbTxRejectsScopedDbReturn
void writableUserDb
