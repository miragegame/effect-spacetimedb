import { make as makeServer } from "../../src/server/bind.ts"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import * as Server from "effect-spacetimedb/server"
import { FullModule, FullStdbModule, UserId } from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"
import type { Assert, IsEqual, RequirementsOf } from "./helpers"

const server = makeServer({
  module: FullModule,
  runtime: TestSyncRunner,
})

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

class FragmentExternalService extends Context.Service<
  FragmentExternalService,
  {
    readonly value: string
  }
>()(
  "effect-spacetimedb/test/typecheck/server-transaction-helpers.typecheck/FragmentExternalService",
) {}

const withTxComposes = server.withTx(
  Effect.gen(function* () {
    const db = yield* server.db
    return yield* db.user.id.find(userId)
  }),
)

type _ServerWithTxResidualIsModuleScoped = Assert<
  IsEqual<
    RequirementsOf<typeof withTxComposes>,
    Server.TxRunner & Stdb.ModuleBrand<"example">
  >
>

const transactionComposes = server.transaction(
  Effect.fn(function* ({ db, ctx }) {
    void ctx.sender
    return yield* db.user.id.find(userId)
  }),
)

const httpTransactionComposes = server.httpTransaction(({ db }) =>
  db.user.id.find(userId),
)

const procedureScopedDbTx: Server.ScopedDbTx<
  UserTableOnly,
  Server.StdbHostFailure | Stdb.StdbDecodeError,
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

// @ts-expect-error withTx must reject requirements outside the tx scope.
const withTxRejectsHttp = server.withTx(server.http)

const scopedDbTxRejectsServerRequirements = procedureScopedDbTx(
  // @ts-expect-error scoped db fragments must not require server context tags.
  () => FullStdbModule.Db,
)

// @effect-diagnostics-next-line anyUnknownInErrorContext:off
const transactionRejectsScopedDbReturn = server.transaction(({ db }) =>
  // @ts-expect-error transaction must not return scoped db handles.
  Effect.succeed(db),
)

// @effect-diagnostics-next-line anyUnknownInErrorContext:off
const scopedDbTxRejectsScopedDbReturn = procedureScopedDbTx(({ db }) =>
  // @ts-expect-error scoped db fragments must not return scoped db handles.
  Effect.succeed(db),
)

// @effect-diagnostics-next-line anyUnknownInErrorContext:off
const httpTransactionRejectsScopedDbReturn = server.httpTransaction(({ db }) =>
  // @ts-expect-error httpTransaction must not return scoped db handles.
  Effect.succeed(db),
)

void withTxComposes
void transactionComposes
void httpTransactionComposes
void scopedDbTxComposes
void scopedDbTxPreservesExternalRequirement
void reducerScopedDbTxComposes
void withTxRejectsHttp
void scopedDbTxRejectsServerRequirements
void scopedDbTxRejectsUnrelatedTables
// @effect-diagnostics-next-line anyUnknownInErrorContext:off
void transactionRejectsScopedDbReturn
// @effect-diagnostics-next-line anyUnknownInErrorContext:off
void scopedDbTxRejectsScopedDbReturn
// @effect-diagnostics-next-line anyUnknownInErrorContext:off
void httpTransactionRejectsScopedDbReturn
void writableUserDb
