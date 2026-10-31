import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as StdbTesting from "effect-spacetimedb/testing"
import { Identity, UnknownCallResultError } from "spacetimedb"
import { FullModule, UserId, UserName } from "../fixtures/full-module"
import {
  makeFullModuleWsConnection,
  makeStaticRelationHandle,
} from "./ws-fixtures"

/**
 * A native builder double for automatic-reconnect suites: it records what the
 * library configured, and lets a test fire the SDK 2.12 reconnect lifecycle
 * (drops, failed attempts, reconnects, replays, silent socket closes) the way
 * the SDK does.
 */

export const plan = StdbTesting.makeModulePlan(FullModule)
export const connectTimeoutMillis = 1_000
export const automaticReconnect = { delayMillisMin: 500, delayMillisMax: 1_000 }
export const upsert = {
  userId: UserId.make("user-1"),
  name: UserName.make("Ada"),
}

type FullBuilder = StdbTesting.GeneratedWsBuilderLike<
  typeof FullModule,
  unknown
>
type FullConnection = StdbTesting.ManagedWsConnection<
  typeof FullModule,
  unknown
>
type UserRow = StdbTesting.WsTableRow<typeof FullModule.tables.user>
type InsertCallback = (context: unknown, row: UserRow) => void

const uri = "ws://localhost:3000"
const databaseName = "test"

export type Report = {
  readonly error?: Error
  readonly nextAttempt?: number
  readonly delayMs?: number
}

/** One built connection and the native callbacks the library registered. */
type BuiltConnection = {
  readonly connection: FullConnection
  readonly onDisconnect: Parameters<FullBuilder["onDisconnect"]>[0] | undefined
  readonly onConnectError:
    | Parameters<FullBuilder["onConnectError"]>[0]
    | undefined
  readonly onAutomaticReconnect:
    | Parameters<NonNullable<FullBuilder["onAutomaticReconnect"]>>[0]
    | undefined
  readonly setToken: (token: string) => void
  readonly disconnectCount: () => number
  readonly reducerCallCount: () => number
  readonly holdCalls: () => void
  readonly rejectCallsWith: (error: Error) => void
  /** Rejects every held call, as the SDK does when its socket drops. */
  readonly failInFlight: (error: Error) => void
  readonly emitUserInsert: (row: UserRow) => void
  /** The socket closed without delivering its close event, or came back. */
  readonly setSocketClosed: (closed: boolean) => void
}

type PendingSubscription = {
  readonly build: number
  /** The server applied it (again, when an automatic reconnect replays it). */
  readonly apply: () => void
  /** The server refused it (a replay that fails for this query set). */
  readonly fail: (message: string) => void
}

/**
 * A native builder double shaped like SDK 2.12's: it records what the library
 * configured, and lets a test drive the reconnect lifecycle callbacks the
 * way the SDK fires them.
 */
export const makeReconnectHarness = Effect.fn(function* (
  options: {
    readonly omit?: ReadonlyArray<
      "withAutomaticReconnect" | "withTokenProvider" | "onAutomaticReconnect"
    >
  } = {},
) {
  const subscriptions = yield* Queue.unbounded<PendingSubscription>()
  const builds = yield* Queue.unbounded<BuiltConnection>()
  const heldCalls = yield* Queue.unbounded<number>()
  const built: Array<BuiltConnection> = []
  const tokens: Array<string | undefined> = []
  const reconnectOptions: Array<unknown> = []
  const tokenProviders: Array<() => Promise<string>> = []
  const omitted = new Set(options.omit ?? [])

  const builder = (): FullBuilder => {
    let token: string | undefined
    let onConnect: Parameters<FullBuilder["onConnect"]>[0] | undefined
    let onConnectError: BuiltConnection["onConnectError"]
    let onDisconnect: BuiltConnection["onDisconnect"]
    let onAutomaticReconnect: BuiltConnection["onAutomaticReconnect"]

    const current: FullBuilder = {
      withUri: () => current,
      withDatabaseName: () => current,
      withToken: (value) => {
        token = value
        return current
      },
      withCompression: () => current,
      ...(omitted.has("withAutomaticReconnect")
        ? {}
        : {
            withAutomaticReconnect: (value) => {
              reconnectOptions.push(value)
              return current
            },
          }),
      ...(omitted.has("withTokenProvider")
        ? {}
        : {
            withTokenProvider: (provider) => {
              tokenProviders.push(provider)
              return current
            },
          }),
      ...(omitted.has("onAutomaticReconnect")
        ? {}
        : {
            onAutomaticReconnect: (callback) => {
              onAutomaticReconnect = callback
              return current
            },
          }),
      onConnect: (callback) => {
        onConnect = callback
        return current
      },
      onDisconnect: (callback) => {
        onDisconnect = callback
        return current
      },
      onConnectError: (callback) => {
        onConnectError = callback
        return current
      },
      build: () => {
        const build = built.length + 1
        tokens.push(token)
        let liveToken = token ?? `issued-${build.toString()}`
        let disconnects = 0
        let reducerCalls = 0
        let hold = false
        let socketClosed = false
        let rejection: Error | undefined
        const inFlight = new Set<(error: Error) => void>()
        const inserts = new Set<InsertCallback>()
        const userRelation = {
          ...makeStaticRelationHandle<UserRow>(),
          onInsert: (callback: InsertCallback) => {
            inserts.add(callback)
          },
          removeOnInsert: (callback: InsertCallback) => {
            inserts.delete(callback)
          },
          id: { find: (_id: UserRow["id"]) => null },
        }
        const subscriptionBuilder = (): StdbTesting.SubscriptionBuilderLike<
          unknown,
          StdbTesting.ClientQueryRoot<typeof FullModule>
        > => {
          let onApplied: (() => void) | undefined
          let onError: ((context: unknown, error?: Error) => void) | undefined
          const self: StdbTesting.SubscriptionBuilderLike<
            unknown,
            StdbTesting.ClientQueryRoot<typeof FullModule>
          > = {
            onApplied: (callback) => {
              onApplied = callback
              return self
            },
            onError: (callback) => {
              onError = callback
              return self
            },
            subscribe: () => {
              let ended = false
              Queue.offerUnsafe(subscriptions, {
                build,
                apply: () => onApplied?.(),
                fail: (message) => onError?.({}, new Error(message)),
              })
              return {
                isEnded: () => ended,
                unsubscribe: () => {
                  ended = true
                },
              }
            },
          }
          return self
        }
        const connection: FullConnection = {
          ...makeFullModuleWsConnection({
            db: { user: userRelation },
            subscriptionBuilder,
          }),
          get token() {
            return liveToken
          },
          get isSocketClosed() {
            return socketClosed
          },
          callReducerWithParams: () => {
            reducerCalls += 1
            if (rejection !== undefined) {
              return Promise.reject(rejection)
            }
            if (!hold) {
              return Promise.resolve()
            }
            const pending = Promise.withResolvers<void>()
            inFlight.add(pending.reject)
            Queue.offerUnsafe(heldCalls, build)
            return pending.promise
          },
          callProcedureWithParams: () => Promise.resolve(undefined),
          disconnect: () => {
            disconnects += 1
          },
        }
        const record: BuiltConnection = {
          connection,
          onDisconnect,
          onConnectError,
          onAutomaticReconnect,
          setToken: (next) => {
            liveToken = next
          },
          disconnectCount: () => disconnects,
          reducerCallCount: () => reducerCalls,
          holdCalls: () => {
            hold = true
          },
          rejectCallsWith: (error) => {
            rejection = error
          },
          failInFlight: (error) => {
            const pending = [...inFlight]
            inFlight.clear()
            for (const reject of pending) reject(error)
          },
          emitUserInsert: (row) => {
            for (const callback of inserts) callback({}, row)
          },
          setSocketClosed: (closed) => {
            socketClosed = closed
          },
        }
        built.push(record)
        Queue.offerUnsafe(builds, record)
        onConnect?.(connection, Identity.zero(), liveToken)
        return connection
      },
    }
    return current
  }

  const at = (build: number): BuiltConnection => {
    const record = built[build - 1]
    if (record === undefined) {
      throw new Error(`no connection was built for attempt ${build.toString()}`)
    }
    return record
  }

  return {
    builder,
    buildCount: () => built.length,
    tokens: () => [...tokens],
    reconnectOptions: () => [...reconnectOptions],
    tokenProviders: () => [...tokenProviders],
    at,
    /**
     * The socket dropped. Like the SDK, fail what was in flight first, then
     * report the drop with the retry scheduled, if any.
     */
    drop: (build: number, report: Report = {}) => {
      at(build).failInFlight(new UnknownCallResultError())
      at(build).onDisconnect?.(
        at(build).connection,
        report.error,
        report.nextAttempt,
        report.delayMs,
      )
    },
    /** A connect or reconnect attempt failed. */
    attemptFailed: (
      build: number,
      report: Report & { readonly error: Error },
    ) =>
      at(build).onConnectError?.(
        at(build).connection,
        report.error,
        report.nextAttempt,
        report.delayMs,
      ),
    /** The SDK re-established the connection on its own. */
    reconnect: (build: number) =>
      at(build).onAutomaticReconnect?.(
        at(build).connection,
        Identity.zero(),
        at(build).connection.token ?? "",
      ),
    nextBuild: Queue.take(builds),
    nextSubscription: Queue.take(subscriptions),
    /** Resolves once a held call is in flight on the SDK. */
    nextHeldCall: Queue.take(heldCalls),
  }
})

export const reconnectConfig = (
  harness: { readonly builder: () => FullBuilder },
  overrides: Partial<
    StdbTesting.WsBuilderConfig<typeof FullModule, unknown>
  > = {},
): StdbTesting.WsBuilderConfig<typeof FullModule, unknown> => ({
  builder: harness.builder,
  uri,
  databaseName,
  connectTimeoutMillis,
  automaticReconnect,
  ...overrides,
})

export const awaitPhase = <Failure>(
  phase: SubscriptionRef.SubscriptionRef<
    StdbTesting.WsSessionSupervisorPhase<Failure>
  >,
  predicate: (value: StdbTesting.WsSessionSupervisorPhase<Failure>) => boolean,
) =>
  SubscriptionRef.changes(phase).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  )

export const recoveringReport = {
  error: new Error("WebSocket closed (code 1006)"),
  nextAttempt: 1,
  delayMs: 500,
}
