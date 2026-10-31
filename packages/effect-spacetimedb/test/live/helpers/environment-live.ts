import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as HttpBody from "effect/http/HttpBody"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import {
  DevServerBinaryError,
  type DevServerEnvironmentValues,
  makeDevServer,
  type PublishedModuleRuntime,
} from "effect-spacetimedb/dev-server"
import { EnvironmentModule } from "../../../examples/environment-fixture/module/src/contract"
import {
  buildModuleWithSpacetime,
  packageRoot,
  requiredSpacetimeCliVersion,
} from "../../../scripts/standalone-helpers.mjs"

export class EnvironmentLiveHttpError extends Data.TaggedError(
  "EnvironmentLiveHttpError",
)<{
  readonly request: string
  readonly status: number
  readonly body: string
}> {}

const environmentModuleRoot = `${packageRoot}/examples/environment-fixture/module`

export const environmentModuleProject = {
  moduleRoot: environmentModuleRoot,
  bundlePath: `${environmentModuleRoot}/dist/bundle.js`,
  databaseNamePrefix: "effect-spacetimedb-environment",
}

let environmentBundleBuilt = false

/** Builds the fixture bundle once per test file; later calls reuse it. */
export const ensureEnvironmentBundle = Effect.suspend(() =>
  environmentBundleBuilt
    ? Effect.void
    : Effect.try({
        try: () => {
          buildModuleWithSpacetime(environmentModuleProject)
          environmentBundleBuilt = true
        },
        catch: (cause) =>
          new DevServerBinaryError({
            command: "build SpaceTimeDB environment fixture bundle",
            cause,
          }),
      }),
)

/** Starts a standalone server and publishes the fixture with `environment`. */
export const makeEnvironmentRuntime = Effect.fn(function* (
  environment: DevServerEnvironmentValues,
) {
  const path = yield* Path.Path
  yield* ensureEnvironmentBundle
  return yield* makeDevServer({
    bundlePath: environmentModuleProject.bundlePath,
    cwd: packageRoot,
    dbNamePrefix: environmentModuleProject.databaseNamePrefix,
    environment,
    logDir: path.join(packageRoot, ".tmp", "effect-spacetimedb-live"),
    versionRequirement: requiredSpacetimeCliVersion,
  })
})

type EnvironmentFunctionName =
  | Extract<keyof (typeof EnvironmentModule.spec)["reducers"], string>
  | Extract<keyof (typeof EnvironmentModule.spec)["procedures"], string>

const wireFunction = (name: EnvironmentFunctionName): string =>
  EnvironmentModule.spec.wireNames.functions[name] ?? name

const viewWireName =
  EnvironmentModule.spec.wireNames.views.environmentView ?? "environmentView"

// These helpers probe SpacetimeDB's own database HTTP routes (`/call`,
// `/sql`, `/route`) as a publisher or operator would; the paths are the
// host's wire, so they are spelled out rather than derived from a contract.
const databaseUrl = (runtime: PublishedModuleRuntime, suffix: string) =>
  `${runtime.baseUrl.replace(/\/+$/u, "")}/v1/database/${encodeURIComponent(
    runtime.databaseName,
  )}${suffix}`

const execute = (
  runtime: PublishedModuleRuntime,
  label: string,
  request: HttpClientRequest.HttpClientRequest,
) =>
  Effect.flatMap(HttpClient.HttpClient, (http) =>
    http.execute(HttpClientRequest.bearerToken(runtime.token)(request)).pipe(
      Effect.flatMap((response) =>
        Effect.map(response.text, (body) => ({
          status: response.status,
          body,
        })),
      ),
    ),
  ).pipe(
    Effect.flatMap((response) =>
      response.status >= 200 && response.status < 300
        ? Effect.succeed(response.body)
        : Effect.fail(
            new EnvironmentLiveHttpError({
              request: label,
              status: response.status,
              body: response.body,
            }),
          ),
    ),
  )

const postJson = (
  runtime: PublishedModuleRuntime,
  suffix: string,
  body: string,
  contentType: string,
) => {
  const url = databaseUrl(runtime, suffix)
  return execute(
    runtime,
    `POST ${suffix}`,
    HttpClientRequest.post(url).pipe(
      HttpClientRequest.setBody(HttpBody.text(body, contentType)),
    ),
  )
}

const decodeJsonString = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.String),
)
const encodeStringArgs = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.String)),
)

const SqlResults = Schema.Struct({
  rows: Schema.Unknown.pipe(Schema.Array, Schema.Array),
}).pipe(Schema.Array, Schema.fromJsonString)
const decodeSqlResults = Schema.decodeUnknownEffect(SqlResults)

/** Calls a reducer over HTTP; its effects are observed through SQL. */
export const callReducer = (
  runtime: PublishedModuleRuntime,
  name: EnvironmentFunctionName,
  args: ReadonlyArray<string>,
) =>
  postJson(
    runtime,
    `/call/${wireFunction(name)}`,
    encodeStringArgs(args),
    "application/json",
  ).pipe(Effect.asVoid)

/** Calls a string-returning procedure over HTTP. */
export const callProcedure = (
  runtime: PublishedModuleRuntime,
  name: EnvironmentFunctionName,
) =>
  postJson(
    runtime,
    `/call/${wireFunction(name)}`,
    "[]",
    "application/json",
  ).pipe(Effect.flatMap(decodeJsonString))

const sqlRows = (runtime: PublishedModuleRuntime, query: string) =>
  postJson(runtime, "/sql", query, "text/plain").pipe(
    Effect.flatMap(decodeSqlResults),
    Effect.map((results) => results.flatMap((result) => result.rows)),
  )

const descriptionsOf = (rows: ReadonlyArray<ReadonlyArray<unknown>>) =>
  rows.map((row) => ({ source: row[0], description: row[1] }))

/** The `observation` row a callable recorded under `source`. */
export const observation = (runtime: PublishedModuleRuntime, source: string) =>
  sqlRows(runtime, `SELECT * FROM observation WHERE source = '${source}'`).pipe(
    Effect.map(descriptionsOf),
  )

/** The environment view's rows, read through SQL like a table. */
export const viewRows = (runtime: PublishedModuleRuntime) =>
  sqlRows(runtime, `SELECT * FROM ${viewWireName}`).pipe(
    Effect.map(descriptionsOf),
  )

/** The body the fixture's HTTP handler answers `GET /environment` with. */
export const routeText = (runtime: PublishedModuleRuntime) => {
  const url = databaseUrl(runtime, "/route/environment")
  return execute(runtime, "GET /route/environment", HttpClientRequest.get(url))
}

/** What the fixture reports for a set of values; the secret prints redacted. */
export const describedAs = (values: {
  readonly greeting: string
  readonly apiKey: string
  readonly mode: string
  readonly region?: string
}) =>
  [
    `greeting=${values.greeting}`,
    `apiKey=${values.apiKey}`,
    "shown=<redacted:API_KEY>",
    `mode=${values.mode}`,
    `region=${values.region ?? "<absent>"}`,
  ].join(";")
