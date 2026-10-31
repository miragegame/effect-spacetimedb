import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/http/HttpClient"
import * as ChildProcess from "effect/process/ChildProcess"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as CommandLine from "effect/process/CommandLine"
import {
  type ClearMode,
  DevServerBinaryError,
  DevServerCommandError,
  DevServerDatabaseNameInUseError,
  DevServerEnvironmentKeyError,
  DevServerEnvironmentValueError,
  DevServerJsonDecodeError,
  type DevServerEnvironmentValues,
  DevServerReservedEnvironmentKeyError,
  DevServerResponseError,
  makeDevServer,
  makeModuleLifecycle,
} from "effect-spacetimedb/dev-server"
import { makeMockHttpClientLayer } from "../helpers/mock-http-client"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer, { excludeTestServices: true })
const NodeFileSystemPathLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
)

type SpawnRecord = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

class DevServerTestInvariantError extends Data.TaggedError(
  "DevServerTestInvariantError",
)<{
  readonly cause: unknown
}> {}

const textEncoder = new TextEncoder()

const bytes = (text: string) => textEncoder.encode(text)

const streamText = (text: string) =>
  text.length === 0 ? Stream.empty : Stream.succeed(bytes(text))

const makeHandle = (params: {
  readonly all?: string
  readonly exitCode: number
  readonly stderr?: string
  readonly stdout?: string
}) =>
  ChildProcessSpawner.makeHandle({
    all: streamText(params.all ?? ""),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(params.exitCode)),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    pid: ChildProcessSpawner.ProcessId(1),
    stderr: streamText(params.stderr ?? ""),
    stdin: Sink.drain,
    stdout: streamText(params.stdout ?? ""),
    unref: Effect.succeed(Effect.void),
  })

type TestDeclaration = {
  readonly name: string
  /** Omitted: any string. One value pins the key; more form a set. */
  readonly allowed?: ReadonlyArray<string>
  readonly optional?: boolean
}

const extractedType = (allowed: ReadonlyArray<string> | undefined): string =>
  allowed === undefined
    ? `{"String":[]}`
    : allowed.length === 1
      ? `{"StringLiteral":"${allowed[0] ?? ""}"}`
      : `{"Union":[${allowed.map((value) => `"${value}"`).join(",")}]}`

// The schema `spacetimedb-standalone extract-schema` prints for a bundle with
// these declarations (the dev server reads them before every publish).
const extractedSchema = (
  declarations: ReadonlyArray<TestDeclaration>,
): string =>
  `{"V10":{"sections":[{"Environment":[${declarations
    .map(
      (declared) =>
        `{"name":"${declared.name}","ty":${extractedType(declared.allowed)},"optional":${String(declared.optional ?? true)}}`,
    )
    .join(",")}]},{"Tables":[]}]}}`

// Every key the tests supply, as optional strings: the dev server refuses a
// supplied key the bundle does not declare, since the CLI would drop it.
const suppliedKeyDeclarations: ReadonlyArray<TestDeclaration> = [
  { name: "GREETING" },
  { name: "API_KEY" },
  { name: "MODE" },
  { name: "REGION" },
]

// The extractor's output, fixed or per bundle path.
type ExtractorOutput = string | ((bundlePath: string) => string)

/**
 * A spawned command as the child would receive it. Command words and
 * environment values are `string | Redacted<string>`; these fixtures assert
 * on the text, so redacted values are revealed once, here.
 */
type SpawnedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly options: {
    readonly env: Readonly<Record<string, string | undefined>> | undefined
    readonly extendEnv: boolean | undefined
  }
}

const revealWord = (word: CommandLine.Word): string =>
  Redacted.isRedacted(word) ? Redacted.value(word) : word

const spawnedCommand = (
  command: ChildProcess.StandardCommand,
): SpawnedCommand => {
  const env = command.options.env
  return {
    command: command.command,
    args: command.args.map(revealWord),
    options: {
      env:
        env === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(env).map(([name, value]) => [
                name,
                value === undefined ? undefined : revealWord(value),
              ]),
            ),
      extendEnv: command.options.extendEnv,
    },
  }
}

const makeChildProcessLayer = (
  spawn: (command: SpawnedCommand) => ChildProcessSpawner.ChildProcessHandle,
  extractorOutput: ExtractorOutput = extractedSchema(suppliedKeyDeclarations),
) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const standardCommand = spawnedCommand(
        command as ChildProcess.StandardCommand,
      )
      const handle = spawn(standardCommand)
      return Effect.succeed(
        standardCommand.args.includes("extract-schema")
          ? makeHandle({
              exitCode: 0,
              stdout:
                typeof extractorOutput === "string"
                  ? extractorOutput
                  : extractorOutput(standardCommand.args[1] ?? ""),
            })
          : handle,
      )
    }),
  )

// The identity every published database reports in these tests: the dev
// server reads it back after each first publish.
const testDatabaseIdentity = "c2".repeat(32)

const makeIdentityHttpLayer = (params?: { readonly failFirst?: boolean }) => {
  let attempts = 0

  return {
    attempts: () => attempts,
    layer: makeMockHttpClientLayer((request) => {
      if (request.method === "GET") {
        expect(request.url.pathname).toMatch(
          /^\/v1\/database\/[^/]+\/identity$/u,
        )
        return Effect.succeed({ body: testDatabaseIdentity })
      }
      attempts += 1
      expect(request.method).toBe("POST")
      expect(request.url.pathname).toBe("/v1/identity")

      if (params?.failFirst === true && attempts === 1) {
        return Effect.succeed({
          body: "not ready",
          status: 503,
        })
      }

      return Effect.succeed({
        body: JSON.stringify({
          identity: "test-identity",
          token: "test-token",
        }),
      })
    }),
  }
}

const provideDevServerUnitLayers = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  childProcessLayer: Layer.Layer<
    ChildProcessSpawner.ChildProcessSpawner,
    never,
    never
  >,
  httpLayer: Layer.Layer<HttpClient.HttpClient, never, never>,
) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(NodeFileSystemPathLayer, httpLayer, childProcessLayer),
    ),
  )

const failureFrom = <E>(exit: Exit.Exit<unknown, E>) => {
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    return exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined)
  }

  return undefined
}

const publishRecordFrom = Effect.fn(function* (
  records: ReadonlyArray<SpawnRecord>,
) {
  const record = records.find((candidate) => candidate.args.includes("publish"))
  if (record === undefined) {
    return yield* new DevServerTestInvariantError({
      cause: "publish command was not spawned",
    })
  }

  return record
})

const loginRecordFrom = Effect.fn(function* (
  records: ReadonlyArray<SpawnRecord>,
) {
  const record = records.find((candidate) => candidate.args.includes("login"))
  if (record === undefined) {
    return yield* new DevServerTestInvariantError({
      cause: "login command was not spawned",
    })
  }

  return record
})

const cliConfigPathFrom = Effect.fn(function* (record: SpawnRecord) {
  const configArg = record.args.find((arg) => arg.startsWith("--config-path="))
  const configPath = configArg?.slice("--config-path=".length)
  if (configPath === undefined || configPath.length === 0) {
    return yield* new DevServerTestInvariantError({
      cause: "CLI command did not receive an isolated config path",
    })
  }

  return configPath
})

const listenAddrFrom = Effect.fn(function* (record: SpawnRecord) {
  const flagIndex = record.args.indexOf("--listen-addr")
  const listenAddr = record.args[flagIndex + 1]
  if (listenAddr === undefined) {
    return yield* new DevServerTestInvariantError({
      cause: "standalone start did not receive --listen-addr",
    })
  }

  return listenAddr
})

// A shell that already exports a variable named like a declared key, plus
// an unrelated one and an empty one: none may reach the publishing CLI.
const shellProcessEnvironment = {
  PATH: "/test/bin",
  HOME: "/test/home",
  LD_LIBRARY_PATH: "/test/lib",
  TMPDIR: "",
  GREETING: "from-the-shell",
  UNRELATED_SHELL_VARIABLE: "unrelated",
}

// The reserved base variables the shell above sets non-empty: every CLI the
// dev server starts inherits exactly these.
const inheritedBaseEnvironment = {
  PATH: "/test/bin",
  HOME: "/test/home",
  LD_LIBRARY_PATH: "/test/lib",
}

type EnvironmentSpawnRecord = SpawnRecord & {
  readonly extendEnv: boolean | undefined
  readonly env: Readonly<Record<string, string | undefined>> | undefined
}

const recordingChildProcessLayer = (
  records: Array<EnvironmentSpawnRecord>,
  options: {
    readonly publishFailure?: { readonly stderr: string }
    readonly declarations?: ReadonlyArray<TestDeclaration>
    readonly extractorOutput?: ExtractorOutput
    /** Fails the publish with this 1-based ordinal among publishes. */
    readonly failPublishNumber?: number
    /** An `on-conflict` publish needs a manual migration, so it clears. */
    readonly onConflictClears?: boolean
  } = {},
) => {
  let publishes = 0
  return makeChildProcessLayer(
    (command) => {
      records.push({
        args: command.args,
        command: command.command,
        extendEnv: command.options.extendEnv,
        env: command.options.env,
      })
      const publishing = command.args.includes("publish")
      if (publishing) {
        publishes += 1
      }
      if (options.publishFailure !== undefined && publishing) {
        return makeHandle({
          exitCode: 1,
          stderr: options.publishFailure.stderr,
        })
      }
      if (publishing && publishes === options.failPublishNumber) {
        return makeHandle({ exitCode: 1, stderr: "publish refused" })
      }
      // What the 2.12.0 CLI prints when it takes the clearing path.
      return options.onConflictClears === true &&
        command.args.includes("--delete-data=on-conflict")
        ? makeHandle({
            exitCode: 0,
            stdout:
              "Proceeding with database clear due to --delete-data=on-conflict.\n",
          })
        : makeHandle({ exitCode: 0 })
    },
    options.extractorOutput ??
      extractedSchema(options.declarations ?? suppliedKeyDeclarations),
  )
}

// Each spawned command by what it does, in spawn order.
const spawnSteps = (records: ReadonlyArray<EnvironmentSpawnRecord>) =>
  records.map((record) =>
    record.args.includes("extract-schema")
      ? "extract"
      : record.args.includes("delete")
        ? "delete"
        : record.args.includes("--env-only")
          ? "update"
          : record.args.includes("publish")
            ? "publish"
            : record.args.includes("login")
              ? "login"
              : record.args.includes("start")
                ? "start"
                : "other",
  )

const publishRecords = (records: ReadonlyArray<EnvironmentSpawnRecord>) =>
  records.filter((record) => record.args.includes("publish"))

const environmentBundlePath =
  "/tmp/effect-spacetimedb-dev-server-test/bundle.js"

const environmentDevServer = (
  options: {
    readonly republish?: ClearMode
    readonly environment?: DevServerEnvironmentValues
  } = {},
) =>
  makeDevServer({
    binaries: {
      cli: ["spacetime"],
      standalone: ["spacetimedb-standalone"],
    },
    bundlePath: environmentBundlePath,
    dbNamePrefix: "dev-server-test",
    environment: options.environment ?? {
      GREETING: "hello",
      API_KEY: Redacted.make("secret-value-1"),
      MODE: "development",
    },
    processEnvironment: shellProcessEnvironment,
    clear: { republish: options.republish ?? "never" },
  })

// What the environment fixture bundle declares.
const resetDeclarations: ReadonlyArray<TestDeclaration> = [
  { name: "GREETING", optional: false },
  { name: "API_KEY", optional: false },
  { name: "MODE", allowed: ["development", "production"], optional: false },
  { name: "REGION" },
]

// What `makeDevServer` spawns before it returns a runtime.
const startupSteps = ["start", "login", "extract", "publish"]

describe("dev server", (it) => {
  it.effect(
    "publishes a prebuilt bundle and returns runtime connection info",
    () =>
      Effect.gen(function* () {
        const records: Array<SpawnRecord> = []
        const identity = makeIdentityHttpLayer()
        const childProcessLayer = makeChildProcessLayer((command) => {
          records.push({
            args: command.args,
            command: command.command,
          })

          return makeHandle({ exitCode: 0 })
        })

        const runtime = yield* makeDevServer({
          binaries: {
            cli: ["spacetime"],
            standalone: ["spacetimedb-standalone"],
          },
          bundlePath: "/tmp/effect-spacetimedb-dev-server-test/bundle.js",
          dbNamePrefix: "dev-server-test",
        }).pipe((effect) =>
          provideDevServerUnitLayers(effect, childProcessLayer, identity.layer),
        )
        const publishRecord = yield* publishRecordFrom(records)
        const startRecord = records.find((record) =>
          record.args.includes("start"),
        )
        const listenAddr =
          startRecord === undefined
            ? yield* new DevServerTestInvariantError({
                cause: "standalone start command was not spawned",
              })
            : yield* listenAddrFrom(startRecord)
        const publishServer =
          publishRecord.args[publishRecord.args.indexOf("--server") + 1]

        expect(runtime.baseUrl).toBe(publishServer)
        expect(runtime.baseUrl).toBe(`http://${listenAddr}`)
        expect(runtime.databaseName).toContain("dev-server-test-")
        expect(runtime.token).toBe("test-token")
        expect("generatedClient" in runtime).toBe(false)
        expect(identity.attempts()).toBe(1)
        const loginRecord = yield* loginRecordFrom(records)
        const loginConfigPath = yield* cliConfigPathFrom(loginRecord)
        const publishConfigPath = yield* cliConfigPathFrom(publishRecord)
        expect(loginConfigPath).toBe(publishConfigPath)
        expect(loginConfigPath).toMatch(/\/cli\/cli\.toml$/u)
        expect(loginRecord.args).not.toContain("--root-dir")
        expect(loginRecord.args).toContain("login")
        expect(loginRecord.args).toContain("--token")
        expect(loginRecord.args).toContain("test-token")
        expect(publishRecord.args).toContain("--js-path")
        expect(publishRecord.args).toContain(
          "/tmp/effect-spacetimedb-dev-server-test/bundle.js",
        )
        expect(publishRecord.args).not.toContain("--module-path")
        expect(publishRecord.args).not.toContain("--root-dir")
        expect(publishRecord.args).not.toContain("--anonymous")
        expect(publishRecord.args).toContain("--yes")
        expect(publishRecord.args).toContain("--delete-data=always")
        expect(records.some((record) => record.args.includes("build"))).toBe(
          false,
        )
        expect(records.some((record) => record.args.includes("generate"))).toBe(
          false,
        )
      }),
  )

  it.effect(
    "starts the standalone server with its own variables over the inherited ones",
    () =>
      Effect.gen(function* () {
        const startOptions: Array<{
          readonly env: Readonly<Record<string, string | undefined>> | undefined
          readonly extendEnv: boolean | undefined
        }> = []
        const childProcessLayer = makeChildProcessLayer((command) => {
          if (command.args.includes("start"))
            startOptions.push({
              env: command.options.env,
              extendEnv: command.options.extendEnv,
            })
          return makeHandle({ exitCode: 0 })
        })
        yield* makeDevServer({
          binaries: {
            cli: ["spacetime"],
            standalone: ["spacetimedb-standalone"],
          },
          bundlePath: "/tmp/effect-spacetimedb-dev-server-test/bundle.js",
          dbNamePrefix: "dev-server-test",
          processEnvironment: { NO_PROXY: "127.0.0.1, .internal" },
          standaloneEnvironment: { HTTP_PROXY: "http://127.0.0.1:9" },
        }).pipe((effect) =>
          provideDevServerUnitLayers(
            effect,
            childProcessLayer,
            makeIdentityHttpLayer().layer,
          ),
        )
        // Over the inherited environment, never in place of it, and with
        // `localhost` added to the inherited proxy exemptions: the server
        // posts inter-database calls to `http://localhost:<port>`.
        expect(startOptions).toEqual([
          {
            env: {
              HTTP_PROXY: "http://127.0.0.1:9",
              NO_PROXY: "127.0.0.1,.internal,localhost",
              no_proxy: "127.0.0.1,.internal,localhost",
            },
            extendEnv: true,
          },
        ])
      }),
  )

  it.effect("exempts localhost from the proxy of every standalone", () =>
    Effect.gen(function* () {
      const startEnvironments: Array<
        Readonly<Record<string, string | undefined>> | undefined
      > = []
      const childProcessLayer = makeChildProcessLayer((command) => {
        if (command.args.includes("start")) {
          startEnvironments.push(command.options.env)
        }
        return makeHandle({ exitCode: 0 })
      })
      const start = (options: {
        readonly processEnvironment: Readonly<Record<string, string>>
        readonly standaloneEnvironment?: Readonly<Record<string, string>>
      }) =>
        makeDevServer({
          binaries: {
            cli: ["spacetime"],
            standalone: ["spacetimedb-standalone"],
          },
          bundlePath: "/tmp/effect-spacetimedb-dev-server-test/bundle.js",
          dbNamePrefix: "dev-server-test",
          ...options,
        }).pipe((effect) =>
          provideDevServerUnitLayers(
            effect,
            childProcessLayer,
            makeIdentityHttpLayer().layer,
          ),
        )

      // Nothing inherited: only `localhost`.
      yield* start({ processEnvironment: {} })
      // Already exempt, in either spelling of the variable: kept as it is.
      yield* start({ processEnvironment: { no_proxy: "LOCALHOST" } })
      // The caller's own list wins outright.
      yield* start({
        processEnvironment: { NO_PROXY: "inherited.test" },
        standaloneEnvironment: { NO_PROXY: "chosen.test" },
      })

      expect(startEnvironments).toEqual([
        { NO_PROXY: "localhost", no_proxy: "localhost" },
        { NO_PROXY: "LOCALHOST", no_proxy: "LOCALHOST" },
        { NO_PROXY: "chosen.test" },
      ])
    }),
  )

  it.effect(
    "publishes more databases beside the first on the same standalone",
    () =>
      Effect.gen(function* () {
        const records: Array<SpawnRecord> = []
        const childProcessLayer = makeChildProcessLayer((command) => {
          records.push({ args: command.args, command: command.command })
          return makeHandle({ exitCode: 0 })
        })
        const identityRequests: Array<string> = []
        const httpLayer = makeMockHttpClientLayer((request) => {
          if (request.method === "GET") {
            identityRequests.push(request.url.pathname)
            return Effect.succeed({
              body: request.url.pathname.includes("peer")
                ? "a1".repeat(32)
                : `${testDatabaseIdentity}\n`,
            })
          }
          return Effect.succeed({
            body: JSON.stringify({ identity: "owner", token: "test-token" }),
          })
        })

        yield* Effect.gen(function* () {
          const runtime = yield* makeDevServer({
            binaries: {
              cli: ["spacetime"],
              standalone: ["spacetimedb-standalone"],
            },
            bundlePath: "/tmp/effect-spacetimedb-dev-server-test/first.js",
            dbNamePrefix: "dev-server-test",
          })
          const peer = yield* runtime.publishDatabase({
            bundlePath: "/tmp/effect-spacetimedb-dev-server-test/peer.js",
            databaseName: "peer",
          })
          expect(runtime.databaseIdentity).toBe(testDatabaseIdentity)
          expect(peer.databaseName).toBe("peer")
          expect(peer.databaseIdentity).toBe("a1".repeat(32))
          expect(identityRequests).toEqual([
            `/v1/database/${runtime.databaseName}/identity`,
            "/v1/database/peer/identity",
          ])

          // The peer is a new database on the same server, published by the
          // same logged-in CLI.
          const [firstPublish, peerPublish] = publishRecords(
            records.map((record) => ({
              ...record,
              extendEnv: undefined,
              env: undefined,
            })),
          )
          if (firstPublish === undefined || peerPublish === undefined) {
            return yield* new DevServerTestInvariantError({
              cause: "expected both publish command records",
            })
          }
          expect(peerPublish.args).toContain("peer")
          expect(peerPublish.args).toContain(
            "/tmp/effect-spacetimedb-dev-server-test/peer.js",
          )
          expect(peerPublish.args).toContain("--delete-data=always")
          expect(peerPublish.args).toContain(runtime.baseUrl)
          expect(yield* cliConfigPathFrom(peerPublish)).toBe(
            yield* cliConfigPathFrom(firstPublish),
          )

          // A held name is refused until its database is removed.
          const taken = yield* Effect.exit(
            runtime.publishDatabase({
              bundlePath: "/tmp/effect-spacetimedb-dev-server-test/peer.js",
              databaseName: runtime.databaseName,
            }),
          )
          expect(failureFrom(taken)).toBeInstanceOf(
            DevServerDatabaseNameInUseError,
          )
          yield* peer.remove()
          const deleteRecord = records.find((record) =>
            record.args.includes("delete"),
          )
          expect(deleteRecord?.args).toContain("peer")
          expect(deleteRecord?.args).toContain(runtime.baseUrl)
          const again = yield* runtime.publishDatabase({
            bundlePath: "/tmp/effect-spacetimedb-dev-server-test/peer.js",
            databaseName: "peer",
          })
          expect(again.databaseName).toBe("peer")
        }).pipe((effect) =>
          provideDevServerUnitLayers(effect, childProcessLayer, httpLayer),
        )
      }),
  )

  it.effect("retries identity readiness before publishing", () =>
    Effect.gen(function* () {
      const records: Array<SpawnRecord> = []
      const identity = makeIdentityHttpLayer({ failFirst: true })
      const childProcessLayer = makeChildProcessLayer((command) => {
        records.push({
          args: command.args,
          command: command.command,
        })

        return makeHandle({ exitCode: 0 })
      })

      const runtime = yield* makeDevServer({
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
        bundlePath: "/tmp/effect-spacetimedb-dev-server-test/bundle.js",
        dbNamePrefix: "dev-server-test",
      }).pipe((effect) =>
        provideDevServerUnitLayers(effect, childProcessLayer, identity.layer),
      )

      expect(runtime.token).toBe("test-token")
      expect(identity.attempts()).toBe(2)
      expect(records.some((record) => record.args.includes("publish"))).toBe(
        true,
      )
    }),
  )

  it.effect("isolates CLI state between independent dev servers", () => {
    const records: Array<SpawnRecord> = []
    const identity = makeIdentityHttpLayer()
    const childProcessLayer = makeChildProcessLayer((command) => {
      records.push({
        args: command.args,
        command: command.command,
      })

      return makeHandle({ exitCode: 0 })
    })

    return Effect.gen(function* () {
      yield* makeDevServer({
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
        bundlePath: "/tmp/effect-spacetimedb-dev-server-test/first.js",
        dbNamePrefix: "dev-server-test",
      })
      const firstConfigPath = yield* loginRecordFrom(records).pipe(
        Effect.flatMap(cliConfigPathFrom),
      )

      records.length = 0
      yield* makeDevServer({
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
        bundlePath: "/tmp/effect-spacetimedb-dev-server-test/second.js",
        dbNamePrefix: "dev-server-test",
      })
      const secondConfigPath = yield* loginRecordFrom(records).pipe(
        Effect.flatMap(cliConfigPathFrom),
      )

      expect(secondConfigPath).not.toBe(firstConfigPath)
      expect(firstConfigPath).toMatch(/\/cli\/cli\.toml$/u)
      expect(secondConfigPath).toMatch(/\/cli\/cli\.toml$/u)
    }).pipe((effect) =>
      provideDevServerUnitLayers(effect, childProcessLayer, identity.layer),
    )
  })

  it.effect("republishes to the same database without deleting data", () => {
    const records: Array<SpawnRecord> = []
    const identity = makeIdentityHttpLayer()
    const childProcessLayer = makeChildProcessLayer((command) => {
      records.push({
        args: command.args,
        command: command.command,
      })

      return makeHandle({ exitCode: 0 })
    })

    return Effect.gen(function* () {
      const runtime = yield* makeDevServer({
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
        bundlePath: "/tmp/effect-spacetimedb-dev-server-test/v1.js",
        dbNamePrefix: "dev-server-test",
      })
      yield* runtime.republish("/tmp/effect-spacetimedb-dev-server-test/v2.js")

      const publishRecords = records.filter((record) =>
        record.args.includes("publish"),
      )
      expect(publishRecords).toHaveLength(2)
      expect(publishRecords[0]?.args).toContain(runtime.databaseName)
      expect(publishRecords[0]?.args).toContain("--delete-data=always")
      expect(publishRecords[1]?.args).toContain(runtime.databaseName)
      expect(publishRecords[1]?.args).toContain(
        "/tmp/effect-spacetimedb-dev-server-test/v2.js",
      )
      const firstPublish = publishRecords[0]
      const secondPublish = publishRecords[1]
      if (firstPublish === undefined || secondPublish === undefined) {
        return yield* new DevServerTestInvariantError({
          cause: "expected both publish command records",
        })
      }
      expect(yield* cliConfigPathFrom(firstPublish)).toBe(
        yield* cliConfigPathFrom(secondPublish),
      )
      expect(firstPublish.args).not.toContain("--root-dir")
      expect(secondPublish.args).not.toContain("--root-dir")
      expect(publishRecords[1]?.args).toContain("--delete-data=never")
      expect(publishRecords[1]?.args).not.toContain("--anonymous")
      expect(identity.attempts()).toBe(1)
    }).pipe((effect) =>
      provideDevServerUnitLayers(effect, childProcessLayer, identity.layer),
    )
  })

  it.effect("maps split clear modes and exposes stateless status/reset", () => {
    const records: Array<SpawnRecord> = []
    const identity = makeIdentityHttpLayer()
    const childProcessLayer = makeChildProcessLayer((command) => {
      records.push({ args: command.args, command: command.command })
      return makeHandle({ exitCode: 0 })
    })
    const lifecycleHttp = makeMockHttpClientLayer((request) => {
      if (request.url.pathname === "/v1/ping") {
        return Effect.succeed({ body: "pong", status: 200 })
      }
      if (request.url.pathname.endsWith("/identity")) {
        return Effect.succeed({ body: "0".repeat(64), status: 200 })
      }
      return Effect.succeed({ body: "database metadata", status: 200 })
    })

    return Effect.gen(function* () {
      const runtime = yield* makeDevServer({
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
        bundlePath: "/tmp/effect-spacetimedb-dev-server-test/v1.js",
        dbNamePrefix: "dev-server-test",
        clear: { publishFirst: "on-conflict", republish: "always" },
      })
      yield* runtime.republish("/tmp/effect-spacetimedb-dev-server-test/v2.js")
      const publishRecords = records.filter((record) =>
        record.args.includes("publish"),
      )
      expect(publishRecords[0]?.args).toContain("--delete-data=on-conflict")
      expect(publishRecords[1]?.args).toContain("--delete-data=always")

      const lifecycle = makeModuleLifecycle({
        baseUrl: runtime.baseUrl,
        databaseName: runtime.databaseName,
        token: runtime.token,
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
        cliRootDir: "/tmp/effect-spacetimedb-dev-server-test/cli",
        bundlePath: "/tmp/effect-spacetimedb-dev-server-test/fresh.js",
      })
      const status = yield* lifecycle
        .status()
        .pipe(Effect.provide(lifecycleHttp))
      expect(status).toEqual({
        reachable: true,
        published: true,
        databaseIdentity: "0".repeat(64),
      })
      // With a bundle, a reset is one clearing publish: the host's own
      // reset, which keeps the database until the new module's init passed.
      yield* lifecycle.reset()
      expect(records.some((record) => record.args.includes("delete"))).toBe(
        false,
      )
      const resetPublish = records
        .filter((record) => record.args.includes("publish"))
        .at(-1)
      expect(resetPublish?.args).toContain(
        "/tmp/effect-spacetimedb-dev-server-test/fresh.js",
      )
      expect(resetPublish?.args).toContain("--delete-data=always")
    }).pipe((effect) =>
      provideDevServerUnitLayers(effect, childProcessLayer, identity.layer),
    )
  })

  it.effect(
    "does not treat a retained database name as a published database",
    () =>
      Effect.gen(function* () {
        const requests: Array<{
          readonly method: string
          readonly path: string
        }> = []
        const lifecycleHttp = makeMockHttpClientLayer((request) => {
          requests.push({
            method: request.method,
            path: request.url.pathname,
          })
          if (request.url.pathname === "/v1/ping") {
            return Effect.succeed({ body: "pong", status: 200 })
          }
          if (request.url.pathname.endsWith("/identity")) {
            return Effect.succeed({ body: "0".repeat(64), status: 200 })
          }
          return Effect.succeed({ body: "database not found", status: 500 })
        })
        const lifecycle = makeModuleLifecycle({
          baseUrl: "http://127.0.0.1:3000",
          databaseName: "retained-name",
          binaries: {
            cli: ["spacetime"],
            standalone: ["spacetimedb-standalone"],
          },
        })

        expect(
          yield* lifecycle.status().pipe(Effect.provide(lifecycleHttp)),
        ).toEqual({ reachable: true, published: false })
        expect(requests).toEqual([
          { method: "GET", path: "/v1/ping" },
          {
            method: "GET",
            path: "/v1/database/retained-name/identity",
          },
          { method: "GET", path: "/v1/database/retained-name" },
        ])
      }),
  )

  it.effect("preserves unrelated not-found lifecycle failures", () =>
    Effect.gen(function* () {
      for (const response of [
        { body: "authentication token not found", status: 401 },
        { body: "route not found", status: 404 },
        { body: "database route not found", status: 500 },
      ]) {
        const lifecycleHttp = makeMockHttpClientLayer((request) => {
          if (request.url.pathname === "/v1/ping") {
            return Effect.succeed({ body: "pong", status: 200 })
          }
          if (request.url.pathname.endsWith("/identity")) {
            return Effect.succeed({ body: "0".repeat(64), status: 200 })
          }
          return Effect.succeed(response)
        })
        const lifecycle = makeModuleLifecycle({
          baseUrl: "http://127.0.0.1:3000",
          databaseName: "retained-name",
          binaries: {
            cli: ["spacetime"],
            standalone: ["spacetimedb-standalone"],
          },
        })

        const failure = failureFrom(
          yield* lifecycle
            .status()
            .pipe(Effect.provide(lifecycleHttp), Effect.exit),
        )
        expect(failure).toBeInstanceOf(DevServerResponseError)
      }

      const identityRouteHttp = makeMockHttpClientLayer((request) =>
        Effect.succeed(
          request.url.pathname === "/v1/ping"
            ? { body: "pong", status: 200 }
            : { body: "route not found", status: 404 },
        ),
      )
      const lifecycle = makeModuleLifecycle({
        baseUrl: "http://127.0.0.1:3000",
        databaseName: "retained-name",
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
      })
      const identityFailure = failureFrom(
        yield* lifecycle
          .status()
          .pipe(Effect.provide(identityRouteHttp), Effect.exit),
      )
      expect(identityFailure).toBeInstanceOf(DevServerResponseError)
    }),
  )

  it.effect("only suppresses database-specific delete failures", () =>
    Effect.gen(function* () {
      const lifecycle = makeModuleLifecycle({
        baseUrl: "http://127.0.0.1:3000",
        databaseName: "already-missing",
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
      })
      const missingLayer = makeChildProcessLayer(() =>
        makeHandle({
          exitCode: 1,
          stderr: "Error: failed to find database `already-missing`.",
        }),
      )
      const unusedHttpLayer = makeMockHttpClientLayer(() =>
        Effect.succeed({ body: "unused", status: 500 }),
      )
      yield* lifecycle
        .reset()
        .pipe(Effect.provide(Layer.merge(missingLayer, unusedHttpLayer)))

      const unrelatedLayer = makeChildProcessLayer(() =>
        makeHandle({
          exitCode: 1,
          stderr: "Error: authentication token not found.",
        }),
      )
      const failure = failureFrom(
        yield* lifecycle
          .reset()
          .pipe(
            Effect.provide(Layer.merge(unrelatedLayer, unusedHttpLayer)),
            Effect.exit,
          ),
      )
      expect(failure).toBeInstanceOf(DevServerCommandError)
    }),
  )

  it.effect("redacts lifecycle login tokens from command failures", () =>
    Effect.gen(function* () {
      const token = "secret-lifecycle-token"
      const records: Array<SpawnRecord> = []
      const childProcessLayer = makeChildProcessLayer((command) => {
        records.push({ args: command.args, command: command.command })
        return makeHandle({
          exitCode: 17,
          stdout: `failed for ${token}`,
          stderr: `login rejected ${token}`,
        })
      })
      const lifecycle = makeModuleLifecycle({
        baseUrl: "http://127.0.0.1:3000",
        databaseName: "token-redaction",
        token,
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
        cliRootDir: "/tmp/effect-spacetimedb-token-redaction",
      })

      const failure = failureFrom(
        yield* lifecycle.reset().pipe(
          Effect.provide(
            Layer.merge(
              childProcessLayer,
              makeMockHttpClientLayer(() =>
                Effect.succeed({ body: "unused", status: 500 }),
              ),
            ),
          ),
          Effect.exit,
        ),
      )
      expect(failure).toBeInstanceOf(DevServerCommandError)
      expect(records[0]?.args).toContain(token)
      const diagnostic = `${String(failure)} ${JSON.stringify(failure)}`
      expect(diagnostic).not.toContain(token)
      expect(diagnostic).toContain("<redacted>")
    }),
  )

  it.effect("surfaces a nonzero publish command as DevServerCommandError", () =>
    Effect.gen(function* () {
      const records: Array<SpawnRecord> = []
      const identity = makeIdentityHttpLayer()
      const childProcessLayer = makeChildProcessLayer((command) => {
        records.push({
          args: command.args,
          command: command.command,
        })

        if (command.args.includes("publish")) {
          return makeHandle({
            exitCode: 17,
            stderr: "publish failed",
            stdout: "publish output",
          })
        }

        return makeHandle({ exitCode: 0 })
      })

      const exit = yield* Effect.exit(
        makeDevServer({
          binaries: {
            cli: ["spacetime"],
            standalone: ["spacetimedb-standalone"],
          },
          bundlePath: "/tmp/effect-spacetimedb-dev-server-test/bundle.js",
          dbNamePrefix: "dev-server-test",
        }).pipe((effect) =>
          provideDevServerUnitLayers(effect, childProcessLayer, identity.layer),
        ),
      )
      const failure = failureFrom(exit)
      const publishRecord = yield* publishRecordFrom(records)

      expect(failure).toBeInstanceOf(DevServerCommandError)
      expect((failure as DevServerCommandError | undefined)?.command).toContain(
        "publish",
      )
      expect((failure as DevServerCommandError | undefined)?.exitCode).toBe(17)
      expect(publishRecord.args).toContain("--js-path")
      expect(publishRecord.args).not.toContain("--module-path")
      expect(records.some((record) => record.args.includes("build"))).toBe(
        false,
      )
      expect(records.some((record) => record.args.includes("generate"))).toBe(
        false,
      )
    }),
  )

  it.effect(
    "checks an optional SpaceTimeDB version requirement at runtime",
    () =>
      Effect.gen(function* () {
        const records: Array<SpawnRecord> = []
        const identity = makeIdentityHttpLayer()
        const childProcessLayer = makeChildProcessLayer((command) => {
          records.push({
            args: command.args,
            command: command.command,
          })

          if (command.args.includes("--version")) {
            return makeHandle({
              exitCode: 0,
              stdout: "spacetimedb tool version 2.12.0\n",
            })
          }

          return makeHandle({ exitCode: 0 })
        })

        const runtime = yield* makeDevServer({
          binaries: {
            cli: ["spacetime"],
            standalone: ["spacetimedb-standalone"],
          },
          bundlePath: "/tmp/effect-spacetimedb-dev-server-test/bundle.js",
          dbNamePrefix: "dev-server-test",
          versionRequirement: "spacetimedb tool version 2.12.0",
        }).pipe((effect) =>
          provideDevServerUnitLayers(effect, childProcessLayer, identity.layer),
        )

        expect(runtime.token).toBe("test-token")
        expect(
          records.filter((record) => record.args.includes("--version")).length,
        ).toBe(2)
      }),
  )

  it.effect(
    "publishes exactly the supplied values in a CLI environment built from scratch",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        yield* environmentDevServer().pipe((effect) =>
          provideDevServerUnitLayers(
            effect,
            recordingChildProcessLayer(records),
            makeIdentityHttpLayer().layer,
          ),
        )

        const extraction = records.find((record) =>
          record.args.includes("extract-schema"),
        )
        const [publish] = publishRecords(records)
        expect(extraction?.args).toContain(environmentBundlePath)
        expect(extraction?.env).toEqual(inheritedBaseEnvironment)
        expect(publish?.extendEnv).toBe(false)
        expect(publish?.args).toContain("--no-config")
        expect(publish?.env).toEqual({
          ...inheritedBaseEnvironment,
          GREETING: "hello",
          API_KEY: "secret-value-1",
          MODE: "development",
        })
        expect(publish?.args.join(" ")).not.toContain("secret-value-1")
      }),
  )

  it.effect("redacts secret values from publish failures", () =>
    Effect.gen(function* () {
      const records: Array<EnvironmentSpawnRecord> = []
      const exit = yield* environmentDevServer().pipe(
        (effect) =>
          provideDevServerUnitLayers(
            effect,
            recordingChildProcessLayer(records, {
              publishFailure: { stderr: "rejected API_KEY=secret-value-1" },
            }),
            makeIdentityHttpLayer().layer,
          ),
        Effect.exit,
      )

      const failure = failureFrom(exit)
      expect(failure).toBeInstanceOf(DevServerCommandError)
      const diagnostic = `${String(failure)} ${
        failure instanceof DevServerCommandError ? failure.stderr : ""
      }`
      expect(diagnostic).not.toContain("secret-value-1")
      expect(diagnostic).toContain("<redacted>")
    }),
  )

  it.effect(
    "updates values without uploading a module and tracks them for clearing publishes",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        yield* Effect.gen(function* () {
          const runtime = yield* environmentDevServer({ republish: "always" })
          yield* runtime.updateEnvironment(
            { MODE: "production", REGION: "eu" },
            { unset: ["GREETING"] },
          )
          yield* runtime.republish(
            "/tmp/effect-spacetimedb-dev-server-test/v2.js",
          )
        }).pipe((effect) =>
          provideDevServerUnitLayers(
            effect,
            recordingChildProcessLayer(records),
            makeIdentityHttpLayer().layer,
          ),
        )

        const [, update, republish] = publishRecords(records)
        expect(update?.args).toContain("--env-only")
        expect(update?.args).toContain("--no-config")
        expect(update?.args).not.toContain("--js-path")
        expect(
          update?.args.some((arg) => arg.startsWith("--delete-data")),
        ).toBe(false)
        expect(update?.args.slice(update.args.indexOf("--unset-env"))).toEqual([
          "--unset-env",
          "GREETING",
        ])
        expect(update?.env).toEqual({
          ...inheritedBaseEnvironment,
          MODE: "production",
          REGION: "eu",
        })

        // `--delete-data=always` deletes stored values, so the republish
        // resupplies the current values: the update applied, GREETING gone.
        expect(republish?.args).toContain("--delete-data=always")
        expect(republish?.env).toEqual({
          ...inheritedBaseEnvironment,
          API_KEY: "secret-value-1",
          MODE: "production",
          REGION: "eu",
        })
      }),
  )

  it.effect(
    "lets a plain republish keep stored values and supply only its own",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        yield* Effect.gen(function* () {
          const runtime = yield* environmentDevServer({ republish: "never" })
          yield* runtime.republish(
            "/tmp/effect-spacetimedb-dev-server-test/v2.js",
          )
          yield* runtime.republish(
            "/tmp/effect-spacetimedb-dev-server-test/v3.js",
            { environment: { MODE: "production" } },
          )
        }).pipe((effect) =>
          provideDevServerUnitLayers(
            effect,
            // Required keys stay stored across a plain republish, so a
            // republish supplying none of them is still accepted.
            recordingChildProcessLayer(records, {
              declarations: resetDeclarations,
            }),
            makeIdentityHttpLayer().layer,
          ),
        )

        // Every bundle's declarations are read before it is published.
        expect(
          records
            .filter((record) => record.args.includes("extract-schema"))
            .map((record) => record.args[1]),
        ).toEqual([
          environmentBundlePath,
          "/tmp/effect-spacetimedb-dev-server-test/v2.js",
          "/tmp/effect-spacetimedb-dev-server-test/v3.js",
        ])
        const [, plain, supplying] = publishRecords(records)
        expect(plain?.args).toContain("--delete-data=never")
        expect(plain?.env).toEqual(inheritedBaseEnvironment)
        expect(supplying?.env).toEqual({
          ...inheritedBaseEnvironment,
          MODE: "production",
        })
      }),
  )

  it.effect(
    "resupplies the tracked values in the clearing publish a reset sends",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        yield* Effect.gen(function* () {
          const runtime = yield* environmentDevServer()
          yield* runtime.updateEnvironment({ MODE: "production", REGION: "eu" })
          yield* runtime.updateEnvironment({}, { unset: ["REGION"] })
          yield* runtime.reset()
        }).pipe((effect) =>
          provideDevServerUnitLayers(
            effect,
            recordingChildProcessLayer(records, {
              declarations: resetDeclarations,
            }),
            makeIdentityHttpLayer().layer,
          ),
        )

        // The bundle's declarations are read and the values checked first;
        // the reset itself is one clearing publish, never a delete.
        expect(spawnSteps(records)).toEqual([
          ...startupSteps,
          "update",
          "update",
          "extract",
          "publish",
        ])
        const resetPublish = publishRecords(records).at(-1)
        expect(resetPublish?.args).toContain("--delete-data=always")
        expect(resetPublish?.args).toContain("--no-config")
        expect(resetPublish?.extendEnv).toBe(false)
        // The reset stores exactly these: everything still tracked is
        // supplied again, the unset key is not.
        expect(resetPublish?.env).toEqual({
          ...inheritedBaseEnvironment,
          GREETING: "hello",
          API_KEY: "secret-value-1",
          MODE: "production",
        })
      }),
  )

  const refusedReset = (
    environment: DevServerEnvironmentValues,
    records: Array<EnvironmentSpawnRecord>,
  ) =>
    Effect.gen(function* () {
      const runtime = yield* environmentDevServer()
      return yield* runtime.reset({ environment })
    }).pipe(
      (effect) =>
        provideDevServerUnitLayers(
          effect,
          recordingChildProcessLayer(records, {
            declarations: resetDeclarations,
          }),
          makeIdentityHttpLayer().layer,
        ),
      Effect.exit,
      Effect.map(failureFrom),
    )

  it.effect("checks a reset's key names before publishing anything", () =>
    Effect.gen(function* () {
      const records: Array<EnvironmentSpawnRecord> = []
      expect(yield* refusedReset({ "NOT-A-KEY": "value" }, records)).toEqual(
        new DevServerEnvironmentKeyError({ key: "NOT-A-KEY" }),
      )
      expect(spawnSteps(records)).toEqual(startupSteps)
    }),
  )

  it.effect(
    "refuses a reset missing a required value before publishing anything",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        expect(
          yield* refusedReset(
            { GREETING: "hello", API_KEY: Redacted.make("secret-value-2") },
            records,
          ),
        ).toEqual(
          new DevServerEnvironmentValueError({
            key: "MODE",
            reason: "requiredValueMissing",
          }),
        )
        // Declarations read, then refused: nothing published.
        expect(spawnSteps(records)).toEqual([...startupSteps, "extract"])
      }),
  )

  it.effect(
    "refuses a reset with a literal outside its declared set before publishing anything",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        expect(
          yield* refusedReset(
            {
              GREETING: "hello",
              API_KEY: Redacted.make("secret-value-2"),
              MODE: "staging",
            },
            records,
          ),
        ).toEqual(
          new DevServerEnvironmentValueError({
            key: "MODE",
            reason: "valueOutsideDeclaration",
          }),
        )
        expect(spawnSteps(records)).toEqual([...startupSteps, "extract"])
      }),
  )

  it.effect(
    "keeps tracking the stored values when the host refuses a reset",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        const resetFailure = yield* Effect.gen(function* () {
          const runtime = yield* environmentDevServer()
          // The host refuses the second publish, this reset (for example,
          // the new module's init fails); it keeps the database as it was.
          const failure = yield* Effect.flip(
            runtime.reset({
              environment: {
                GREETING: "changed",
                API_KEY: Redacted.make("secret-value-2"),
                MODE: "production",
              },
            }),
          )
          // A reset with no replacement resupplies what the runtime tracks.
          yield* runtime.reset()
          return failure
        }).pipe((effect) =>
          provideDevServerUnitLayers(
            effect,
            recordingChildProcessLayer(records, { failPublishNumber: 2 }),
            makeIdentityHttpLayer().layer,
          ),
        )

        expect(resetFailure).toBeInstanceOf(DevServerCommandError)
        expect(spawnSteps(records).slice(startupSteps.length)).toEqual([
          "extract",
          "publish",
          "extract",
          "publish",
        ])
        expect(publishRecords(records).at(-1)?.env).toEqual({
          ...inheritedBaseEnvironment,
          GREETING: "hello",
          API_KEY: "secret-value-1",
          MODE: "development",
        })
      }),
  )

  it.effect(
    "refuses a supplied key the bundle does not declare before publishing it",
    () =>
      Effect.gen(function* () {
        // The CLI forwards only declared keys, so FEATURE_X would vanish.
        const records: Array<EnvironmentSpawnRecord> = []
        const exit = yield* environmentDevServer({
          environment: { GREETING: "hello", FEATURE_X: "on" },
        }).pipe(
          (effect) =>
            provideDevServerUnitLayers(
              effect,
              recordingChildProcessLayer(records),
              makeIdentityHttpLayer().layer,
            ),
          Effect.exit,
        )
        const notDeclared = new DevServerEnvironmentValueError({
          key: "FEATURE_X",
          reason: "keyNotDeclared",
        })
        expect(failureFrom(exit)).toEqual(notDeclared)
        expect(publishRecords(records)).toEqual([])

        const resetRecords: Array<EnvironmentSpawnRecord> = []
        expect(
          yield* refusedReset(
            {
              GREETING: "hello",
              API_KEY: Redacted.make("secret-value-2"),
              MODE: "production",
              FEATURE_X: "on",
            },
            resetRecords,
          ),
        ).toEqual(notDeclared)
        expect(spawnSteps(resetRecords)).toEqual([...startupSteps, "extract"])
      }),
  )

  // A republish whose bundle (v2) no longer declares REGION, then a reset
  // with the first bundle, which declares it again: the reset resupplies
  // REGION exactly when the republish left it stored.
  const droppedKeyScenarios: ReadonlyArray<{
    readonly republish: ClearMode
    readonly onConflictClears: boolean
    readonly regionKept: boolean
  }> = [
    { republish: "always", onConflictClears: false, regionKept: false },
    { republish: "on-conflict", onConflictClears: true, regionKept: false },
    { republish: "on-conflict", onConflictClears: false, regionKept: true },
  ]
  for (const scenario of droppedKeyScenarios) {
    it.effect(
      `tracks a value v2 no longer declares only while the database keeps it (${scenario.republish}, clears: ${String(!scenario.regionKept)})`,
      () =>
        Effect.gen(function* () {
          const records: Array<EnvironmentSpawnRecord> = []
          const v2BundlePath = "/tmp/effect-spacetimedb-dev-server-test/v2.js"
          yield* Effect.gen(function* () {
            const runtime = yield* environmentDevServer({
              republish: scenario.republish,
              environment: { GREETING: "hello", REGION: "eu" },
            })
            yield* runtime.republish(v2BundlePath)
            yield* runtime.reset()
          }).pipe((effect) =>
            provideDevServerUnitLayers(
              effect,
              recordingChildProcessLayer(records, {
                extractorOutput: (bundlePath) =>
                  extractedSchema(
                    bundlePath === v2BundlePath
                      ? [{ name: "GREETING" }]
                      : suppliedKeyDeclarations,
                  ),
                onConflictClears: scenario.onConflictClears,
              }),
              makeIdentityHttpLayer().layer,
            ),
          )

          const [, republished, reset] = publishRecords(records)
          expect(republished?.args).toContain(
            `--delete-data=${scenario.republish}`,
          )
          // The CLI would not forward REGION to v2, so it is never supplied.
          expect(republished?.env).toEqual({
            ...inheritedBaseEnvironment,
            GREETING: "hello",
          })
          expect(reset?.args).toContain(environmentBundlePath)
          expect(reset?.env).toEqual({
            ...inheritedBaseEnvironment,
            GREETING: "hello",
            ...(scenario.regionKept ? { REGION: "eu" } : {}),
          })
        }),
    )
  }

  it.effect(
    "refuses a value the host would refuse before the first publish",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        const exit = yield* environmentDevServer({
          environment: {
            GREETING: "x".repeat(8 * 1024 + 1),
            API_KEY: Redacted.make("secret-value-1"),
            MODE: "development",
          },
        }).pipe(
          (effect) =>
            provideDevServerUnitLayers(
              effect,
              recordingChildProcessLayer(records, {
                declarations: resetDeclarations,
              }),
              makeIdentityHttpLayer().layer,
            ),
          Effect.exit,
        )

        expect(failureFrom(exit)).toEqual(
          new DevServerEnvironmentValueError({
            key: "GREETING",
            reason: "valueTooLong",
          }),
        )
        expect(publishRecords(records)).toEqual([])
      }),
  )

  it.effect(
    "fails rather than skips an extracted environment section of an unexpected shape",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        const exit = yield* environmentDevServer().pipe(
          (effect) =>
            provideDevServerUnitLayers(
              effect,
              recordingChildProcessLayer(records, {
                // `name` renamed: read leniently, a declared `HOME` would slip
                // past the reserved-name refusal.
                extractorOutput:
                  '{"V10":{"sections":[{"Environment":[{"key":"HOME","ty":{"String":[]},"optional":true}]}]}}',
              }),
              makeIdentityHttpLayer().layer,
            ),
          Effect.exit,
        )

        expect(failureFrom(exit)).toBeInstanceOf(DevServerJsonDecodeError)
        expect(publishRecords(records)).toEqual([])
      }),
  )

  it.effect("caps how much extractor output it reads", () =>
    Effect.gen(function* () {
      const records: Array<EnvironmentSpawnRecord> = []
      const exit = yield* environmentDevServer().pipe(
        (effect) =>
          provideDevServerUnitLayers(
            effect,
            recordingChildProcessLayer(records, {
              extractorOutput: " ".repeat(16 * 1024 * 1024 + 1),
            }),
            makeIdentityHttpLayer().layer,
          ),
        Effect.exit,
      )

      const failure = failureFrom(exit)
      expect(failure).toBeInstanceOf(DevServerBinaryError)
      expect(
        failure instanceof DevServerBinaryError ? failure.cause : undefined,
      ).toBe(`output exceeded ${(16 * 1024 * 1024).toString()} bytes`)
      expect(publishRecords(records)).toEqual([])
    }),
  )

  it.effect("refuses a key the host could never accept", () =>
    Effect.gen(function* () {
      const records: Array<EnvironmentSpawnRecord> = []
      const exit = yield* environmentDevServer({
        environment: { "NOT-A-KEY": "value" },
      }).pipe(
        (effect) =>
          provideDevServerUnitLayers(
            effect,
            recordingChildProcessLayer(records),
            makeIdentityHttpLayer().layer,
          ),
        Effect.exit,
      )

      expect(failureFrom(exit)).toEqual(
        new DevServerEnvironmentKeyError({ key: "NOT-A-KEY" }),
      )
      expect(publishRecords(records)).toEqual([])
    }),
  )

  it.effect(
    "refuses a supplied key that a reserved base variable would shadow",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        const refuse = (key: string) =>
          environmentDevServer({ environment: { [key]: "value" } }).pipe(
            (effect) =>
              provideDevServerUnitLayers(
                effect,
                recordingChildProcessLayer(records),
                makeIdentityHttpLayer().layer,
              ),
            Effect.exit,
            Effect.map(failureFrom),
          )

        expect(yield* refuse("HOME")).toEqual(
          new DevServerReservedEnvironmentKeyError({
            key: "HOME",
            origin: "supplied",
          }),
        )
        // Windows compares environment names case-insensitively.
        expect(yield* refuse("Path")).toEqual(
          new DevServerReservedEnvironmentKeyError({
            key: "Path",
            origin: "supplied",
          }),
        )
        expect(publishRecords(records)).toEqual([])
      }),
  )

  it.effect(
    "refuses a bundle that declares a reserved base variable before publishing it",
    () =>
      Effect.gen(function* () {
        const records: Array<EnvironmentSpawnRecord> = []
        const exit = yield* environmentDevServer().pipe(
          (effect) =>
            provideDevServerUnitLayers(
              effect,
              recordingChildProcessLayer(records, {
                declarations: [{ name: "GREETING" }, { name: "TMPDIR" }],
              }),
              makeIdentityHttpLayer().layer,
            ),
          Effect.exit,
        )

        // Without the refusal the CLI would publish the shell's TMPDIR as the
        // module's value even though the caller supplied none.
        expect(failureFrom(exit)).toEqual(
          new DevServerReservedEnvironmentKeyError({
            key: "TMPDIR",
            origin: "declared",
          }),
        )
        expect(
          records.some((record) => record.args.includes("extract-schema")),
        ).toBe(true)
        expect(publishRecords(records)).toEqual([])
      }),
  )
})
