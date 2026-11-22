import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
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

export const plan = StdbInternal.makeModulePlan(FullModule)
export const connectDurationMax = 1_000
export const automaticReconnect = { delayMin: 500, delayMax: 1_000 }
export const upsert = {
  userId: UserId.make("user-1"),
  name: UserName.make("Ada"),
}

type FullBuilder = StdbInternal.GeneratedWsBuilderLike<
  typeof FullModule,
  unknown
>
type FullConnection = StdbInternal.ManagedWsConnection<
  typeof FullModule,
  unknown
>
type UserRow = StdbInternal.WsTableRow<typeof FullModule.tables.user>
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
    /** The socket error each numbered build fails to connect with. */
    readonly connectFailures?: ReadonlyMap<number, Error>
    /** The identity each numbered build connects as; by default they share one. */
    readonly identityOf?: (build: number) => Identity
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
  const identityOf = options.identityOf ?? (() => Identity.zero())

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
        const subscriptionBuilder = (): StdbInternal.SubscriptionBuilderLike<
          unknown,
          StdbInternal.ClientQueryRoot<typeof FullModule>
        > => {
          let onApplied: (() => void) | undefined
          let onError: ((context: unknown, error?: Error) => void) | undefined
          const self: StdbInternal.SubscriptionBuilderLike<
            unknown,
            StdbInternal.ClientQueryRoot<typeof FullModule>
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
        const answerOrHold = <A>(answer: A): Promise<A> => {
          if (rejection !== undefined) {
            return Promise.reject(rejection)
          }
          if (!hold) {
            return Promise.resolve(answer)
          }
          const pending = Promise.withResolvers<A>()
          inFlight.add(pending.reject)
          Queue.offerUnsafe(heldCalls, build)
          return pending.promise
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
            return answerOrHold<void>(undefined)
          },
          callProcedureWithParams: () => answerOrHold(undefined),
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
        const connectFailure = options.connectFailures?.get(build)
        if (connectFailure === undefined) {
          onConnect?.(connection, identityOf(build), liveToken)
        } else {
          onConnectError?.(connection, connectFailure)
        }
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
        identityOf(build),
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
    StdbInternal.WsBuilderConfig<typeof FullModule, unknown>
  > = {},
): StdbInternal.WsBuilderConfig<typeof FullModule, unknown> => ({
  builder: harness.builder,
  uri,
  databaseName,
  connectDurationMax,
  automaticReconnect,
  ...overrides,
})

export const awaitPhase = <Failure>(
  phase: SubscriptionRef.SubscriptionRef<
    StdbInternal.WsSessionSupervisorPhase<Failure>
  >,
  predicate: (value: StdbInternal.WsSessionSupervisorPhase<Failure>) => boolean,
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
