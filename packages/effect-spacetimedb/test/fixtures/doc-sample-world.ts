/**
 * What the documentation's fragments take as already in scope, as real values.
 * A fence imports from here only the names it uses and does not declare, and
 * an earlier fence on the same page wins over this file, so this is the
 * running example the pages share: the README's module, and the names a reader
 * brings (a URI, a token, a generated `DbConnection`).
 *
 * Everything here is loaded and validated by the same suite as the fences.
 * `declare const` is for what only exists at run time inside a handler or a
 * session; a fence that is loaded cannot use one.
 */
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as Schema from "effect/Schema"
import type { Identity, Timestamp } from "spacetimedb"
import * as Stdb from "effect-spacetimedb"
import type * as StdbClient from "effect-spacetimedb/client"
import type * as StdbServer from "effect-spacetimedb/server"

export * as Context from "effect/Context"
export * as Effect from "effect/Effect"
export * as Layer from "effect/Layer"
export * as Option from "effect/Option"
export * as Redacted from "effect/Redacted"
export * as Schema from "effect/Schema"
export * as Stream from "effect/Stream"
export * as Stdb from "effect-spacetimedb"
export * as StdbClient from "effect-spacetimedb/client"
export * as StdbServer from "effect-spacetimedb/server"
export * as StdbTesting from "effect-spacetimedb/testing"
export { makeDevServer } from "effect-spacetimedb/dev-server"
export { build } from "effect-spacetimedb/server-compiler"
export { Identity } from "spacetimedb"

export {
  IdcPairNoteTooLarge,
  IdcPairSenderModule,
  noteOutbox,
} from "../../examples/idc-pair/sender/src/contract"
export { PairInboxInterface } from "../../examples/idc-pair/sender/src/interface"
export {
  IdcPairSendsLive,
  IdcPairSettlesLive,
} from "../../examples/idc-pair/sender/src/live"
export { IdcPairReceiverModule } from "../../examples/idc-pair/receiver/src/contract"
export {
  IdcPairBlankNote,
  IdcPairUnknownSender,
} from "../../examples/idc-pair/receiver/src/inbox"

export const uri = "http://127.0.0.1:3000"
export const databaseName = "app"
export const token = "token"

export const UserId = Schema.String.pipe(Schema.brand("App/UserId"))
export type UserId = typeof UserId.Type

export const UserName = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(64)),
  Schema.brand("App/UserName"),
)
export type UserName = typeof UserName.Type

export const MessageId = Schema.String.pipe(Schema.brand("App/MessageId"))
export type MessageId = typeof MessageId.Type

export const ShortString = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

export const userId = UserId.make("u1")
export const name = UserName.make("Ada")
export const messageId = MessageId.make("m1")

export const user = Stdb.table("user", {
  public: true,
  columns: {
    id: Stdb.string(UserId).primaryKey(),
    name: Stdb.string(UserName),
  },
  indexes: (c) => [Stdb.index("byName", [c.name])],
})

export const membership = Stdb.table("membership", {
  public: false,
  columns: {
    tenantId: ShortString,
    email: ShortString,
  },
  indexes: (c) => [
    Stdb.index("byTenantEmail", [c.tenantId, c.email]),
    Stdb.index("byEmailTenant", [c.email, c.tenantId]),
  ],
  constraints: (c) => [Stdb.unique("tenantEmailUnique", [c.tenantId, c.email])],
})

export const message = Stdb.table("message", {
  public: true,
  columns: {
    id: Stdb.string(MessageId).primaryKey(),
    text: Stdb.string(),
  },
})

export const audit = Stdb.table("audit", {
  public: true,
  columns: {
    id: Stdb.u64().primaryKey().autoInc(),
    owner: Stdb.identity(),
    timestamp: Stdb.timestamp(),
  },
  indexes: [Stdb.index("byOwnerTimestamp", ["owner", "timestamp"])],
})

export const presenceEvent = Stdb.table("presenceEvent", {
  public: true,
  event: true,
  columns: {
    userId: Stdb.string(UserId),
  },
})

export const reminderSchedule = Stdb.scheduledTable("reminderSchedule", {
  columns: {
    note: Stdb.string(),
  },
})

export const userTables = [
  user,
  membership,
  message,
  audit,
  presenceEvent,
  reminderSchedule,
] as const

export const AppErrors = Stdb.errors.namespace("App")({
  UserMissing: Stdb.error({ userId: Stdb.string(UserId) }, { status: 404 }),
})

export class AuthError extends Schema.TaggedError<AuthError>()(
  "AuthError",
  {},
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  {},
) {}

export const UserIdParams = Stdb.struct({ userId: Stdb.string(UserId) })
export const UserRow = user.row

export const RotateTokenInput = Schema.Struct({ userId: UserId })
export const RotateTokenOutput = Schema.Struct({ token: Schema.String })
export const PingInput = Schema.Struct({ value: Schema.String })

export const Users = Stdb.Group.make("Users")
  .add(
    Stdb.Fn.reducer("userUpsert", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
        name: Stdb.string(UserName),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("userRequire", {
      params: UserIdParams,
      errors: AppErrors,
    }),
  )
  .add(
    Stdb.Fn.procedure("userGet", {
      params: UserIdParams,
      returns: Stdb.option(user.row),
      errors: AppErrors,
    }),
  )
  .add(Stdb.Fn.view("selfUser", { returns: Stdb.option(user.row) }))
  .add(Stdb.Fn.anonymousView("allUsers", { returns: Stdb.array(user.row) }))

export const WebhookRoutes = Stdb.HttpGroup.make("Webhooks")
  .prefix("/webhooks")
  .add(Stdb.Http.post("stripeWebhook", "/stripe"))
  .merge(
    Stdb.HttpGroup.make("ServerTokens")
      .prefix("/server-tokens")
      .add(
        Stdb.Http.post("rotateToken", "/rotate", {
          request: RotateTokenInput,
          response: RotateTokenOutput,
          errors: AppErrors,
        }),
      )
      .add(
        Stdb.Http.any("pingAny", "/ping", {
          request: PingInput,
          response: PingInput,
        }),
      ),
  )

export const Reminders = Stdb.Group.make("Reminders").add(
  Stdb.Fn.scheduledProcedure("reminderFire", { table: reminderSchedule }),
)

export const Lifecycle = {
  init: Stdb.Fn.init(),
  clientConnected: Stdb.Fn.clientConnected(),
  clientDisconnected: Stdb.Fn.clientDisconnected(),
}

export const Module = Stdb.Module.make("app", { lifecycle: Lifecycle })
  .addTables(...userTables)
  .add(Users)
  .add(Reminders)
  .add(WebhookRoutes)

export const {
  AnonymousViewCtx,
  Db,
  From,
  Http,
  HttpHandlerCtx,
  HttpTx,
  MutationCtx,
  ProcedureCtx,
  ReadonlyDb,
  ReducerCtx,
  Tx,
  ViewCtx,
} = Module

export const Example = Stdb.project(Module)

export const userHandlers: Stdb.GroupCheckedHandlers<typeof Module, "Users"> = {
  userUpsert: Effect.fn(function* (args) {
    const db = yield* Db
    yield* db.user.insert({ id: args.userId, name: args.name })
  }),
  userRequire: Effect.fn(function* (args) {
    const db = yield* Db
    yield* db.user.id.findOrFail(args.userId, (id) =>
      AppErrors.UserMissing.make({ userId: id }),
    )
  }),
  userGet: Effect.fn(function* (args) {
    const tx = yield* Tx
    return yield* tx.run(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* db.user.id.find(args.userId)
      }),
    )
  }),
  selfUser: Effect.fn(function* () {
    const db = yield* ReadonlyDb
    const users = yield* db.user.toArray()
    return users[0]
  }),
  allUsers: Effect.fn(function* () {
    const db = yield* ReadonlyDb
    return yield* db.user.toArray()
  }),
}

export const UsersLive = Stdb.Builder.groupPrechecked(
  Module,
  "Users",
  userHandlers,
)

export const RemindersLive = Stdb.Builder.group(Module, "Reminders", {
  reminderFire: () => Effect.void,
})

export const LifecycleLive = Stdb.Builder.lifecycle(Module, {
  init: () => Effect.void,
  clientConnected: () => Effect.void,
  clientDisconnected: () => Effect.void,
})

export const WebhookRoutesLive = Stdb.Builder.group(Module, "Webhooks", {
  stripeWebhook: (request) =>
    Effect.succeed(new Stdb.SyncResponse(request.text(), { status: 202 })),
  rotateToken: () => Effect.succeed({ token: "rotated" }),
  pingAny: (args) => Effect.succeed(args),
})

const WorldConnectionStub = {
  builder: () => {
    throw new Error("The documentation's DbConnection never connects")
  },
}

/** Generated by `spacetime generate`; the samples only pass it along. */
export const DbConnection =
  WorldConnectionStub as unknown as StdbClient.GeneratedWsConnectionFactory<
    typeof Module.spec,
    ErrorContext
  >
export type ErrorContext = unknown

/** Inside a handler or a client program, from the page's surrounding code. */
export declare const db: StdbServer.EffectDbView<typeof Module.spec>
export declare const session: StdbClient.WsSession<typeof Module.spec>
export declare const client: ReturnType<typeof Example.client.http.make>
export declare const owner: Identity
export declare const since: Timestamp
export declare const apiKey: string
export declare const email: string
export declare const tenantId: string
export declare const payload: string
export declare const signature: string

export const fetchFreshToken = Effect.succeed("fresh-token")
export const registerPresence = (
  _session: StdbClient.WsSession<typeof Module.spec>,
) => Effect.void
export const requireSystemAuth = Effect.void

export class MyService extends Context.Service<
  MyService,
  { readonly greeting: string }
>()("effect-spacetimedb/test/fixtures/doc-sample-world/MyService") {}
export const myServiceImpl = { greeting: "hello" }
export const MyServiceLive = Layer.succeed(MyService, myServiceImpl)

export class AppDefect extends Data.TaggedError("AppDefect") {}

export const connectionAtom = Atom.make(
  AsyncResult.initial<StdbClient.WsSession<typeof Module.spec>, never>(),
)
