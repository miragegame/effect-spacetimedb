import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

const UserId = Stdb.string(Schema.String.pipe(Schema.brand("GroupedUserId")))
type UserId = typeof UserId.Type

const UserName = Stdb.string()
const groupedUser = Stdb.table("grouped_user", {
  public: true,
  columns: {
    id: UserId.primaryKey(),
    name: UserName,
  },
})

class GroupedMissing extends Schema.TaggedErrorClass<GroupedMissing>()(
  "GroupedMissing",
  {
    userId: UserId.schema,
  },
  { httpApiStatus: 404 },
) {}

class GroupedUnexpected extends Schema.TaggedErrorClass<GroupedUnexpected>()(
  "GroupedUnexpected",
  {},
) {}

const GroupedErrors = Stdb.errors(GroupedMissing)

const UserFunctions = Stdb.StdbGroup.make("User")
  .add(
    Stdb.StdbFn.reducer("create_user", {
      params: Stdb.struct({
        id: UserId,
        name: UserName,
      }),
      errors: GroupedErrors,
    }),
  )
  .add(
    Stdb.StdbFn.procedure("read_user", {
      params: Stdb.struct({
        id: UserId,
      }),
      returns: groupedUser.row,
      errors: GroupedErrors,
    }),
  )
  .add(
    Stdb.StdbFn.view("self_users", {
      returns: Stdb.array(groupedUser.row),
    }),
  )
  .add(
    Stdb.StdbFn.anonymousView("allUsers", {
      returns: Stdb.array(groupedUser.row),
    }),
  )
  .add(Stdb.StdbFn.init())

const HttpRoutes = Stdb.StdbHttpGroup.make("Http")
  .prefix("/api")
  .add(Stdb.StdbHttp.post("raw_upload", "/upload"))
  .add(
    Stdb.StdbHttp.post("rotateToken", "/rotate", {
      request: Schema.Struct({ id: UserId.schema }),
      response: Schema.Struct({ ok: Schema.Boolean }),
      errors: GroupedErrors,
    }),
  )

const MatrixModule = Stdb.StdbModule.make("grouped_matrix", {})
  .addTables(groupedUser)
  .add(UserFunctions)
  .add(HttpRoutes)

const {
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
  TxCtx,
  ViewCtx,
} = MatrixModule

const UserFunctionsLive = Stdb.StdbBuilder.group(MatrixModule, "User", {
  create_user: Effect.fn(function* ({ id, name }) {
    const db = yield* Db
    const ctx = yield* ReducerCtx
    const mutation = yield* MutationCtx
    void ctx.sender
    void ctx.databaseIdentity
    void mutation.databaseIdentity
    void mutation.identity
    yield* db.grouped_user.insert({ id, name })
  }),
  read_user: Effect.fn(function* ({ id }) {
    const http = yield* Http
    const tx = yield* Tx
    const ctx = yield* ProcedureCtx
    void http
    void ctx.sender
    return yield* tx.run(
      Effect.gen(function* () {
        const db = yield* Db
        const txCtx = yield* TxCtx
        const mutation = yield* MutationCtx
        void txCtx
        void mutation.timestamp
        return yield* db.grouped_user.id.findOrFail(id, (userId) =>
          GroupedMissing.make({ userId }),
        )
      }),
    )
  }),
  self_users: () =>
    Effect.gen(function* () {
      const db = yield* ReadonlyDb
      const from = yield* From
      const ctx = yield* ViewCtx
      void from.grouped_user
      void ctx.sender
      return yield* db.grouped_user.toArray()
    }),
  allUsers: () =>
    Effect.gen(function* () {
      const db = yield* ReadonlyDb
      const from = yield* From
      const ctx = yield* AnonymousViewCtx
      void from.grouped_user
      void ctx
      return yield* db.grouped_user.toArray()
    }),
  init: () =>
    Effect.gen(function* () {
      const db = yield* Db
      const ctx = yield* ReducerCtx
      const mutation = yield* MutationCtx
      void db.grouped_user
      void ctx.sender
      void mutation.senderAuth
    }),
})

const HttpRoutesLive = Stdb.StdbBuilder.group(MatrixModule, "Http", {
  raw_upload: (_request: Stdb.Request) =>
    Effect.succeed(new Stdb.SyncResponse("accepted", { status: 202 })),
  rotateToken: Effect.fn(function* ({ id }) {
    const http = yield* Http
    const httpTx = yield* HttpTx
    const ctx = yield* HttpHandlerCtx
    void http
    void ctx.http
    return yield* httpTx.run(
      Effect.gen(function* () {
        const db = yield* Db
        void (yield* db.grouped_user.id.find(id))
        return { ok: true }
      }),
    )
  }),
})

void build(MatrixModule, [UserFunctionsLive, HttpRoutesLive])

void build(MatrixModule, [UserFunctionsLive, HttpRoutesLive], {
  runtimeMode: "dev-guarded",
})

void build(MatrixModule, [UserFunctionsLive, HttpRoutesLive], {
  // @ts-expect-error runtime-mode-only build options omit runtime rather than passing explicit undefined.
  runtime: undefined,
  runtimeMode: "dev-guarded",
})

// @ts-expect-error build must reject missing group implementations.
void build(MatrixModule, [UserFunctionsLive])

// @ts-expect-error build must reject implementing the same group twice.
void build(MatrixModule, [UserFunctionsLive, UserFunctionsLive, HttpRoutesLive])

// @ts-expect-error every endpoint in a group must be handled.
const IncompleteLive = Stdb.StdbBuilder.group(MatrixModule, "User", {
  create_user: () => Effect.void,
})
void IncompleteLive

const ExtraEndpointLive = Stdb.StdbBuilder.group(MatrixModule, "User", {
  create_user: () => Effect.void,
  read_user: ({ id }) => Effect.fail(GroupedMissing.make({ userId: id })),
  self_users: () => Effect.succeed([]),
  allUsers: () => Effect.succeed([]),
  init: () => Effect.void,
  // @ts-expect-error handler records must not accept unknown endpoint keys.
  unknown_endpoint: () => Effect.void,
})
void ExtraEndpointLive

const CheckedUserFunctionsLive = Stdb.StdbBuilder.groupChecked(
  MatrixModule,
  "User",
  {
    create_user: Effect.fn(function* ({ id, name }) {
      const db = yield* Db
      yield* db.grouped_user.insert({ id, name })
    }),
    read_user: ({ id }) => Effect.fail(GroupedMissing.make({ userId: id })),
    self_users: () => Effect.succeed([]),
    allUsers: () => Effect.succeed([]),
    init: () => Effect.void,
  },
)
void CheckedUserFunctionsLive

const CheckedMissingLive = Stdb.StdbBuilder.groupChecked(
  MatrixModule,
  "User",
  // @ts-expect-error checked groups must handle every endpoint.
  {
    create_user: () => Effect.void,
  },
)
void CheckedMissingLive

const CheckedExtraEndpointLive = Stdb.StdbBuilder.groupChecked(
  MatrixModule,
  "User",
  {
    create_user: () => Effect.void,
    read_user: ({ id }) => Effect.fail(GroupedMissing.make({ userId: id })),
    self_users: () => Effect.succeed([]),
    allUsers: () => Effect.succeed([]),
    init: () => Effect.void,
    // @ts-expect-error checked handler records must not accept unknown keys.
    unknown_endpoint: () => Effect.void,
  },
)
void CheckedExtraEndpointLive

const CheckedWrongParamsLive = Stdb.StdbBuilder.groupChecked(
  MatrixModule,
  "User",
  {
    // @ts-expect-error checked handlers must receive the declared params.
    create_user: (_params: { readonly id: number }) => Effect.void,
    read_user: ({ id }) => Effect.fail(GroupedMissing.make({ userId: id })),
    self_users: () => Effect.succeed([]),
    allUsers: () => Effect.succeed([]),
    init: () => Effect.void,
  },
)
void CheckedWrongParamsLive

const CheckedUndeclaredErrorLive = Stdb.StdbBuilder.groupChecked(
  MatrixModule,
  "User",
  // @ts-expect-error checked handlers may only fail with declared errors.
  {
    create_user: () => Effect.fail(GroupedUnexpected.make()),
    read_user: ({ id }) => Effect.fail(GroupedMissing.make({ userId: id })),
    self_users: () => Effect.succeed([]),
    allUsers: () => Effect.succeed([]),
    init: () => Effect.void,
  },
)
void CheckedUndeclaredErrorLive

const CheckedForbiddenScopeLive = Stdb.StdbBuilder.groupChecked(
  MatrixModule,
  "User",
  // @ts-expect-error checked reducers must not require Http.
  {
    create_user: () => Http,
    read_user: ({ id }) => Effect.fail(GroupedMissing.make({ userId: id })),
    self_users: () => Effect.succeed([]),
    allUsers: () => Effect.succeed([]),
    init: () => Effect.void,
  },
)
void CheckedForbiddenScopeLive

const InvalidHttpShape = Stdb.StdbHttpGroup.make("InvalidHttp").add(
  // @ts-expect-error typed routes must specify both request and response.
  Stdb.StdbHttp.post("request_only", "/request-only", {
    request: Schema.Struct({ id: UserId.schema }),
  }),
)
void InvalidHttpShape

const InvalidHttpHandlers = Stdb.StdbBuilder.group(MatrixModule, "Http", {
  // @ts-expect-error raw HTTP route handlers must return SyncResponse.
  raw_upload: () => Effect.succeed({ ok: true }),
  // @ts-expect-error typed HTTP route handlers receive typed requests.
  rotateToken: (_request: Stdb.Request) =>
    Effect.succeed(new Stdb.SyncResponse("ok")),
})
void InvalidHttpHandlers

// @ts-expect-error reducers must not require Http.
const InvalidReducerScope = Stdb.StdbBuilder.group(MatrixModule, "User", {
  create_user: () => Http,
  read_user: ({ id }) => Effect.fail(GroupedMissing.make({ userId: id })),
  self_users: () =>
    Effect.gen(function* () {
      const db = yield* ReadonlyDb
      return yield* db.grouped_user.toArray()
    }),
  allUsers: () =>
    Effect.gen(function* () {
      const db = yield* ReadonlyDb
      return yield* db.grouped_user.toArray()
    }),
  init: () => Effect.void,
})
void InvalidReducerScope

// @ts-expect-error procedures must not require ambient Db outside Tx.run.
const InvalidProcedureScope = Stdb.StdbBuilder.group(MatrixModule, "User", {
  create_user: () => Effect.void,
  read_user: () =>
    Effect.gen(function* () {
      yield* Db
      return { id: "user_1" as UserId, name: "Ada" }
    }),
  self_users: () =>
    Effect.gen(function* () {
      const db = yield* ReadonlyDb
      return yield* db.grouped_user.toArray()
    }),
  allUsers: () =>
    Effect.gen(function* () {
      const db = yield* ReadonlyDb
      return yield* db.grouped_user.toArray()
    }),
  init: () => Effect.void,
})
void InvalidProcedureScope

// @ts-expect-error views must not require writable Db.
const InvalidViewScope = Stdb.StdbBuilder.group(MatrixModule, "User", {
  create_user: () => Effect.void,
  read_user: ({ id }) => Effect.fail(GroupedMissing.make({ userId: id })),
  self_users: () =>
    Effect.gen(function* () {
      const db = yield* Db
      return yield* db.grouped_user.toArray()
    }),
  allUsers: () =>
    Effect.gen(function* () {
      const db = yield* ReadonlyDb
      return yield* db.grouped_user.toArray()
    }),
  init: () => Effect.void,
})
void InvalidViewScope

// @ts-expect-error HTTP handlers must not require ambient Db outside HttpTx.run.
const InvalidHttpScope = Stdb.StdbBuilder.group(MatrixModule, "Http", {
  raw_upload: (_request: Stdb.Request) =>
    Effect.succeed(new Stdb.SyncResponse("ok")),
  rotateToken: () =>
    Effect.gen(function* () {
      yield* Db
      return { ok: true }
    }),
})
void InvalidHttpScope

class ExtraService extends Context.Service<
  ExtraService,
  {
    readonly value: string
  }
>()(
  "effect-spacetimedb/test/typecheck/grouped-authoring-api.typecheck/ExtraService",
) {}

const RuntimeFunctions = Stdb.StdbGroup.make("Runtime").add(
  Stdb.StdbFn.reducer("needs_runtime", {
    params: Stdb.struct({}),
  }),
)

const RuntimeModule = Stdb.StdbModule.make("runtime_matrix", {}).add(
  RuntimeFunctions,
)

const RuntimeLive = Stdb.StdbBuilder.group(RuntimeModule, "Runtime", {
  needs_runtime: () =>
    Effect.gen(function* () {
      const extra = yield* ExtraService
      void extra.value
    }),
})

// @ts-expect-error build requires a runtime when handlers require custom services.
void build(RuntimeModule, [RuntimeLive])

void build(RuntimeModule, [RuntimeLive], {
  runtime: Layer.succeed(ExtraService, { value: "ok" }),
})

const otherGrouped = Stdb.table("other_grouped", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})

const OtherModule = Stdb.StdbModule.make("other_matrix", {}).addTables(
  otherGrouped,
)
const { Db: OtherDb } = OtherModule

const CrossModuleAccessorSharpEdge = Stdb.StdbBuilder.group(
  MatrixModule,
  "User",
  // @ts-expect-error cross-module accessors are rejected by module identity brands.
  {
    create_user: () =>
      Effect.gen(function* () {
        const otherDb = yield* OtherDb
        void otherDb.other_grouped
      }),
    read_user: ({ id }) => Effect.fail(GroupedMissing.make({ userId: id })),
    self_users: () =>
      Effect.gen(function* () {
        const db = yield* ReadonlyDb
        return yield* db.grouped_user.toArray()
      }),
    allUsers: () =>
      Effect.gen(function* () {
        const db = yield* ReadonlyDb
        return yield* db.grouped_user.toArray()
      }),
    init: () => Effect.void,
  },
)
void CrossModuleAccessorSharpEdge

void Stdb.unit()
