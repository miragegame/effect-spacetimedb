import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Latch from "effect/Latch"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { Identity } from "spacetimedb"

const { expect } = EffectVitest

import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"
import {
  makeFullModuleWsDb,
  makeStaticRelationHandle,
} from "../helpers/ws-fixtures"

const describe = EffectVitest.layer(TestLayer)
const Full = StdbTesting.project(FullModule)

const runTableStream = (session: {
  readonly streamTable: (
    key: "user",
  ) => Stream.Stream<unknown, StdbTesting.SubscriptionFailure, Scope.Scope>
}) => session.streamTable("user").pipe(Stream.runForEach(() => Effect.void))

type SdkErrorContext = {
  readonly event?: Error
}

const sdkErrorContext = (message: string): SdkErrorContext => ({
  event: new Error(message),
})

const makeConnection = () => {
  let onApplied: (() => void) | undefined
  let onError: ((value: SdkErrorContext, error?: Error) => void) | undefined
  let subscribeCalls = 0
  const firstSubscribeStarted = Deferred.makeUnsafe<void>()
  const secondSubscribeStarted = Deferred.makeUnsafe<void>()
  const subscribeStartedByCount = [
    firstSubscribeStarted,
    secondSubscribeStarted,
  ] as const

  const builder = {
    onApplied: (callback: () => void) => {
      onApplied = callback
      return builder
    },
    onError: (callback: (value: SdkErrorContext, error?: Error) => void) => {
      onError = callback
      return builder
    },
    subscribe: (_query: unknown) => {
      subscribeCalls = subscribeCalls + 1
      if (subscribeCalls === 1) {
        Deferred.doneUnsafe(firstSubscribeStarted, Effect.void)
      }
      if (subscribeCalls === 2) {
        Deferred.doneUnsafe(secondSubscribeStarted, Effect.void)
      }
      return {
        isEnded: () => false,
        unsubscribe: () => undefined,
      }
    },
  }

  return {
    connection: {
      db: makeFullModuleWsDb(),
      subscriptionBuilder: () => builder,
    },
    apply: () => {
      onApplied?.()
    },
    fail: (value: SdkErrorContext, error?: Error) => {
      onError?.(value, error)
    },
    awaitSubscribeCalls: Effect.fn(function* (count: 1 | 2) {
      yield* Deferred.await(subscribeStartedByCount[count - 1]!)
      yield* Effect.yieldNow
    }),
    subscribeCalls: () => subscribeCalls,
  }
}

const makeScopedBuilder = () => {
  let disconnectCallback:
    | ((context: unknown, error?: Error) => void)
    | undefined
  let disconnectCount = 0

  const connection = {
    db: makeFullModuleWsDb(),
    subscriptionBuilder: () => ({
      onApplied: () => {
        throw new Error("unexpected subscriptionBuilder.onApplied")
      },
      onError: () => {
        throw new Error("unexpected subscriptionBuilder.onError")
      },
      subscribe: () => {
        throw new Error("unexpected subscriptionBuilder.subscribe")
      },
    }),
    disconnect: () => {
      disconnectCount = disconnectCount + 1
    },
  }

  const builder = {
    withUri: () => builder,
    withDatabaseName: () => builder,
    withToken: () => builder,
    withCompression: () => builder,
    onConnect: (
      callback: (
        connection: StdbTesting.ClientWs.WsConnectionLike<
          typeof FullModule,
          unknown
        > & {
          readonly disconnect: () => void
        },
        identity: Identity,
        token: string,
      ) => void,
    ) => {
      callback(connection, Identity.zero(), "session-token")
      return builder
    },
    onDisconnect: (callback: (context: unknown, error?: Error) => void) => {
      disconnectCallback = callback
      return builder
    },
    onConnectError: () => builder,
    build: () => connection,
  }

  return {
    buildConfig: {
      builder: () => builder,
      uri: "ws://localhost:3000",
      databaseName: "example",
      token: "builder-token",
      compression: "none" as const,
    },
    disconnectCount: () => disconnectCount,
    emitDisconnect: (error?: Error) => {
      disconnectCallback?.({}, error)
    },
  }
}

describe("ws subscription failures", (it) => {
  it.effect(
    "surfaces pre-apply rejection without invalidating the connection cache",
    () =>
      Effect.gen(function* () {
        const onErrorRegistered =
          Deferred.makeUnsafe<(value: SdkErrorContext, error?: Error) => void>()
        const builder = {
          onApplied: () => builder,
          onError: (
            callback: (value: SdkErrorContext, error?: Error) => void,
          ) => {
            Deferred.doneUnsafe(onErrorRegistered, Effect.succeed(callback))
            return builder
          },
          subscribe: () => ({
            isEnded: () => false,
            unsubscribe: () => undefined,
          }),
        }

        const session = StdbTesting.ClientWs.make({
          module: FullModule,
          connection: {
            db: makeFullModuleWsDb(),
            subscriptionBuilder: () => builder,
          },
        })

        const fiber = yield* Effect.forkScoped(runTableStream(session))
        const onError = yield* Deferred.await(onErrorRegistered)
        yield* Effect.yieldNow
        onError(sdkErrorContext("context rejected"), new Error("rejected"))

        const exit = yield* Fiber.await(fiber)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
          ).toMatchObject({
            raw: "rejected",
          })
        }
        expect(session.isInvalidated()).toBe(false)
      }).pipe(Effect.scoped),
  )

  it.effect(
    "releases successful subscriptions when the surrounding scope closes",
    () => {
      const appliedRegistered = Deferred.makeUnsafe<() => void>()
      let unsubscribed = false
      const builder = {
        onApplied: (callback: () => void) => {
          Deferred.doneUnsafe(appliedRegistered, Effect.succeed(callback))
          return builder
        },
        onError: () => builder,
        subscribe: () => ({
          isEnded: () => unsubscribed,
          unsubscribe: () => {
            unsubscribed = true
          },
        }),
      }

      const session = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: {
          db: makeFullModuleWsDb(),
          subscriptionBuilder: () => builder,
        },
      })

      return Effect.gen(function* () {
        yield* runTableStream(session).pipe(Effect.forkScoped)
        const applied = yield* Deferred.await(appliedRegistered)
        yield* Effect.yieldNow
        applied()
        yield* Effect.yieldNow
        expect(unsubscribed).toBe(false)
      }).pipe(
        Effect.scoped,
        Effect.tap(() =>
          Effect.suspend(() => {
            expect(unsubscribed).toBe(true)
            return Effect.void
          }),
        ),
      )
    },
  )

  it.effect(
    "releases pending subscriptions when interrupted before apply",
    () => {
      const subscribeStarted = Latch.makeUnsafe()
      let unsubscribed = false
      const builder = {
        onApplied: () => builder,
        onError: () => builder,
        subscribe: () => {
          Latch.openUnsafe(subscribeStarted)
          return {
            isEnded: () => unsubscribed,
            unsubscribe: () => {
              unsubscribed = true
            },
          }
        },
      }

      const session = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: {
          db: makeFullModuleWsDb(),
          subscriptionBuilder: () => builder,
        },
      })

      return Effect.gen(function* () {
        const fiber = yield* Effect.forkDetach(runTableStream(session), {
          startImmediately: true,
        })
        yield* Latch.await(subscribeStarted)
        yield* Effect.yieldNow
        expect(fiber.pollUnsafe() === undefined).toBe(true)
        expect(unsubscribed).toBe(false)
        yield* Fiber.interrupt(fiber)
        expect(unsubscribed).toBe(true)
      }).pipe(Effect.scoped)
    },
  )

  it.effect(
    "fails stream setup when the session has already been invalidated",
    () =>
      Effect.gen(function* () {
        const shared = makeConnection()
        const session = StdbTesting.ClientWs.make({
          module: FullModule,
          connection: shared.connection,
        })
        const activeFiber = yield* runTableStream(session).pipe(
          Effect.forkScoped,
        )
        yield* shared.awaitSubscribeCalls(1)
        shared.apply()
        shared.fail(
          sdkErrorContext("context invalidated"),
          new Error("connection invalidated"),
        )
        yield* activeFiber.pipe(Fiber.join, Effect.exit)

        const exit = yield* Effect.exit(
          runTableStream(session).pipe(Effect.scoped),
        )

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
          ).toBeInstanceOf(StdbTesting.SubscriptionInvalidatedError)
        }
        expect(shared.subscribeCalls()).toBe(1)
      }).pipe(Effect.scoped),
  )

  it.effect("fails stream setup when native subscribe throws", () =>
    Effect.gen(function* () {
      const session = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: {
          db: makeFullModuleWsDb(),
          subscriptionBuilder: () => ({
            onApplied: () => {
              throw new Error("unexpected subscriptionBuilder.onApplied")
            },
            onError: () => {
              throw new Error("unexpected subscriptionBuilder.onError")
            },
            subscribe: () => {
              throw new Error("subscribe boom")
            },
          }),
        },
      })

      const exit = yield* Effect.exit(
        runTableStream(session).pipe(Effect.scoped),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(
          Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
        ).toBeInstanceOf(StdbTesting.SubscriptionTransportError)
      }
    }),
  )

  it.effect(
    "fails streams with typed decode errors raised from relation callbacks",
    () =>
      Effect.gen(function* () {
        const appliedRegistered = Deferred.makeUnsafe<() => void>()
        const insertRegistered =
          Deferred.makeUnsafe<
            (context: unknown, row: Record<string, unknown>) => void
          >()
        const relation = {
          ...makeStaticRelationHandle<Record<string, unknown>>(),
          onInsert: (
            callback: (context: unknown, row: Record<string, unknown>) => void,
          ) => {
            Deferred.doneUnsafe(insertRegistered, Effect.succeed(callback))
          },
        }
        const builder = {
          onApplied: (callback: () => void) => {
            Deferred.doneUnsafe(appliedRegistered, Effect.succeed(callback))
            return builder
          },
          onError: () => builder,
          subscribe: () => ({
            isEnded: () => false,
            unsubscribe: () => undefined,
          }),
        }
        const session = StdbTesting.ClientWs.make({
          module: FullModule,
          connection: {
            db: makeFullModuleWsDb({
              user: relation as never,
            }),
            subscriptionBuilder: () => builder,
          },
        })

        const fiber = yield* Effect.forkScoped(runTableStream(session))
        const [applied, insert] = yield* Effect.all([
          Deferred.await(appliedRegistered),
          Deferred.await(insertRegistered),
        ])
        yield* Effect.yieldNow
        applied()

        insert({}, { id: "user-1" })
        const exit = yield* Fiber.await(fiber)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
          )
          expect(failure).toBeInstanceOf(StdbTesting.StdbDecodeError)
          if (failure instanceof StdbTesting.StdbDecodeError) {
            expect(failure.table).toBe("user")
            expect(failure.phase).toBe("row")
          }
        }
      }).pipe(Effect.scoped),
  )

  it.effect(
    "wsScoped surfaces handshake metadata and invalidates on disconnect before scope cleanup",
    () =>
      Effect.gen(function* () {
        const scoped = makeScopedBuilder()

        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const session = yield* Full.client.ws.scoped(scoped.buildConfig)

            expect(session.token).toBe("session-token")
            expect(session.identity).toEqual(Identity.zero())
            expect(scoped.disconnectCount()).toBe(0)

            scoped.emitDisconnect(new Error("socket closed"))
            expect(session.isInvalidated()).toBe(true)
          }).pipe(Effect.scoped),
        )

        expect(Exit.isSuccess(exit)).toBe(true)
        expect(scoped.disconnectCount()).toBe(0)
      }),
  )

  it.effect("wsScoped disconnects once on ordinary scope close", () =>
    Effect.gen(function* () {
      const scoped = makeScopedBuilder()

      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const session = yield* Full.client.ws.scoped(scoped.buildConfig)
          expect(session.isInvalidated()).toBe(false)
        }).pipe(Effect.scoped),
      )

      expect(Exit.isSuccess(exit)).toBe(true)
      expect(scoped.disconnectCount()).toBe(1)
    }),
  )

  it.effect(
    "propagates invalidation across wrappers over the same raw connection",
    () =>
      Effect.gen(function* () {
        const shared = makeConnection()
        const left = StdbTesting.ClientWs.make({
          module: FullModule,
          connection: shared.connection,
        })
        const right = StdbTesting.ClientWs.make({
          module: FullModule,
          connection: shared.connection,
        })

        const leftFiber = yield* Effect.forkDetach(runTableStream(left), {
          startImmediately: true,
        })
        yield* shared.awaitSubscribeCalls(1)
        shared.apply()

        const rightFiber = yield* right.streamEventTable("presenceEvent").pipe(
          Stream.runForEach(() => Effect.void),
          Effect.forkScoped,
        )
        yield* shared.awaitSubscribeCalls(2)
        shared.apply()

        shared.fail(
          sdkErrorContext("context invalidated"),
          new Error("connection invalidated"),
        )

        const leftExit = yield* leftFiber.pipe(Fiber.join, Effect.exit)
        const rightExit = yield* rightFiber.pipe(Fiber.join, Effect.exit)
        expect(Exit.isFailure(leftExit)).toBe(true)
        if (Exit.isFailure(leftExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(leftExit.cause)),
          ).toBeInstanceOf(StdbTesting.SubscriptionInvalidatedError)
        }
        expect(Exit.isFailure(rightExit)).toBe(true)
        if (Exit.isFailure(rightExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(rightExit.cause)),
          ).toBeInstanceOf(StdbTesting.SubscriptionInvalidatedError)
        }
        expect(left.isInvalidated()).toBe(true)
        expect(right.isInvalidated()).toBe(true)
      }).pipe(Effect.scoped),
  )
})
