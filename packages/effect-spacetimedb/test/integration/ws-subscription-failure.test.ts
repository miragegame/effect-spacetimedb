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
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { Identity } from "spacetimedb"

const { expect } = EffectVitest

import * as StdbTesting from "effect-spacetimedb/testing"
import { connectionStateFor } from "../../src/client/connection-state.ts"
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

const throwInvalidationObserver = (): void => {
  throw new Error("observer defect")
}

const makeConnection = () => {
  let pendingOnApplied: (() => void) | undefined
  let pendingOnError:
    | ((value: SdkErrorContext, error?: Error) => void)
    | undefined
  const callbacks: Array<{
    readonly onApplied: () => void
    readonly onError: (value: SdkErrorContext, error?: Error) => void
  }> = []
  let subscribeCalls = 0
  const firstSubscribeStarted = Deferred.makeUnsafe<void>()
  const secondSubscribeStarted = Deferred.makeUnsafe<void>()
  const thirdSubscribeStarted = Deferred.makeUnsafe<void>()
  const fourthSubscribeStarted = Deferred.makeUnsafe<void>()
  const subscribeStartedByCount = [
    firstSubscribeStarted,
    secondSubscribeStarted,
    thirdSubscribeStarted,
    fourthSubscribeStarted,
  ] as const
  const userRows: Array<{ readonly id: never; readonly name: never }> = []
  const insertCallbacks = new Set<
    (
      context: unknown,
      row: { readonly id: never; readonly name: never },
    ) => void
  >()
  const userRelation = {
    ...makeStaticRelationHandle<(typeof userRows)[number]>(),
    onInsert: (
      callback: (context: unknown, row: (typeof userRows)[number]) => void,
    ) => {
      insertCallbacks.add(callback)
    },
    removeOnInsert: (
      callback: (context: unknown, row: (typeof userRows)[number]) => void,
    ) => {
      insertCallbacks.delete(callback)
    },
    iter: () => userRows.values(),
  }

  const builder = {
    onApplied: (callback: () => void) => {
      pendingOnApplied = callback
      return builder
    },
    onError: (callback: (value: SdkErrorContext, error?: Error) => void) => {
      pendingOnError = callback
      return builder
    },
    subscribe: (_query: unknown) => {
      subscribeCalls = subscribeCalls + 1
      if (pendingOnApplied == null || pendingOnError == null) {
        throw new Error("subscription callbacks were not registered")
      }
      callbacks.push({
        onApplied: pendingOnApplied,
        onError: pendingOnError,
      })
      pendingOnApplied = undefined
      pendingOnError = undefined
      if (subscribeCalls === 1) {
        Deferred.doneUnsafe(firstSubscribeStarted, Effect.void)
      }
      if (subscribeCalls === 2) {
        Deferred.doneUnsafe(secondSubscribeStarted, Effect.void)
      }
      if (subscribeCalls === 3) {
        Deferred.doneUnsafe(thirdSubscribeStarted, Effect.void)
      }
      if (subscribeCalls === 4) {
        Deferred.doneUnsafe(fourthSubscribeStarted, Effect.void)
      }
      return {
        isEnded: () => false,
        unsubscribe: () => undefined,
      }
    },
  }

  return {
    connection: {
      db: makeFullModuleWsDb({ user: userRelation as never }),
      subscriptionBuilder: () => builder,
    },
    apply: (index = callbacks.length - 1) => {
      callbacks[index]?.onApplied()
    },
    fail: (
      value: SdkErrorContext,
      error?: Error,
      index = callbacks.length - 1,
    ) => {
      callbacks[index]?.onError(value, error)
    },
    awaitSubscribeCalls: Effect.fn(function* (count: 1 | 2 | 3 | 4) {
      yield* Deferred.await(subscribeStartedByCount[count - 1]!)
      yield* Effect.yieldNow
    }),
    subscribeCalls: () => subscribeCalls,
    emitUserInsert: (id: string, name: string) => {
      const row = { id: id as never, name: name as never }
      userRows.push(row)
      for (const callback of insertCallbacks) {
        callback({}, row)
      }
    },
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
        expect(fiber.pollUnsafe()).toBeUndefined()
        expect(unsubscribed).toBe(false)
        yield* Fiber.interrupt(fiber)
        expect(unsubscribed).toBe(true)
      }).pipe(Effect.scoped)
    },
  )

  it.effect("allows future subscriptions after a post-applied rejection", () =>
    Effect.gen(function* () {
      const shared = makeConnection()
      const session = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: shared.connection,
      })
      const activeFiber = yield* runTableStream(session).pipe(Effect.forkScoped)
      yield* shared.awaitSubscribeCalls(1)
      shared.apply()
      shared.fail(
        sdkErrorContext("context invalidated"),
        new Error("connection invalidated"),
      )
      const activeExit = yield* activeFiber.pipe(Fiber.join, Effect.exit)
      expect(Exit.isFailure(activeExit)).toBe(true)
      if (Exit.isFailure(activeExit)) {
        expect(
          Option.getOrUndefined(Cause.findErrorOption(activeExit.cause)),
        ).toBeInstanceOf(StdbTesting.SubscriptionRejectedError)
      }
      expect(session.isInvalidated()).toBe(false)

      const futureFiber = yield* runTableStream(session).pipe(Effect.forkScoped)
      yield* shared.awaitSubscribeCalls(2)
      shared.apply()
      yield* Effect.yieldNow
      expect(futureFiber.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(futureFiber)
      expect(shared.subscribeCalls()).toBe(2)
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
    "invalidates every live stream when an earlier observer throws",
    () =>
      Effect.gen(function* () {
        const shared = makeConnection()
        const session = StdbTesting.ClientWs.make({
          module: FullModule,
          connection: shared.connection,
        })

        yield* session.observeInvalidation(throwInvalidationObserver)
        const first = yield* runTableStream(session).pipe(Effect.forkScoped)
        yield* shared.awaitSubscribeCalls(1)
        const second = yield* runTableStream(session).pipe(Effect.forkScoped)
        yield* shared.awaitSubscribeCalls(2)
        shared.apply(0)
        shared.apply(1)
        yield* Effect.yieldNow

        connectionStateFor(shared.connection).invalidateFromTransport(
          "transport closed",
        )

        const exits = yield* Effect.all([
          Fiber.await(first),
          Fiber.await(second),
        ])
        yield* Effect.forEach(
          exits,
          (exit) =>
            Effect.suspend(() => {
              expect(Exit.isFailure(exit)).toBe(true)
              if (Exit.isFailure(exit)) {
                expect(
                  Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
                ).toMatchObject({
                  raw: "transport closed",
                })
              }
              return Effect.void
            }),
          { discard: true },
        )
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

            const observed: Array<string> = []
            yield* session.observeInvalidation((invalidation) => {
              observed.push(`early:${invalidation.message}`)
            })

            scoped.emitDisconnect(new Error("socket closed"))
            scoped.emitDisconnect(new Error("socket closed again"))
            expect(session.isInvalidated()).toBe(true)
            expect(observed).toEqual(["early:socket closed"])

            yield* session.observeInvalidation((invalidation) => {
              observed.push(`late:${invalidation.message}`)
            })
            expect(observed).toEqual([
              "early:socket closed",
              "late:socket closed",
            ])
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
    "keeps unrelated streams, refs, and future subscriptions alive",
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

        const rightFiber = yield* right
          .streamTable("user")
          .pipe(Stream.runHead, Effect.forkScoped)
        yield* shared.awaitSubscribeCalls(2)
        shared.apply(1)

        const rightRef = yield* right.subscribeTableRef("user")
        yield* shared.awaitSubscribeCalls(3)
        shared.apply(2)
        yield* SubscriptionRef.changes(rightRef).pipe(
          Stream.filter(AsyncResult.isSuccess),
          Stream.runHead,
        )

        shared.fail(
          sdkErrorContext("context invalidated"),
          new Error("connection invalidated"),
          0,
        )

        const leftExit = yield* leftFiber.pipe(Fiber.join, Effect.exit)
        expect(Exit.isFailure(leftExit)).toBe(true)
        if (Exit.isFailure(leftExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(leftExit.cause)),
          ).toBeInstanceOf(StdbTesting.SubscriptionRejectedError)
        }
        shared.emitUserInsert("user-1", "Ada")
        const rightChange = yield* Fiber.join(rightFiber)
        expect(Option.isSome(rightChange)).toBe(true)
        if (Option.isSome(rightChange)) {
          expect(rightChange.value).toMatchObject({
            _tag: "Insert",
            row: { id: "user-1", name: "Ada" },
          })
        }
        const rightRefValue = yield* SubscriptionRef.changes(rightRef).pipe(
          Stream.filter(
            (value) => AsyncResult.isSuccess(value) && value.value.length === 1,
          ),
          Stream.runHead,
        )
        expect(Option.isSome(rightRefValue)).toBe(true)

        const futureFiber = yield* runTableStream(right).pipe(Effect.forkScoped)
        yield* shared.awaitSubscribeCalls(4)
        shared.apply(3)
        yield* Effect.yieldNow
        expect(futureFiber.pollUnsafe()).toBeUndefined()
        expect(left.isInvalidated()).toBe(false)
        expect(right.isInvalidated()).toBe(false)
      }).pipe(Effect.scoped),
  )
})
