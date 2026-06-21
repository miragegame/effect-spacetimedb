// lint-ignore: stdb-string-columns-require-domain - interop typecheck fixture intentionally exercises raw STDB schema constructors
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as HttpApi from "effect/unstable/httpapi/HttpApi"
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient"
import * as Stdb from "effect-spacetimedb"
import type { Assert, ErrorOf, IsEqual } from "./helpers"

type SuccessOf<T extends Effect.Effect<unknown, unknown, unknown>> =
  T extends Effect.Effect<infer A, unknown, unknown> ? A : never
const emptyWireNames: Stdb.AnyModuleSpec["wireNames"] = {
  tables: {},
  views: {},
  functions: {},
}
const withWireNames = <
  const Module extends Omit<Stdb.AnyModuleSpec, "wireNames">,
>(
  module: Module,
): Module & Pick<Stdb.AnyModuleSpec, "wireNames"> => ({
  ...module,
  wireNames: emptyWireNames,
})

class ProjectionMissing extends Schema.TaggedErrorClass<ProjectionMissing>()(
  "ProjectionMissing",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

class ProjectionInvalid extends Schema.TaggedErrorClass<ProjectionInvalid>()(
  "ProjectionInvalid",
  { reason: Schema.String },
  { httpApiStatus: 400 },
) {}

class ProjectionConflict extends Schema.TaggedErrorClass<ProjectionConflict>()(
  "ProjectionConflict",
  { resource: Schema.String },
  { httpApiStatus: 409 },
) {}

const ProjectionErrors = Stdb.errors(
  ProjectionMissing,
  ProjectionInvalid,
  ProjectionConflict,
)

const RotateTokenRequest = Schema.Struct({
  scenario: Schema.String,
})

const RotateTokenResponse = Schema.Struct({
  token: Schema.String,
})

const IssueTokenRequest = Schema.Struct({
  userId: Schema.String,
})

const IssueTokenResponse = Schema.Struct({
  issued: Schema.Boolean,
})

const CreateWidgetRequest = Schema.Struct({
  name: Schema.String,
})

const CreateWidgetResponse = Schema.Struct({
  widgetId: Schema.String,
})

const WebhooksGroup = Stdb.StdbHttpGroup.make("Webhooks").add(
  Stdb.StdbHttp.post("rotateToken", "/server-tokens/rotate", {
    request: RotateTokenRequest,
    response: RotateTokenResponse,
    errors: ProjectionErrors,
  }),
  Stdb.StdbHttp.post("issue_token", "/server-tokens/issue", {
    request: IssueTokenRequest,
    response: IssueTokenResponse,
  }),
  Stdb.StdbHttp.post("raw_webhook", "/webhook"),
  Stdb.StdbHttp.any("typed_any", "/typed-any", {
    request: RotateTokenRequest,
    response: RotateTokenResponse,
  }),
  Stdb.StdbHttp.get("typed_get", "/typed-get", {
    request: RotateTokenRequest,
    response: RotateTokenResponse,
  }),
)

const AdminGroup = Stdb.StdbHttpGroup.make("Admin").add(
  Stdb.StdbHttp.post("create_widget", "/admin/widgets", {
    request: CreateWidgetRequest,
    response: CreateWidgetResponse,
  }),
)

const NonProjectableGroup = Stdb.StdbHttpGroup.make("Diagnostics").add(
  Stdb.StdbHttp.get("health", "/health", {
    request: Schema.Struct({ verbose: Schema.Boolean }),
    response: Schema.Struct({ ok: Schema.Boolean }),
  }),
)

const ProjectionModule = Stdb.StdbModule.make(
  "http_api_projection_typecheck",
  {},
).add(WebhooksGroup, AdminGroup, NonProjectableGroup).spec

const api = Stdb.toHttpApi(ProjectionModule)
const _httpApi: HttpApi.Any = api
const _projectedApi: Stdb.ProjectedHttpApi<typeof ProjectionModule> = api

type ProjectionClient = HttpApiClient.ForApi<typeof api>
declare const client: ProjectionClient

const rotateCall = client.Webhooks.rotateToken({
  payload: { scenario: "success" },
})
const issueCall = client.Webhooks.issue_token({
  payload: { userId: "new-user" },
})
const widgetCall = client.Admin.create_widget({
  payload: { name: "widget" },
})

type RotateSuccess = SuccessOf<typeof rotateCall>
type RotateError = ErrorOf<typeof rotateCall>
type DeclaredRotateError = Extract<
  RotateError,
  ProjectionMissing | ProjectionInvalid | ProjectionConflict
>
type IssueSuccess = SuccessOf<typeof issueCall>
type IssueDeclaredError = Extract<
  ErrorOf<typeof issueCall>,
  ProjectionMissing | ProjectionInvalid | ProjectionConflict
>
type WidgetSuccess = SuccessOf<typeof widgetCall>

type _RotateSuccess = Assert<
  IsEqual<RotateSuccess, Schema.Schema.Type<typeof RotateTokenResponse>>
>
type _RotateDeclaredErrors = Assert<
  IsEqual<
    DeclaredRotateError,
    ProjectionMissing | ProjectionInvalid | ProjectionConflict
  >
>
type _IssueSuccess = Assert<
  IsEqual<IssueSuccess, Schema.Schema.Type<typeof IssueTokenResponse>>
>
type _IssueHasNoDeclaredErrors = Assert<IsEqual<IssueDeclaredError, never>>
type _WidgetSuccess = Assert<
  IsEqual<WidgetSuccess, Schema.Schema.Type<typeof CreateWidgetResponse>>
>

// @ts-expect-error canonical HttpApiClient route calls require a payload property
void client.Webhooks.rotateToken({})

// @ts-expect-error route payload must match the typed STDB request schema
void client.Webhooks.rotateToken({ payload: { scenario: 123 } })

// @ts-expect-error distinct routes preserve their own payload schema
void client.Webhooks.issue_token({ payload: { scenario: "success" } })

// @ts-expect-error routes are nested under their STDB HTTP group
void client.rotateToken({ payload: { scenario: "success" } })

// @ts-expect-error unknown groups are not projected
void client.WrongGroup.rotateToken({ payload: { scenario: "success" } })

// @ts-expect-error routes do not appear under the wrong group
void client.Webhooks.create_widget({ payload: { name: "widget" } })

// @ts-expect-error raw routes are not projected into the canonical HttpApi
void client.Webhooks.raw_webhook({ payload: { scenario: "success" } })

// @ts-expect-error any-method typed routes are not projected into HttpApi
void client.Webhooks.typed_any({ payload: { scenario: "success" } })

// @ts-expect-error no-body typed routes would encode payloads into the URL
void client.Webhooks.typed_get({ payload: { scenario: "success" } })

// @ts-expect-error groups with no projectable routes are omitted
void client.Diagnostics.health({ payload: { verbose: true } })

const MissingGroupSpec = withWireNames({
  kind: "module" as const,
  name: "missing_http_group_typecheck",
  settings: {},
  tables: {},
  views: {},
  reducers: {},
  procedures: {},
  httpHandlers: {
    orphan: Stdb.StdbHttp.post("orphan", "/orphan", {
      request: RotateTokenRequest,
      response: RotateTokenResponse,
    }).spec,
  },
  httpGroups: {},
  lifecycle: {},
})
const missingGroupApi = Stdb.toHttpApi(MissingGroupSpec)
type MissingGroupClient = HttpApiClient.ForApi<typeof missingGroupApi>
type _MissingGroupClientHasNoKeys = Assert<
  IsEqual<keyof MissingGroupClient, never>
>
declare const missingGroupClient: MissingGroupClient
// @ts-expect-error malformed specs without httpGroups entries do not surface routes
void missingGroupClient.orphan({ payload: { scenario: "success" } })

const EmptyModule = Stdb.StdbModule.make("empty_http_api", {}).spec
const emptyApi = Stdb.toHttpApi(EmptyModule)
type EmptyClient = HttpApiClient.ForApi<typeof emptyApi>
type _EmptyClientHasNoKeys = Assert<IsEqual<keyof EmptyClient, never>>

void _httpApi
void _projectedApi
