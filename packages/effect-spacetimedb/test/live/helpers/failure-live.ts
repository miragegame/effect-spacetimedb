import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Path from "effect/Path"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as HttpBody from "effect/http/HttpBody"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import {
  DevServerBinaryError,
  makeDevServer,
  type PublishedModuleRuntime,
} from "effect-spacetimedb/dev-server"
import {
  buildModuleWithSpacetime,
  packageRoot,
  requiredSpacetimeCliVersion,
} from "../../../scripts/standalone-helpers.mjs"

const fixtureProject = (name: string) => {
  const moduleRoot = `${packageRoot}/examples/${name}/module`
  return {
    moduleRoot,
    bundlePath: `${moduleRoot}/dist/bundle.js`,
    databaseNamePrefix: `effect-spacetimedb-${name}`,
  }
}

const logDir = (path: Path.Path) =>
  path.join(packageRoot, ".tmp", "effect-spacetimedb-live")

const buildFixture = (project: ReturnType<typeof fixtureProject>) =>
  Effect.try({
    try: () => buildModuleWithSpacetime(project),
    catch: (cause) =>
      new DevServerBinaryError({
        command: "build SpaceTimeDB failure fixture bundle",
        cause,
      }),
  })

const startFixture = Effect.fn(function* (name: string) {
  const path = yield* Path.Path
  const project = fixtureProject(name)
  yield* buildFixture(project)
  return yield* makeDevServer({
    bundlePath: project.bundlePath,
    cwd: packageRoot,
    dbNamePrefix: project.databaseNamePrefix,
    logDir: logDir(path),
    versionRequirement: requiredSpacetimeCliVersion,
  })
})

/** A standalone server with the failure fixture published. */
export const makeFailureRuntime = startFixture("failure-fixture")

/** Fails with the publish's own output: the fixture's contract is invalid. */
export const publishInvalidContract = startFixture("invalid-contract-fixture")

// These calls take SpacetimeDB's own `/call` route, as a raw client would: what
// the host answers is the subject of the suite, so nothing decodes it first.
export const rawCall = (
  runtime: PublishedModuleRuntime,
  name: string,
  args: ReadonlyArray<unknown>,
) =>
  Effect.flatMap(HttpClient.HttpClient, (http) =>
    http
      .execute(
        HttpClientRequest.bearerToken(runtime.token)(
          HttpClientRequest.post(
            `${runtime.baseUrl.replace(/\/+$/u, "")}/v1/database/${encodeURIComponent(
              runtime.databaseName,
            )}/call/${name}`,
          ).pipe(
            HttpClientRequest.setBody(
              HttpBody.text(encodeArgs(args), "application/json"),
            ),
          ),
        ),
      )
      .pipe(
        Effect.flatMap((response) =>
          Effect.map(response.text, (body) => ({
            status: response.status,
            body,
          })),
        ),
      ),
  )

const encodeArgs = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
)

class ModuleLogNotReady extends Data.TaggedError("ModuleLogNotReady")<{
  readonly expected: string
}> {}

const moduleLogPollCountMax = 100

/** The database's module log, as `spacetime logs` reads it. */
export const readModuleLog = (runtime: PublishedModuleRuntime) =>
  Effect.flatMap(HttpClient.HttpClient, (http) =>
    http
      .execute(
        HttpClientRequest.bearerToken(runtime.token)(
          HttpClientRequest.get(
            `${runtime.baseUrl.replace(/\/+$/u, "")}/v1/database/${encodeURIComponent(
              runtime.databaseName,
            )}/logs?num_lines=1000`,
          ),
        ),
      )
      .pipe(Effect.flatMap((response) => response.text)),
  )

/** Waits for a line a scheduled call writes after its caller has returned. */
export const waitForModuleLog = (
  runtime: PublishedModuleRuntime,
  expected: string,
) =>
  readModuleLog(runtime).pipe(
    Effect.flatMap((log) =>
      log.includes(expected)
        ? Effect.succeed(log)
        : Effect.fail(new ModuleLogNotReady({ expected })),
    ),
    Effect.retry({
      schedule: Schedule.spaced(Duration.millis(100)),
      times: moduleLogPollCountMax,
      while: (error) => error instanceof ModuleLogNotReady,
    }),
  )
