import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
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
  DevServerResetVerificationError,
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
        const loginRecord = yield* loginRecordFrom(records)
        expect(loginRecord.args).toContain("--root-dir")
        expect(loginRecord.args).toContain("login")
        expect(loginRecord.args).toContain("--token")
        expect(loginRecord.args).toContain("test-token")
        expect(publishRecord.args).toContain("--js-path")
        expect(publishRecord.args).toContain(
          "/tmp/effect-spacetimedb-dev-server-test/bundle.js",
        )
        expect(publishRecord.args).not.toContain("--module-path")
        expect(publishRecord.args).toContain("--root-dir")
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
      expect(publishRecords[0]?.args).toContain("--root-dir")
      expect(publishRecords[1]?.args).toContain(runtime.databaseName)
      expect(publishRecords[1]?.args).toContain(
        "/tmp/effect-spacetimedb-dev-server-test/v2.js",
      )
      expect(publishRecords[1]?.args).toContain("--root-dir")
      expect(publishRecords[1]?.args).toContain("--delete-data=never")
      expect(publishRecords[1]?.args).not.toContain("--anonymous")
      expect(identity.attempts()).toBe(1)
    }).pipe((effect) =>
      provideDevServerUnitLayers(effect, childProcessLayer, identity.layer),
    )
  })

  it.effect("maps split clear modes and exposes stateless status/reset", () => {
    const records: Array<SpawnRecord> = []
    let deleted = false
    const identity = makeIdentityHttpLayer()
    const childProcessLayer = makeChildProcessLayer((command) => {
      records.push({ args: command.args, command: command.command })
      if (command.args.includes("delete")) {
        deleted = true
        return makeHandle({
          exitCode: 1,
          stderr: "No such database",
        })
      }
      return makeHandle({ exitCode: 0 })
    })
    const lifecycleHttp = makeMockHttpClientLayer((request) => {
      if (request.url.pathname === "/v1/ping") {
        return Effect.succeed({ body: "pong", status: 200 })
      }
      if (request.url.pathname.endsWith("/identity")) {
        return Effect.succeed({ body: "0".repeat(64), status: 200 })
      }
      return Effect.succeed(
        deleted
          ? { body: "database not found", status: 500 }
          : { body: "database metadata", status: 200 },
      )
    })

    return Effect.gen(function* () {
      const runtime = yield* makeDevServer({
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
        bundlePath: "/tmp/effect-spacetimedb-dev-server-test/v1.js",
        dbNamePrefix: "dev-server-test",
        clear: { firstPublish: "on-conflict", republish: "always" },
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
      yield* lifecycle.reset().pipe(Effect.provide(lifecycleHttp))
      expect(records.some((record) => record.args.includes("delete"))).toBe(
        true,
      )
      const resetPublish = records
        .filter((record) => record.args.includes("publish"))
        .at(-1)
      expect(resetPublish?.args).toContain(
        "/tmp/effect-spacetimedb-dev-server-test/fresh.js",
      )
      expect(resetPublish?.args).toContain("--delete-data=never")
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

  it.effect("refuses to republish while the deleted database remains", () =>
    Effect.gen(function* () {
      const records: Array<SpawnRecord> = []
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
      const lifecycle = makeModuleLifecycle({
        baseUrl: "http://127.0.0.1:3000",
        databaseName: "still-published",
        bundlePath: "/tmp/effect-spacetimedb-still-published.js",
        binaries: {
          cli: ["spacetime"],
          standalone: ["spacetimedb-standalone"],
        },
      })

      const failure = failureFrom(
        yield* lifecycle
          .reset()
          .pipe(
            Effect.provide(Layer.merge(childProcessLayer, lifecycleHttp)),
            Effect.exit,
          ),
      )
      expect(failure).toBeInstanceOf(DevServerResetVerificationError)
      expect(records.some((record) => record.args.includes("delete"))).toBe(
        true,
      )
      expect(records.some((record) => record.args.includes("publish"))).toBe(
        false,
      )
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
              stdout: "spacetimedb tool version 2.6.1\n",
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
          versionRequirement: "spacetimedb tool version 2.6.1",
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
