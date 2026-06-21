import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { Identity } from "spacetimedb"
const { expect } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"
import { MinimalModule } from "../fixtures/minimal-module"
import { TestLayer } from "../helpers/test-layer"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const describe = EffectVitest.layer(TestLayer)

const unsafeSucceedDeferred = <A>(deferred: Deferred.Deferred<A>, value: A) => {
  Effect.runSync(Deferred.succeed(deferred, value))
}

describe("ws resource", (it) => {
  it.effect("reinitializes scoped connection state for each evaluation", () =>
    Effect.gen(function* () {
      let buildCount = 0
      let disconnectCount = 0

      const scoped = StdbTesting.makeScopedFromModulePlan({
        plan: StdbTesting.makeModulePlan(FullModule),
        config: {
          builder: () => {
            let onConnect:
              | ((
                  connection: StdbTesting.ManagedWsConnection<
                    typeof FullModule,
                    unknown
                  >,
                  identity: Identity,
                  token: string,
                ) => void)
              | undefined

            const builder: StdbTesting.GeneratedWsBuilderLike<
              typeof FullModule,
              unknown
            > = {
              withUri: () => builder,
              withDatabaseName: () => builder,
              withToken: () => builder,
              withCompression: () => builder,
              onConnect: (callback) => {
                onConnect = callback
                return builder
              },
              onDisconnect: () => builder,
              onConnectError: () => builder,
              build: () => {
                buildCount += 1

                const connection = {
                  ...makeFullModuleWsConnection(),
                  disconnect: () => {
                    disconnectCount += 1
                  },
                } satisfies StdbTesting.ManagedWsConnection<
                  typeof FullModule,
                  unknown
                >

                onConnect?.(connection, Identity.zero(), `token-${buildCount}`)
                return connection
              },
            }

            return builder
          },
          uri: "ws://localhost:3000",
          databaseName: "test",
        },
      })

      yield* scoped.pipe(Effect.asVoid, Effect.scoped)
      yield* scoped.pipe(Effect.asVoid, Effect.scoped)

      expect(buildCount).toBe(2)
      expect(disconnectCount).toBe(2)
    }),
  )

  it.effect(
    "disconnects built connections when connect error wins acquire",
    () =>
      Effect.gen(function* () {
        let disconnectCount = 0

        const scoped = StdbTesting.makeScopedFromModulePlan({
          plan: StdbTesting.makeModulePlan(FullModule),
          config: {
            builder: () => {
              let onConnectError:
                | ((context: unknown, error: Error) => void)
                | undefined

              const builder: StdbTesting.GeneratedWsBuilderLike<
                typeof FullModule,
                unknown
              > = {
                withUri: () => builder,
                withDatabaseName: () => builder,
                withToken: () => builder,
                withCompression: () => builder,
                onConnect: () => builder,
                onDisconnect: () => builder,
                onConnectError: (callback) => {
                  onConnectError = callback
                  return builder
                },
                build: () => {
                  const connection = {
                    ...makeFullModuleWsConnection(),
                    disconnect: () => {
                      disconnectCount = disconnectCount + 1
                    },
                  } satisfies StdbTesting.ManagedWsConnection<
                    typeof FullModule,
                    unknown
                  >

                  onConnectError?.({}, new Error("connect failed"))
                  return connection
                },
              }

              return builder
            },
            uri: "ws://localhost:3000",
            databaseName: "test",
          },
        })

        const exit = yield* Effect.exit(scoped.pipe(Effect.scoped))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(disconnectCount).toBe(1)
      }),
  )

  it.effect("fails acquire when disconnect wins before connect", () =>
    Effect.gen(function* () {
      let disconnectCount = 0

      const scoped = StdbTesting.makeScopedFromModulePlan({
        plan: StdbTesting.makeModulePlan(FullModule),
        config: {
          builder: () => {
            let onDisconnect:
              | ((context: unknown, error?: Error) => void)
              | undefined

            const builder: StdbTesting.GeneratedWsBuilderLike<
              typeof FullModule,
              unknown
            > = {
              withUri: () => builder,
              withDatabaseName: () => builder,
              withToken: () => builder,
              withCompression: () => builder,
              onConnect: () => builder,
              onDisconnect: (callback) => {
                onDisconnect = callback
                return builder
              },
              onConnectError: () => builder,
              build: () => {
                const connection = {
                  ...makeFullModuleWsConnection(),
                  disconnect: () => {
                    disconnectCount = disconnectCount + 1
                  },
                } satisfies StdbTesting.ManagedWsConnection<
                  typeof FullModule,
                  unknown
                >

                onDisconnect?.({ phase: "pre-connect" }, new Error("closed"))
                return connection
              },
            }

            return builder
          },
          uri: "ws://localhost:3000",
          databaseName: "test",
        },
      })

      const exit = yield* Effect.exit(scoped.pipe(Effect.scoped))

      expect(Exit.isFailure(exit)).toBe(true)
      expect(disconnectCount).toBe(1)
    }),
  )

  it.effect("fails acquire when connect disconnects before build returns", () =>
    Effect.gen(function* () {
      let disconnectCount = 0

      const scoped = StdbTesting.makeScopedFromModulePlan({
        plan: StdbTesting.makeModulePlan(FullModule),
        config: {
          builder: () => {
            let onConnect:
              | ((
                  connection: StdbTesting.ManagedWsConnection<
                    typeof FullModule,
                    unknown
                  >,
                  identity: Identity,
                  token: string,
                ) => void)
              | undefined
            let onDisconnect:
              | ((context: unknown, error?: Error) => void)
              | undefined

            const builder: StdbTesting.GeneratedWsBuilderLike<
              typeof FullModule,
              unknown
            > = {
              withUri: () => builder,
              withDatabaseName: () => builder,
              withToken: () => builder,
              withCompression: () => builder,
              onConnect: (callback) => {
                onConnect = callback
                return builder
              },
              onDisconnect: (callback) => {
                onDisconnect = callback
                return builder
              },
              onConnectError: () => builder,
              build: () => {
                const connection = {
                  ...makeFullModuleWsConnection(),
                  disconnect: () => {
                    disconnectCount = disconnectCount + 1
                  },
                } satisfies StdbTesting.ManagedWsConnection<
                  typeof FullModule,
                  unknown
                >

                onConnect?.(connection, Identity.zero(), "token")
                onDisconnect?.({ phase: "after-connect" }, new Error("closed"))
                return connection
              },
            }

            return builder
          },
          uri: "ws://localhost:3000",
          databaseName: "test",
        },
      })

      const exit = yield* Effect.exit(scoped.pipe(Effect.scoped))

      expect(Exit.isFailure(exit)).toBe(true)
      expect(disconnectCount).toBe(1)
    }),
  )

  it.effect(
    "fails acquire when build returns a different connected object",
    () =>
      Effect.gen(function* () {
        let disconnectCount = 0

        const scoped = StdbTesting.makeScopedFromModulePlan({
          plan: StdbTesting.makeModulePlan(FullModule),
          config: {
            builder: () => {
              let onConnect:
                | ((
                    connection: StdbTesting.ManagedWsConnection<
                      typeof FullModule,
                      unknown
                    >,
                    identity: Identity,
                    token: string,
                  ) => void)
                | undefined

              const builder: StdbTesting.GeneratedWsBuilderLike<
                typeof FullModule,
                unknown
              > = {
                withUri: () => builder,
                withDatabaseName: () => builder,
                withToken: () => builder,
                withCompression: () => builder,
                onConnect: (callback) => {
                  onConnect = callback
                  return builder
                },
                onDisconnect: () => builder,
                onConnectError: () => builder,
                build: () => {
                  const emittedConnection = {
                    ...makeFullModuleWsConnection(),
                    disconnect: () => {
                      disconnectCount = disconnectCount + 1
                    },
                  } satisfies StdbTesting.ManagedWsConnection<
                    typeof FullModule,
                    unknown
                  >
                  const returnedConnection = {
                    ...makeFullModuleWsConnection(),
                    disconnect: () => {
                      disconnectCount = disconnectCount + 1
                    },
                  } satisfies StdbTesting.ManagedWsConnection<
                    typeof FullModule,
                    unknown
                  >

                  onConnect?.(emittedConnection, Identity.zero(), "token")
                  return returnedConnection
                },
              }

              return builder
            },
            uri: "ws://localhost:3000",
            databaseName: "test",
          },
        })

        const exit = yield* Effect.exit(scoped.pipe(Effect.scoped))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(disconnectCount).toBe(2)
      }),
  )

  it.effect(
    "fails acquire when async connect emits a different built object",
    () =>
      Effect.gen(function* () {
        let disconnectCount = 0
        let onConnect:
          | ((
              connection: StdbTesting.ManagedWsConnection<
                typeof FullModule,
                unknown
              >,
              identity: Identity,
              token: string,
            ) => void)
          | undefined
        const built = yield* Deferred.make<void>()

        const scoped = StdbTesting.makeScopedFromModulePlan({
          plan: StdbTesting.makeModulePlan(FullModule),
          config: {
            builder: () => {
              const builder: StdbTesting.GeneratedWsBuilderLike<
                typeof FullModule,
                unknown
              > = {
                withUri: () => builder,
                withDatabaseName: () => builder,
                withToken: () => builder,
                withCompression: () => builder,
                onConnect: (callback) => {
                  onConnect = callback
                  return builder
                },
                onDisconnect: () => builder,
                onConnectError: () => builder,
                build: () => {
                  const returnedConnection = {
                    ...makeFullModuleWsConnection(),
                    disconnect: () => {
                      disconnectCount = disconnectCount + 1
                    },
                  } satisfies StdbTesting.ManagedWsConnection<
                    typeof FullModule,
                    unknown
                  >

                  unsafeSucceedDeferred(built, undefined)
                  return returnedConnection
                },
              }

              return builder
            },
            uri: "ws://localhost:3000",
            databaseName: "test",
          },
        })

        const fiber = yield* scoped.pipe(
          Effect.scoped,
          Effect.exit,
          Effect.forkDetach({ startImmediately: true }),
        )
        yield* Deferred.await(built)
        const emittedConnection = {
          ...makeFullModuleWsConnection(),
          disconnect: () => {
            disconnectCount = disconnectCount + 1
          },
        } satisfies StdbTesting.ManagedWsConnection<typeof FullModule, unknown>
        onConnect?.(emittedConnection, Identity.zero(), "token")

        const exit = yield* Fiber.join(fiber)

        expect(Exit.isFailure(exit)).toBe(true)
        expect(disconnectCount).toBe(2)
      }),
  )

  it.effect(
    "fails acquire when disconnect fires before synchronous connect",
    () =>
      Effect.gen(function* () {
        let disconnectCount = 0

        const scoped = StdbTesting.makeScopedFromModulePlan({
          plan: StdbTesting.makeModulePlan(FullModule),
          config: {
            builder: () => {
              let onConnect:
                | ((
                    connection: StdbTesting.ManagedWsConnection<
                      typeof FullModule,
                      unknown
                    >,
                    identity: Identity,
                    token: string,
                  ) => void)
                | undefined
              let onDisconnect:
                | ((context: unknown, error?: Error) => void)
                | undefined

              const builder: StdbTesting.GeneratedWsBuilderLike<
                typeof FullModule,
                unknown
              > = {
                withUri: () => builder,
                withDatabaseName: () => builder,
                withToken: () => builder,
                withCompression: () => builder,
                onConnect: (callback) => {
                  onConnect = callback
                  return builder
                },
                onDisconnect: (callback) => {
                  onDisconnect = callback
                  return builder
                },
                onConnectError: () => builder,
                build: () => {
                  const connection = {
                    ...makeFullModuleWsConnection(),
                    disconnect: () => {
                      disconnectCount = disconnectCount + 1
                    },
                  } satisfies StdbTesting.ManagedWsConnection<
                    typeof FullModule,
                    unknown
                  >

                  onDisconnect?.({ phase: "pre-connect" }, new Error("closed"))
                  onConnect?.(connection, Identity.zero(), "token")
                  onDisconnect?.(
                    { phase: "after-connect" },
                    new Error("closed"),
                  )
                  return connection
                },
              }

              return builder
            },
            uri: "ws://localhost:3000",
            databaseName: "test",
          },
        })

        const exit = yield* Effect.exit(scoped.pipe(Effect.scoped))

        expect(Exit.isFailure(exit)).toBe(true)
        expect(disconnectCount).toBe(1)
      }),
  )

  it.effect("disconnects once when release wins before native connect", () =>
    Effect.gen(function* () {
      let disconnectCount = 0
      let onConnect:
        | ((
            connection: StdbTesting.ManagedWsConnection<
              typeof FullModule,
              unknown
            >,
            identity: Identity,
            token: string,
          ) => void)
        | undefined
      let connection:
        | StdbTesting.ManagedWsConnection<typeof FullModule, unknown>
        | undefined
      const built = yield* Deferred.make<void>()

      const scoped = StdbTesting.makeScopedFromModulePlan({
        plan: StdbTesting.makeModulePlan(FullModule),
        config: {
          builder: () => {
            const builder: StdbTesting.GeneratedWsBuilderLike<
              typeof FullModule,
              unknown
            > = {
              withUri: () => builder,
              withDatabaseName: () => builder,
              withToken: () => builder,
              withCompression: () => builder,
              onConnect: (callback) => {
                onConnect = callback
                return builder
              },
              onDisconnect: () => builder,
              onConnectError: () => builder,
              build: () => {
                connection = {
                  ...makeFullModuleWsConnection(),
                  disconnect: () => {
                    disconnectCount = disconnectCount + 1
                  },
                } satisfies StdbTesting.ManagedWsConnection<
                  typeof FullModule,
                  unknown
                >

                unsafeSucceedDeferred(built, undefined)
                return connection
              },
            }

            return builder
          },
          uri: "ws://localhost:3000",
          databaseName: "test",
        },
      })

      const fiber = yield* scoped.pipe(
        Effect.scoped,
        Effect.forkDetach({ startImmediately: true }),
      )
      yield* Deferred.await(built)
      yield* Fiber.interrupt(fiber)

      expect(disconnectCount).toBe(1)
      if (connection === undefined) {
        expect(connection).toBeDefined()
        return
      }
      onConnect?.(connection, Identity.zero(), "late-token")
      expect(disconnectCount).toBe(1)
    }),
  )

  it.effect("settles once when native connect callbacks repeat", () =>
    Effect.gen(function* () {
      let disconnectCount = 0

      const scoped = StdbTesting.makeScopedFromModulePlan({
        plan: StdbTesting.makeModulePlan(FullModule),
        config: {
          builder: () => {
            let onConnect:
              | ((
                  connection: StdbTesting.ManagedWsConnection<
                    typeof FullModule,
                    unknown
                  >,
                  identity: Identity,
                  token: string,
                ) => void)
              | undefined

            const builder: StdbTesting.GeneratedWsBuilderLike<
              typeof FullModule,
              unknown
            > = {
              withUri: () => builder,
              withDatabaseName: () => builder,
              withToken: () => builder,
              withCompression: () => builder,
              onConnect: (callback) => {
                onConnect = callback
                return builder
              },
              onDisconnect: () => builder,
              onConnectError: () => builder,
              build: () => {
                const connection = {
                  ...makeFullModuleWsConnection(),
                  disconnect: () => {
                    disconnectCount = disconnectCount + 1
                  },
                } satisfies StdbTesting.ManagedWsConnection<
                  typeof FullModule,
                  unknown
                >

                onConnect?.(connection, Identity.zero(), "token")
                onConnect?.(connection, Identity.zero(), "duplicate-token")
                return connection
              },
            }

            return builder
          },
          uri: "ws://localhost:3000",
          databaseName: "test",
        },
      })

      const session = yield* scoped.pipe(Effect.scoped)

      expect(session.token).toBe("token")
      expect(disconnectCount).toBe(1)
    }),
  )

  it.effect("scopes ws session tags per module instead of globally", () =>
    Effect.gen(function* () {
      const full = StdbTesting.project(FullModule)
      const minimal = StdbTesting.project(MinimalModule)

      expect(full.client.ws.tag()).not.toBe(minimal.client.ws.tag())
    }),
  )

  it.effect("uses stable named ws session keys per projected module", () =>
    Effect.gen(function* () {
      const full = StdbTesting.project(FullModule)
      const minimal = StdbTesting.project(MinimalModule)

      expect(full.client.ws.tag().key).toBe(full.client.ws.Session.key)
      expect(full.client.ws.tag("main").key).toBe(
        full.client.ws.tag("main").key,
      )
      expect(full.client.ws.tag("main").key).not.toBe(
        full.client.ws.tag("other").key,
      )
      expect(full.client.ws.tag("main").key).not.toBe(
        minimal.client.ws.tag("main").key,
      )
    }),
  )

  it.effect("provides named projected ws session tags", () =>
    Effect.gen(function* () {
      let disconnectCount = 0
      const full = StdbTesting.project(FullModule)

      const session = yield* full.client.ws.tag("main").pipe(
        Effect.provide(
          full.client.ws.layer(
            {
              builder: () => {
                let onConnect:
                  | ((
                      connection: StdbTesting.ManagedWsConnection<
                        typeof FullModule,
                        unknown
                      >,
                      identity: Identity,
                      token: string,
                    ) => void)
                  | undefined

                const builder: StdbTesting.GeneratedWsBuilderLike<
                  typeof FullModule,
                  unknown
                > = {
                  withUri: () => builder,
                  withDatabaseName: () => builder,
                  withToken: () => builder,
                  withCompression: () => builder,
                  onConnect: (callback) => {
                    onConnect = callback
                    return builder
                  },
                  onDisconnect: () => builder,
                  onConnectError: () => builder,
                  build: () => {
                    const connection = {
                      ...makeFullModuleWsConnection(),
                      disconnect: () => {
                        disconnectCount = disconnectCount + 1
                      },
                    } satisfies StdbTesting.ManagedWsConnection<
                      typeof FullModule,
                      unknown
                    >

                    onConnect?.(connection, Identity.zero(), "named-token")
                    return connection
                  },
                }

                return builder
              },
              uri: "ws://localhost:3000",
              databaseName: "test",
            },
            { name: "main" },
          ),
        ),
      )

      expect(session.token).toBe("named-token")
      expect(disconnectCount).toBe(1)
    }),
  )

  it.effect("passes native builder policy options through", () =>
    Effect.gen(function* () {
      const calls: Array<readonly [string, unknown]> = []

      const scoped = StdbTesting.makeScopedFromModulePlan({
        plan: StdbTesting.makeModulePlan(FullModule),
        config: {
          builder: () => {
            let onConnect:
              | ((
                  connection: StdbTesting.ManagedWsConnection<
                    typeof FullModule,
                    unknown
                  >,
                  identity: Identity,
                  token: string,
                ) => void)
              | undefined

            const builder: StdbTesting.GeneratedWsBuilderLike<
              typeof FullModule,
              unknown
            > = {
              withUri: (value) => {
                calls.push(["uri", value])
                return builder
              },
              withDatabaseName: (value) => {
                calls.push(["databaseName", value])
                return builder
              },
              withToken: (value) => {
                calls.push(["token", value])
                return builder
              },
              withCompression: (value) => {
                calls.push(["compression", value])
                return builder
              },
              withLightMode: (value) => {
                calls.push(["lightMode", value])
                return builder
              },
              withConfirmedReads: (value) => {
                calls.push(["confirmedReads", value])
                return builder
              },
              withWSFn: (value) => {
                calls.push(["wsFn", value])
                return builder
              },
              onConnect: (callback) => {
                onConnect = callback
                return builder
              },
              onDisconnect: () => builder,
              onConnectError: () => builder,
              build: () => {
                const connection = {
                  ...makeFullModuleWsConnection(),
                  disconnect: () => undefined,
                } satisfies StdbTesting.ManagedWsConnection<
                  typeof FullModule,
                  unknown
                >

                onConnect?.(connection, Identity.zero(), "token")
                return connection
              },
            }

            return builder
          },
          uri: "ws://localhost:3000",
          databaseName: "test",
          token: "token",
          compression: "gzip",
          lightMode: true,
          confirmedReads: false,
          createWebSocket: "custom-ws",
          configureBuilder: (builder) => {
            calls.push(["configured", true])
            return builder
          },
        },
      })

      yield* scoped.pipe(Effect.asVoid, Effect.scoped)

      expect(calls).toEqual([
        ["uri", "ws://localhost:3000"],
        ["databaseName", "test"],
        ["token", "token"],
        ["compression", "gzip"],
        ["lightMode", true],
        ["confirmedReads", false],
        ["wsFn", "custom-ws"],
        ["configured", true],
      ])
    }),
  )

  it.effect(
    "creates projected sessions directly from generated DbConnection",
    () =>
      Effect.gen(function* () {
        let disconnectCount = 0
        const full = StdbTesting.project(FullModule)

        const session = yield* full.client.ws
          .scopedGenerated({
            DbConnection: {
              builder: () => {
                let onConnect:
                  | ((
                      connection: StdbTesting.ManagedWsConnection<
                        typeof FullModule,
                        unknown
                      >,
                      identity: Identity,
                      token: string,
                    ) => void)
                  | undefined

                const builder: StdbTesting.GeneratedWsBuilderLike<
                  typeof FullModule,
                  unknown
                > = {
                  withUri: () => builder,
                  withDatabaseName: () => builder,
                  withToken: () => builder,
                  withCompression: () => builder,
                  onConnect: (callback) => {
                    onConnect = callback
                    return builder
                  },
                  onDisconnect: () => builder,
                  onConnectError: () => builder,
                  build: () => {
                    const connection = {
                      ...makeFullModuleWsConnection(),
                      disconnect: () => {
                        disconnectCount = disconnectCount + 1
                      },
                    } satisfies StdbTesting.ManagedWsConnection<
                      typeof FullModule,
                      unknown
                    >

                    onConnect?.(connection, Identity.zero(), "generated-token")
                    return connection
                  },
                }

                return builder
              },
            },
            uri: "ws://localhost:3000",
            databaseName: "test",
          })
          .pipe(Effect.scoped)

        expect(session.token).toBe("generated-token")
        expect(disconnectCount).toBe(1)
      }),
  )
})
