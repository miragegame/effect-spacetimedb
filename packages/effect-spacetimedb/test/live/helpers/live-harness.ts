import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
  DevServerBinaryError,
  type DevServerError,
  makeDevServer,
  type PublishedModuleRuntime,
} from "effect-spacetimedb/dev-server"
import type {
  AnyModuleSpec,
  ManagedWsConnection,
  RelationHandle,
  WsBuilderConfig,
  WsCallableTransport,
} from "effect-spacetimedb/testing"
import { ClientGeneratedWsAdapter, project } from "effect-spacetimedb/testing"
import * as ExampleGeneratedClient from "effect-spacetimedb/testing/example-client"
import {
  buildModuleWithSpacetime,
  exampleBundlePath,
  exampleModuleProject,
  generateModuleClientWithSpacetime,
  migrationModuleProjects,
  packageRoot,
  requiredSpacetimeCliVersion,
} from "../../../scripts/standalone-helpers.mjs"
import { writeCapturedJson } from "../../helpers/captured-event-codec"
import { testEffectCallbackError } from "../../helpers/effect-errors"
import { makeLiveWebSocket } from "./live-websocket"

class RowsNotReady extends Data.TaggedError("RowsNotReady")<{
  readonly cause: unknown
}> {}

class MissingLiveFunctionWireName extends Data.TaggedError(
  "MissingLiveFunctionWireName",
)<{
  readonly name: string
}> {}

class LiveHarnessConnectionError extends Data.TaggedError(
  "LiveHarnessConnectionError",
)<{
  readonly cause: unknown
}> {}

class LiveAnonymousIdentityHttpError extends Data.TaggedError(
  "LiveAnonymousIdentityHttpError",
)<{
  readonly url: string
  readonly cause: unknown
}> {}

class LiveAnonymousIdentityResponseError extends Data.TaggedError(
  "LiveAnonymousIdentityResponseError",
)<{
  readonly url: string
  readonly status: number
  readonly body: string
}> {}

class LiveAnonymousIdentityDecodeError extends Data.TaggedError(
  "LiveAnonymousIdentityDecodeError",
)<{
  readonly text: string
  readonly cause: unknown
}> {}

export class LiveServerLogReadError extends Data.TaggedError(
  "LiveServerLogReadError",
)<{
  readonly path: string
  readonly cause: unknown
}> {}

export class ExpectedLiveCallRejectionMissing extends Data.TaggedError(
  "ExpectedLiveCallRejectionMissing",
) {}

export class ExpectedLiveCallFailureMissing extends Data.TaggedError(
  "ExpectedLiveCallFailureMissing",
) {}

export class CapturedLiveCallRejected extends Data.TaggedError(
  "CapturedLiveCallRejected",
)<{
  readonly cause: unknown
}> {}

export class CaptureFixtureWriteError extends Data.TaggedError(
  "CaptureFixtureWriteError",
)<{
  readonly cause: unknown
}> {}

type CaptureFixtureCategory = "event-contexts" | "transport-values"

export const CONVERGENCE_TIMEOUT_MS = 10_000
export const LIVE_TEST_TIMEOUT_MS = 180_000

const capturedFixtureRoot = new URL("../../fixtures/captured/", import.meta.url)

const AnonymousIdentityResponse = Schema.Struct({
  identity: Schema.String,
  token: Schema.String,
})

const captureFixturesEnabled = (): boolean =>
  globalThis.process.env.UPDATE_CAPTURES === "1"

export const captureLiveFixture = (
  category: CaptureFixtureCategory,
  name: string,
  value: unknown,
  options: {
    readonly normalizeVolatileLeaves?: boolean
  } = {},
): Effect.Effect<
  void,
  CaptureFixtureWriteError,
  FileSystem.FileSystem | Path.Path
> => {
  if (!captureFixturesEnabled()) {
    return Effect.void
  }

  return writeCapturedJson(
    new URL(`${category}/${name}.json`, capturedFixtureRoot),
    value,
    options,
  ).pipe(Effect.mapError((cause) => new CaptureFixtureWriteError({ cause })))
}

const capturedEventContextInput = (
  value: unknown,
): { readonly event: unknown } =>
  typeof value === "object" && value !== null && "event" in value
    ? {
        event: (value as { readonly event: unknown }).event,
      }
    : {
        event: undefined,
      }

export const captureLiveEventContext = (
  name: string,
  value: unknown,
): Effect.Effect<
  void,
  CaptureFixtureWriteError,
  FileSystem.FileSystem | Path.Path
> =>
  captureLiveFixture("event-contexts", name, capturedEventContextInput(value), {
    normalizeVolatileLeaves: true,
  })

export const captureLiveTransportValue = (
  name: string,
  value: unknown,
): Effect.Effect<
  void,
  CaptureFixtureWriteError,
  FileSystem.FileSystem | Path.Path
> => captureLiveFixture("transport-values", name, value)

type LiveCallableTransport = Required<
  Pick<WsCallableTransport, "callReducerWithParams" | "callProcedureWithParams">
>

export type LiveConnection<Module extends AnyModuleSpec> = ManagedWsConnection<
  Module,
  unknown,
  unknown
> &
  LiveCallableTransport

export type LiveHarness = {
  readonly baseUrl: string
  readonly databaseName: string
  readonly logPath: string
  readonly token: string
  readonly generatedClient: typeof ExampleGeneratedClient
  readonly makeWsConfig: <Module extends AnyModuleSpec>(
    module: Module,
  ) => WsBuilderConfig<Module, unknown>
  readonly makeConnection: <Module extends AnyModuleSpec>(
    module: Module,
  ) => Effect.Effect<
    LiveConnection<Module>,
    LiveHarnessConnectionError,
    Scope.Scope
  >
  readonly makeAnonymousConnection: <Module extends AnyModuleSpec>(
    module: Module,
  ) => Effect.Effect<
    LiveConnection<Module>,
    LiveHarnessConnectionError,
    Scope.Scope
  >
}

export type MigrationLiveHarness = {
  readonly baseUrl: string
  readonly bundlePaths: {
    readonly v1: string
    readonly v2: string
    readonly v3: string
  }
  readonly databaseName: string
  readonly generatedClientDirs: {
    readonly v1: string
    readonly v2: string
    readonly v3: string
  }
  readonly republish: (
    bundlePath: string,
  ) => Effect.Effect<
    void,
    DevServerError,
    ChildProcessSpawner.ChildProcessSpawner
  >
  readonly logPath: string
  readonly token: string
}

const asLiveConnection = <Module extends AnyModuleSpec>(
  _module: Module,
  connection: ManagedWsConnection<Module, unknown, unknown>,
): LiveConnection<Module> => connection as LiveConnection<Module>

export const typedConnection = <Module extends AnyModuleSpec>(
  session: {
    readonly connection: ManagedWsConnection<Module, unknown, unknown>
  },
  module: Module,
): LiveConnection<Module> => asLiveConnection(module, session.connection)

type LiveTestLayerRequirements =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path

export type LiveTestRequirements = LiveTestLayerRequirements | Scope.Scope

const buildExampleModuleBundle = Effect.try({
  try: () => {
    buildModuleWithSpacetime(exampleModuleProject)
  },
  catch: (cause) =>
    new DevServerBinaryError({
      command: "build SpaceTimeDB module bundle",
      cause,
    }),
})

const buildMigrationModuleBundles = Effect.try({
  try: () => {
    for (const project of [
      migrationModuleProjects.v1,
      migrationModuleProjects.v2,
      migrationModuleProjects.v3,
    ]) {
      buildModuleWithSpacetime(project)
      generateModuleClientWithSpacetime(project)
    }
  },
  catch: (cause) =>
    new DevServerBinaryError({
      command: "build SpaceTimeDB migration module bundles",
      cause,
    }),
})

const makeTempResetExampleRuntime: () => Effect.Effect<
  PublishedModuleRuntime,
  DevServerError,
  LiveTestRequirements
> = Effect.fn(function* () {
  const path = yield* Path.Path

  yield* buildExampleModuleBundle
  return yield* makeDevServer({
    bundlePath: exampleBundlePath,
    cwd: packageRoot,
    dbNamePrefix: exampleModuleProject.databaseNamePrefix,
    logDir: path.join(
      packageRoot,
      "node_modules",
      ".cache",
      "effect-spacetimedb-live",
    ),
    versionRequirement: requiredSpacetimeCliVersion,
  })
})

const makeAnonymousIdentityToken = Effect.fn(function* (baseUrl: string) {
  const url = `${baseUrl}/v1/identity`
  const response = yield* HttpClient.post(url).pipe(
    Effect.mapError(
      (cause) => new LiveAnonymousIdentityHttpError({ url, cause }),
    ),
  )
  const text = yield* response.text.pipe(
    Effect.mapError(
      (cause) => new LiveAnonymousIdentityHttpError({ url, cause }),
    ),
  )

  if (response.status < 200 || response.status >= 300) {
    return yield* new LiveAnonymousIdentityResponseError({
      url,
      status: response.status,
      body: text,
    })
  }

  const identity = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(AnonymousIdentityResponse),
  )(text).pipe(
    Effect.mapError(
      (cause) => new LiveAnonymousIdentityDecodeError({ text, cause }),
    ),
  )

  return identity.token
})

const makeLiveHarness = Effect.fn(function* () {
  const runtime = yield* makeTempResetExampleRuntime()
  const generatedClient = ExampleGeneratedClient

  const makeWsConfigWithToken = <Module extends AnyModuleSpec>(
    _module: Module,
    token: string,
  ): WsBuilderConfig<Module, unknown> =>
    ClientGeneratedWsAdapter.generatedConfig<Module, unknown, unknown>({
      DbConnection: generatedClient.DbConnection,
      uri: runtime.baseUrl,
      databaseName: runtime.databaseName,
      token,
      compression: "none",
      createWebSocket: makeLiveWebSocket,
    })

  const makeWsConfig = <Module extends AnyModuleSpec>(
    module: Module,
  ): WsBuilderConfig<Module, unknown> =>
    makeWsConfigWithToken(module, runtime.token)

  const makeConnection = <Module extends AnyModuleSpec>(module: Module) =>
    project(module)
      .client.ws.scoped(makeWsConfig(module))
      .pipe(
        Effect.map((session) => typedConnection(session, module)),
        Effect.mapError((cause) => new LiveHarnessConnectionError({ cause })),
      )

  const makeAnonymousConnection = <Module extends AnyModuleSpec>(
    module: Module,
  ) =>
    makeAnonymousIdentityToken(runtime.baseUrl).pipe(
      // Keep makeAnonymousConnection's required context aligned with makeConnection.
      Effect.provide(FetchHttpClient.layer),
      Effect.flatMap((token) =>
        project(module).client.ws.scoped(makeWsConfigWithToken(module, token)),
      ),
      Effect.map((session) => typedConnection(session, module)),
      Effect.mapError((cause) => new LiveHarnessConnectionError({ cause })),
    )

  return {
    baseUrl: runtime.baseUrl,
    databaseName: runtime.databaseName,
    logPath: runtime.logPath,
    token: runtime.token,
    generatedClient,
    makeWsConfig,
    makeConnection,
    makeAnonymousConnection,
  } satisfies LiveHarness
})

export const liveHarness = makeLiveHarness()

const makeMigrationLiveHarness = Effect.fn(function* () {
  const path = yield* Path.Path

  yield* buildMigrationModuleBundles
  const runtime = yield* makeDevServer({
    bundlePath: migrationModuleProjects.v1.bundlePath,
    cwd: packageRoot,
    dbNamePrefix: migrationModuleProjects.v1.databaseNamePrefix,
    logDir: path.join(
      packageRoot,
      "node_modules",
      ".cache",
      "effect-spacetimedb-live",
    ),
    versionRequirement: requiredSpacetimeCliVersion,
  })

  return {
    baseUrl: runtime.baseUrl,
    bundlePaths: {
      v1: migrationModuleProjects.v1.bundlePath,
      v2: migrationModuleProjects.v2.bundlePath,
      v3: migrationModuleProjects.v3.bundlePath,
    },
    databaseName: runtime.databaseName,
    generatedClientDirs: {
      v1: migrationModuleProjects.v1.generatedClientDir,
      v2: migrationModuleProjects.v2.generatedClientDir,
      v3: migrationModuleProjects.v3.generatedClientDir,
    },
    logPath: runtime.logPath,
    republish: runtime.republish,
    token: runtime.token,
  } satisfies MigrationLiveHarness
})

export const migrationLiveHarness = makeMigrationLiveHarness()

export const callLiveReducer = (
  connection: Pick<LiveCallableTransport, "callReducerWithParams">,
  name: string,
  args: object,
) =>
  Effect.tryPromise({
    try: () => connection.callReducerWithParams(name, undefined, args),
    catch: testEffectCallbackError(
      "interop/effect-spacetimedb/helpers/live-harness",
    ),
  })

export const sendLiveReducer = (
  connection: Pick<LiveCallableTransport, "callReducerWithParams">,
  name: string,
  args: object,
) =>
  Effect.try({
    try: () => {
      // SpaceTimeDB 2.5 reducer promises can lag behind cache updates here; the
      // schedule tests assert the observable rows instead of awaiting this call.
      void connection
        .callReducerWithParams(name, undefined, args)
        .catch(() => undefined)
    },
    catch: testEffectCallbackError(
      "interop/effect-spacetimedb/helpers/live-harness",
    ),
  })

export const callLiveProcedure = <A = unknown>(
  connection: Pick<LiveCallableTransport, "callProcedureWithParams">,
  name: string,
  args: object,
) =>
  Effect.tryPromise({
    try: async () =>
      (await connection.callProcedureWithParams(
        name,
        undefined,
        args,
        undefined,
      )) as A,
    catch: testEffectCallbackError(
      "interop/effect-spacetimedb/helpers/live-harness",
    ),
  })

export const expectRejectedLiveCall = (
  call: () => Promise<unknown>,
): Effect.Effect<
  unknown,
  ExpectedLiveCallRejectionMissing | ExpectedLiveCallFailureMissing
> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      Effect.tryPromise({
        try: call,
        catch: (cause) => new CapturedLiveCallRejected({ cause }),
      }),
    )

    if (Exit.isSuccess(exit)) {
      return yield* new ExpectedLiveCallRejectionMissing()
    }

    const failure = exit.cause.pipe(
      Cause.findErrorOption,
      Option.getOrUndefined,
    )
    if (failure === undefined) {
      return yield* new ExpectedLiveCallFailureMissing()
    }
    if (!(failure instanceof CapturedLiveCallRejected)) {
      return yield* new ExpectedLiveCallFailureMissing()
    }

    return failure.cause
  })

export const callLiveReducerExpectingRejection = (
  connection: Pick<LiveCallableTransport, "callReducerWithParams">,
  name: string,
  args: object,
) =>
  expectRejectedLiveCall(() =>
    connection.callReducerWithParams(name, undefined, args),
  )

export const liveCallErrorName = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof (value as { readonly name?: unknown }).name === "string"
    ? (value as { readonly name: string }).name
    : undefined

export const readLiveServerLog = (
  logPath: string,
): Effect.Effect<string, LiveServerLogReadError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(logPath).pipe(
      Effect.mapError(
        (cause) =>
          new LiveServerLogReadError({
            path: logPath,
            cause,
          }),
      ),
    )
  })

export const waitForLiveServerLog = (
  logPath: string,
  expectedText: string,
  message = "SpaceTimeDB standalone log did not contain the expected text before the live test timeout",
) =>
  Effect.gen(function* () {
    const maxAttempts = CONVERGENCE_TIMEOUT_MS / 100
    for (let attempt = 0; attempt < maxAttempts; attempt = attempt + 1) {
      const text = yield* readLiveServerLog(logPath)
      if (text.includes(expectedText)) {
        return text
      }
      yield* Effect.sleep(Duration.millis(100))
    }

    return yield* new RowsNotReady({ cause: message })
  })

export const liveFunctionName = (
  module: Pick<AnyModuleSpec, "wireNames">,
  name: string,
) => {
  const wireName = module.wireNames.functions[name]
  if (wireName === undefined) {
    throw new MissingLiveFunctionWireName({ name })
  }
  return wireName
}

export const waitForRows = <Row, E>(
  rows: () => Effect.Effect<ReadonlyArray<Row>, E>,
  predicate: (rows: ReadonlyArray<Row>) => boolean,
  message = "Rows did not converge before the live test timeout",
) =>
  Effect.gen(function* () {
    const maxAttempts = CONVERGENCE_TIMEOUT_MS / 100
    for (let attempt = 0; attempt < maxAttempts; attempt = attempt + 1) {
      const value = yield* rows()
      if (!predicate(value)) {
        yield* Effect.sleep(Duration.millis(100))
        continue
      }
      return value
    }

    return yield* new RowsNotReady({ cause: message })
  })

const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const CommandLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(PlatformLayer),
)

export const LiveTestLayer = Layer.mergeAll(
  PlatformLayer,
  CommandLayer,
  FetchHttpClient.layer,
)

export const provideLiveTest = <A, E>(
  effect: Effect.Effect<A, E, LiveTestRequirements>,
) => effect.pipe(Effect.scoped, Effect.provide(LiveTestLayer))

export type { RelationHandle }
