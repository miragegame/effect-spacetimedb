import * as Effect from "effect/Effect"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, UserId } from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"

const server = StdbTesting.makeServer({
  module: FullModule,
  runtime: TestSyncRunner,
})

const userId = "user_1" as UserId

const withTxComposes = server.withTx(
  Effect.gen(function* () {
    const db = yield* server.db
    return yield* db.user.id.find(userId)
  }),
)

const transactionComposes = server.transaction(
  Effect.fn(function* ({ db, ctx }) {
    void ctx.sender
    return yield* db.user.id.find(userId)
  }),
)

const httpTransactionComposes = server.httpTransaction(({ db }) =>
  db.user.id.find(userId),
)

// @ts-expect-error withTx must reject requirements outside the tx scope.
const withTxRejectsHttp = server.withTx(server.http)

// @ts-expect-error transaction must reject requirements outside the tx scope.
const transactionRejectsHttp = server.transaction(() => server.http)

// @ts-expect-error httpTransaction may only require the transaction Db.
const httpTransactionRejectsTxCtx = server.httpTransaction(() => server.txCtx)

const transactionRejectsScopedDbReturn = server.transaction(({ db }) =>
  // @ts-expect-error transaction must not return scoped db handles.
  Effect.succeed(db),
)

const httpTransactionRejectsScopedDbReturn = server.httpTransaction(({ db }) =>
  // @ts-expect-error httpTransaction must not return scoped db handles.
  Effect.succeed(db),
)

void withTxComposes
void transactionComposes
void httpTransactionComposes
void withTxRejectsHttp
void transactionRejectsHttp
void httpTransactionRejectsTxCtx
void transactionRejectsScopedDbReturn
void httpTransactionRejectsScopedDbReturn
