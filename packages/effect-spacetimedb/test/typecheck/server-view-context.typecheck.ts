import * as Effect from "effect/Effect"
import type * as Server from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"

const server = StdbTesting.makeServer({
  module: FullModule,
  runtime: TestSyncRunner,
})

type LiveReadonlyDb = Server.ReadonlyDbService<typeof FullModule>
type LiveFrom = Server.FromService<typeof FullModule>

const senderView = server.view(
  Effect.fn(function* () {
    const ctx = yield* server.viewCtx
    const from = yield* server.from
    const db = yield* server.readonlyDb

    void ctx.sender
    void from.user
    void db.user
    void db.user.count
    void db.user.id.find

    // @ts-expect-error readonly db must not expose table writes
    void db.user.insert

    // @ts-expect-error readonly db must not expose lookup writes
    void db.user.id.delete
    return undefined
  }),
)

const anonymousView = server.anonymousView(
  Effect.fn(function* () {
    const ctx = yield* server.anonymousViewCtx
    const from = yield* server.from

    void ctx.db
    return from.user
  }),
)

const invalidAnonymousView = server.view(
  // @ts-expect-error sender view helper must not access anonymous view context
  Effect.fn(function* () {
    const ctx = yield* server.anonymousViewCtx
    void ctx
    return []
  }),
)

const invalidSenderViewDb = server.view(
  // @ts-expect-error sender views must not depend on read-write Db
  Effect.fn(function* () {
    const db = yield* server.db
    void db
    return undefined
  }),
)

void senderView
void anonymousView
void invalidAnonymousView
void invalidSenderViewDb
