import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import {
  DevServerCommandError,
  makeDevServer,
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

const makeChildProcessLayer = (
  spawn: (
    command: ChildProcess.StandardCommand,
  ) => ChildProcessSpawner.ChildProcessHandle,
) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.succeed(spawn(command as ChildProcess.StandardCommand)),
    ),
  )

const makeIdentityHttpLayer = (params?: { readonly failFirst?: boolean }) => {
  let attempts = 0

  return {
    attempts: () => attempts,
    layer: makeMockHttpClientLayer((request) => {
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
        expect(publishRecord.args).toContain("--js-path")
        expect(publishRecord.args).toContain(
          "/tmp/effect-spacetimedb-dev-server-test/bundle.js",
        )
        expect(publishRecord.args).not.toContain("--module-path")
        expect(publishRecord.args).toContain("--anonymous")
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
        "spacetime publish",
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
              stdout: "spacetimedb tool version 2.5.0\n",
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
          versionRequirement: "spacetimedb tool version 2.5.0",
        }).pipe((effect) =>
          provideDevServerUnitLayers(effect, childProcessLayer, identity.layer),
        )

        expect(runtime.token).toBe("test-token")
        expect(
          records.filter((record) => record.args.includes("--version")).length,
        ).toBe(2)
      }),
  )
})
