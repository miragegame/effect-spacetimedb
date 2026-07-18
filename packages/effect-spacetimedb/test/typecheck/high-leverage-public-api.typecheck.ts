import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import * as StdbClient from "effect-spacetimedb/client"
import * as StdbServer from "effect-spacetimedb/server"
import { FullModule, UserId as FullUserId } from "../fixtures/full-module"
import type { Assert, Expand, IsEqual } from "./helpers"

const PublicApiString = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(255)),
)
const PublicApiU32 = Schema.Finite.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)
const UserId = Stdb.string(PublicApiString)
const TenantId = Stdb.string(PublicApiString)
const HashIndexedValue = Stdb.string(PublicApiString).index("hash")
const DirectIndexedValue = Stdb.u32(PublicApiU32).index("direct")
const PublicPayload = Stdb.struct({
  userId: UserId,
  tenantId: TenantId,
})
const NamedPublicPayload: typeof PublicPayload =
  PublicPayload.named("PublicPayload")
void NamedPublicPayload

const PublicApiErrors = Stdb.errors.namespace("PublicApi")({
  UserMissing: Stdb.error({
    userId: UserId,
  }),
})
const PublicApiTenantErrors = Stdb.errors.namespace("PublicApi")({
  TenantMissing: Stdb.error({
    tenantId: TenantId,
  }),
})

const userMissing = PublicApiErrors.UserMissing.make({ userId: "user_1" })
const userMissingTag: "PublicApiUserMissing" = userMissing._tag
void userMissingTag
// @ts-expect-error generated declared error classes are construct-only
PublicApiErrors.UserMissing({ userId: "user_1" })
const PublicApiTable = Stdb.table("public_api_user", {
  public: true,
  columns: {
    id: UserId.primaryKey(),
    tenantId: TenantId,
    email: Stdb.string(PublicApiString),
  },
  indexes: (columns) =>
    [
      Stdb.index("public_api_user_tenant_email_idx", [
        columns.tenantId,
        columns.email,
      ]),
    ] as const,
  constraints: (columns) =>
    [
      Stdb.unique("unique_public_api_user_tenant_email", [
        columns.tenantId,
        columns.email,
      ]),
    ] as const,
})

const indexColumns: readonly ["tenantId", "email"] =
  PublicApiTable.indexes[0].columns
const constraintColumns: readonly ["tenantId", "email"] =
  PublicApiTable.constraints[0].columns
type _HashFieldIndex = Assert<
  IsEqual<Stdb.FieldOptionsOf<typeof HashIndexedValue>["index"], "hash">
>
type _DirectFieldIndex = Assert<
  IsEqual<Stdb.FieldOptionsOf<typeof DirectIndexedValue>["index"], "direct">
>
void indexColumns
void constraintColumns
void HashIndexedValue
void DirectIndexedValue

// @ts-expect-error field indexes only accept native SpaceTimeDB index algorithms
void Stdb.string(PublicApiString).index("gist")

// @ts-expect-error table indexes only accept native SpaceTimeDB index algorithms
void Stdb.index("invalid_algorithm", ["tenantId"], { algorithm: "gist" })

const Full = Stdb.project(FullModule)

const MainSession = Full.client.ws.tag("main")
const OtherSession = Full.client.ws.tag("other")
const DefaultSession = Full.client.ws.Session
void MainSession
void OtherSession
void DefaultSession

type PublicGeneratedErrorContext = {
  readonly generatedContext: "public"
}
declare const DbConnection: StdbClient.GeneratedWsConnectionFactory<
  typeof FullModule,
  PublicGeneratedErrorContext
>
type _generatedErrorContextInferred = Assert<
  IsEqual<
    StdbClient.GeneratedErrorContextOf<typeof DbConnection>,
    PublicGeneratedErrorContext
  >
>
const generatedLayer = Full.client.ws.layerGenerated({
  DbConnection,
  uri: "ws://localhost:3000",
  databaseName: "example",
})
const generatedSession = Full.client.ws.tag<PublicGeneratedErrorContext>()
void generatedLayer
void generatedSession

const PublicApiRequire = Stdb.StdbFn.reducer("public_api_require", {
  params: Stdb.struct({
    userId: UserId,
    tenantId: TenantId,
  }),
  errors: [
    PublicApiErrors,
    PublicApiTenantErrors,
    PublicApiTenantErrors.TenantMissing,
  ],
})

const PublicApiFunctions = Stdb.StdbGroup.make("PublicApi")
  .add(
    Stdb.StdbFn.reducer("public_api_upsert", {
      params: Stdb.struct({
        userId: UserId,
        tenantId: TenantId,
        email: Stdb.string(PublicApiString),
      }),
    }),
  )
  .add(PublicApiRequire)
  .add(
    Stdb.StdbFn.procedure("public_api_get", {
      params: Stdb.struct({
        userId: UserId,
      }),
      returns: Stdb.option(PublicApiTable.row),
      errors: PublicApiErrors,
    }),
  )

type PublicApiRequireErrors = NonNullable<typeof PublicApiRequire.spec.errors>
type _arrayErrorsMatchMergedInstances = Assert<
  IsEqual<
    Stdb.ErrorInstances<PublicApiRequireErrors>,
    | InstanceType<typeof PublicApiErrors.UserMissing>
    | InstanceType<typeof PublicApiTenantErrors.TenantMissing>
  >
>

const PublicApiModule = Stdb.StdbModule.make("public_api", {})
  .addTables(PublicApiTable)
  .add(PublicApiFunctions)

const UtilityHttpRequest = Schema.Struct({
  userId: Schema.String,
})
const UtilityHttpResponse = Schema.Struct({
  ok: Schema.Boolean,
})
const UtilityFunctions = Stdb.StdbGroup.make("Utility")
  .add(
    Stdb.StdbFn.reducer("utility_reduce", {
      params: Stdb.struct({
        userId: UserId,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("utility_read", {
      params: Stdb.struct({
        userId: UserId,
      }),
      returns: PublicApiTable.row,
      errors: PublicApiErrors,
    }),
  )
  .add(
    Stdb.StdbFn.view("utility_view", {
      returns: PublicApiTable.row,
    }),
  )
const UtilityHttp = Stdb.StdbHttpGroup.make("UtilityHttp").add(
  Stdb.StdbHttp.post("utility_http", "/utility", {
    request: UtilityHttpRequest,
    response: UtilityHttpResponse,
  }),
)
const UtilityModule = Stdb.StdbModule.make("public_api_utilities", {})
  .addTables(PublicApiTable)
  .add(UtilityFunctions, UtilityHttp)

type UtilityReducerArgs = Stdb.ReducerArgsFor<
  typeof UtilityModule,
  "utility_reduce"
>
type UtilityReducerArgsByModule = Stdb.ReducerArgsFor<
  typeof UtilityModule,
  "utility_reduce"
>
type UtilityProcedureSuccess = Stdb.ProcedureSuccessFor<
  typeof UtilityModule,
  "utility_read"
>
type UtilityProcedureErrors = Stdb.ProcedureErrorsFor<
  typeof UtilityModule,
  "utility_read"
>
type UtilityHttpArgs = Stdb.HttpHandlerArgsFor<
  typeof UtilityModule,
  "utility_http"
>
type UtilityHttpSuccess = Stdb.HttpHandlerSuccessFor<
  typeof UtilityModule,
  "utility_http"
>
type UtilityViewSuccess = Stdb.ViewSuccessFor<
  typeof UtilityModule,
  "utility_view"
>
type _UtilityReducerArgs = Assert<
  IsEqual<Expand<UtilityReducerArgs>, { readonly userId: string }>
>
type _UtilityReducerArgsByModule = Assert<
  IsEqual<UtilityReducerArgsByModule, UtilityReducerArgs>
>
type _UtilityProcedureSuccess = Assert<
  IsEqual<
    Expand<UtilityProcedureSuccess>,
    Expand<Stdb.TableRow<typeof PublicApiTable>>
  >
>
type _UtilityProcedureErrors = Assert<
  IsEqual<
    Expand<
      Extract<
        UtilityProcedureErrors,
        InstanceType<typeof PublicApiErrors.UserMissing>
      >
    >,
    Expand<InstanceType<typeof PublicApiErrors.UserMissing>>
  >
>
type _UtilityHttpArgs = Assert<
  IsEqual<UtilityHttpArgs, Schema.Schema.Type<typeof UtilityHttpRequest>>
>
type _UtilityHttpSuccess = Assert<
  IsEqual<UtilityHttpSuccess, Schema.Schema.Type<typeof UtilityHttpResponse>>
>
type _UtilityViewSuccess = Assert<
  IsEqual<
    Expand<Extract<UtilityViewSuccess, Stdb.TableRow<typeof PublicApiTable>>>,
    Expand<Stdb.TableRow<typeof PublicApiTable>>
  >
>

const utilityReduceDecl = Stdb.declOf(UtilityFunctions, "utility_reduce")
type UtilityReduceDeclSpec = Stdb.DeclSpecOf<
  typeof UtilityFunctions,
  "utility_reduce"
>
type _UtilityReduceDeclParams = Assert<
  IsEqual<
    Expand<Stdb.TypeOf<UtilityReduceDeclSpec["params"]>>,
    { readonly userId: string }
  >
>
const utilityReduceWireName = Stdb.wireNameForDecl(utilityReduceDecl)
const utilityReduceModuleWireName = Stdb.wireNameOf(
  UtilityModule.spec,
  "utility_reduce",
)
const encodedUtilityReduceArgs = Stdb.encodeCallArgs(
  utilityReduceDecl.spec.params,
  { userId: "user_1" },
)
// @ts-expect-error declOf only accepts endpoint names from the selected group.
Stdb.declOf(UtilityFunctions, "missing")
// @ts-expect-error wireNameOf only accepts callable function keys, not views.
Stdb.wireNameOf(UtilityModule.spec, "utility_view")
const invalidEncodedUtilityReduceArgs = Stdb.encodeCallArgs(
  utilityReduceDecl.spec.params,
  // @ts-expect-error encodeCallArgs validates values against the params type.
  {},
)
void utilityReduceWireName
void utilityReduceModuleWireName
void encodedUtilityReduceArgs
void invalidEncodedUtilityReduceArgs

const utilityReduceHandler: Stdb.HandlerFor<
  typeof UtilityModule,
  "Utility",
  "utility_reduce"
> = Effect.fn(function* ({ userId }) {
  void userId
})
const UtilityLive = Stdb.StdbBuilder.group(UtilityModule, "Utility", {
  utility_reduce: utilityReduceHandler,
  utility_read: Effect.fn(function* ({ userId }) {
    return { id: userId, tenantId: "tenant_1", email: "user@example.com" }
  }),
  utility_view: Effect.fn(function* () {
    return { id: "user_1", tenantId: "tenant_1", email: "user@example.com" }
  }),
})
const utilityHandlers = Stdb.StdbBuilder.handlersOf(UtilityModule, UtilityLive)
void utilityHandlers.utility_reduce({ userId: "user_1" })

type _projectBuilderAndSpecReturnEqual = Assert<
  IsEqual<
    ReturnType<typeof Stdb.project<typeof UtilityModule>>,
    ReturnType<typeof Stdb.project<typeof UtilityModule.spec>>
  >
>
const utilityProject: Stdb.ModuleProject<typeof UtilityModule> =
  Stdb.project(UtilityModule)
const utilityHttpCall = utilityProject.client.http
  .make({
    uri: "http://localhost:3000",
    databaseName: "public_api_utilities",
  })
  .httpHandlers.utility_http({ userId: "user_1" })
const utilityClient = utilityProject.client.http.make({
  uri: "http://localhost:3000",
  databaseName: "public_api_utilities",
})
const groupedUtilityReducerCall = utilityClient.Utility.reducers.utility_reduce(
  {
    userId: "user_1",
  },
)
const groupedUtilityProcedureCall =
  utilityClient.Utility.procedures.utility_read({ userId: "user_1" })
const groupedUtilityHttpCall =
  utilityClient.UtilityHttp.httpHandlers.utility_http({ userId: "user_1" })
const scopedUtilityClient = utilityProject.client.http.group("Utility", {
  uri: "http://localhost:3000",
  databaseName: "public_api_utilities",
})
const scopedUtilityReducerCall = scopedUtilityClient.reducers.utility_reduce({
  userId: "user_1",
})
// @ts-expect-error utility_read belongs to Utility, not UtilityHttp.
utilityClient.UtilityHttp.procedures.utility_read({ userId: "user_1" })
// @ts-expect-error scoped Utility clients do not expose UtilityHttp handlers.
scopedUtilityClient.httpHandlers.utility_http({ userId: "user_1" })
const rootHandledHttpCall = utilityHttpCall.pipe(
  Effect.catchTags({
    RemoteRejectedError: (error) => Effect.succeed(error.raw),
    StdbDecodeError: () => Effect.succeed("decode"),
    TransportError: () => Effect.succeed("transport"),
  }),
)
declare const clientOnlyHttp: StdbClient.ProjectedHttpClient<
  (typeof UtilityModule)["spec"]
>
const clientHandledHttpCall = clientOnlyHttp.httpHandlers
  .utility_http({ userId: "user_1" })
  .pipe(
    Effect.catchTags({
      RemoteRejectedError: (error: StdbClient.RemoteRejectedError) =>
        Effect.succeed(error.raw),
      StdbDecodeError: () => Effect.succeed("decode"),
      TransportError: () => Effect.succeed("transport"),
    }),
  )
void rootHandledHttpCall
void clientHandledHttpCall
void groupedUtilityReducerCall
void groupedUtilityProcedureCall
void groupedUtilityHttpCall
void scopedUtilityReducerCall

const declaredHttpHandlerCall = Full.client.http
  .make({ uri: "http://localhost:3000", databaseName: "full" })
  .httpHandlers.rotateToken({
    userId: Schema.decodeUnknownSync(FullUserId)("user_1"),
  })
  .pipe(
    Effect.catchTags({
      UserMissing: (error) => Effect.succeed(error.userId),
    }),
  )
void declaredHttpHandlerCall

const { Db, Http, ProcedureCtx, Tx } = PublicApiModule

const PublicApiLive = Stdb.StdbBuilder.group(PublicApiModule, "PublicApi", {
  public_api_upsert: Effect.fn(function* ({ userId, tenantId, email }) {
    const db = yield* Db
    yield* db.public_api_user.id.replace({ id: userId, tenantId, email })
  }),
  public_api_require: Effect.fn(function* ({ tenantId }) {
    return yield* PublicApiTenantErrors.TenantMissing.make({ tenantId })
  }),
  public_api_get: Effect.fn(function* ({ userId }) {
    const ctx = yield* ProcedureCtx
    const http = yield* Http
    const tx = yield* Tx
    void ctx.sender
    void http.fetch
    return yield* tx.run(
      Effect.gen(function* () {
        const db = yield* Db
        return yield* db.public_api_user.id.find(userId)
      }),
    )
  }),
})

void build(PublicApiModule, [PublicApiLive])

// @ts-expect-error server projection helpers were removed in the clean-break API
void StdbServer.project

const dbConvenienceProgram = Effect.fn(function* () {
  const db = yield* Db
  const exists: boolean = yield* db.public_api_user.id.exists("user_1")
  const user = yield* db.public_api_user.id.findOrFail("user_1", (userId) =>
    PublicApiErrors.UserMissing.make({ userId }),
  )
  void exists
  void user
})
void dbConvenienceProgram
