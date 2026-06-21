import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import * as StdbClient from "effect-spacetimedb/client"
import * as StdbServer from "effect-spacetimedb/server"
import { FullModule } from "../fixtures/full-module"
import type { Assert, IsEqual } from "./helpers"

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

declare const DbConnection: StdbClient.GeneratedWsConnectionFactory<
  typeof FullModule,
  unknown
>
const generatedConfig = StdbClient.GeneratedWs.adapter<
  typeof FullModule,
  unknown,
  unknown
>({
  DbConnection,
  uri: "ws://localhost:3000",
  databaseName: "example",
})
const generatedLayer = Full.client.ws.layerGenerated({
  DbConnection,
  uri: "ws://localhost:3000",
  databaseName: "example",
})
const generatedAdapterLayer = Full.client.ws.layer(generatedConfig)
void generatedConfig
void generatedLayer
void generatedAdapterLayer

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
  const exists: boolean = yield* db.public_api_user.id.exists("user_1" as never)
  const user = yield* db.public_api_user.id.findOrFail(
    "user_1" as never,
    (userId) => PublicApiErrors.UserMissing.make({ userId }),
  )
  void exists
  void user
})
void dbConvenienceProgram
