import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import {
  CallNotSentError,
  ConnectionIdentityChangedError,
  ConnectionLostError,
  type TableChange,
  WsConnectError,
  type WsSessionSupervisorHandle,
  type WsSessionSupervisorPhase,
  type WsToken,
  wsSupervisor,
} from "effect-spacetimedb/client"
import {
  decodeUserId,
  decodeUserName,
  LIVE_TEST_TIMEOUT_MS,
  Live,
  LiveModule,
  type UserRow,
  wireFunction,
} from "./helpers/example-live"
import {
  type DroppableSockets,
  makeDroppableSockets,
} from "./helpers/droppable-websocket"
import {
  callLiveReducer,
  type LiveHarness,
  liveHarness,
  provideLiveTest,
} from "./helpers/live-harness"

const { describe, expect, live } = EffectVitest

/** The SDK's minimum backoff: 500 ms before the first attempt, 1 s cap. */
const automaticReconnect = { delayMillisMin: 500, delayMillisMax: 1_000 }

/** A supervisor that replaces a lost session without a noticeable wait. */
const supervisorPolicy = {
  reconnectDelayMillisFirst: 50,
  reconnectDelayMillisMax: 50,
  reconnectJitter: false,
}

const TokenResponse = Schema.Struct({ token: Schema.String })

const postForToken = (url: string, bearer?: string) =>
  HttpClient.execute(
    bearer === undefined
      ? HttpClientRequest.post(url)
      : HttpClientRequest.post(url).pipe(HttpClientRequest.bearerToken(bearer)),
  ).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenResponse)),
    Effect.map((body) => body.token),
  )

/** A token for a new anonymous identity. It carries no expiry. */
const mintAnonymousToken = (live: LiveHarness) =>
  postForToken(`${live.baseUrl}/v1/identity`)

/** A token for the same identity as `token`, expiring in 60 s. */
const mintShortLivedToken = (live: LiveHarness, token: string) =>
  postForToken(`${live.baseUrl}/v1/identity/websocket-token`, token)

/**
 * A token Effect that hands out `tokens` in order (the last one repeatedly)
 * and records every evaluation.
 */
const scriptedToken = (tokens: ReadonlyArray<string>) => {
  const evaluations: Array<string> = []
  const token: WsToken = Effect.suspend(() => {
    const next = tokens[Math.min(evaluations.length, tokens.length - 1)] ?? ""
    evaluations.push(next)
    return Effect.succeed(next)
  })
  return { token, evaluations }
}

const reconnectingConfig = (
  live: LiveHarness,
  sockets: DroppableSockets,
  token?: WsToken,
) => ({
  ...live.makeWsConfig(LiveModule),
  createWebSocket: sockets.createWebSocket,
  automaticReconnect,
  ...(token === undefined ? {} : { token }),
})

const awaitPhase = <Failure>(
  phase: SubscriptionRef.SubscriptionRef<WsSessionSupervisorPhase<Failure>>,
  predicate: (value: WsSessionSupervisorPhase<Failure>) => boolean,
) =>
  SubscriptionRef.changes(phase).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  )

const liveSession = <Session, Failure>(
  supervisor: WsSessionSupervisorHandle<Session, Failure>,
) =>
  SubscriptionRef.get(supervisor.session).pipe(
    Effect.flatMap((result) =>
      AsyncResult.isSuccess(result)
        ? Effect.succeed(result.value)
        : Effect.die("the supervisor published no session"),
    ),
  )

const runId = () => globalThis.crypto.randomUUID().slice(0, 8)

describe("effect-spacetimedb live ws automatic reconnect", () => {
  live(
    "keeps the session, its identity and cached rows across a dropped socket and replays its subscriptions",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const sockets = yield* makeDroppableSockets
          const reconnected = yield* Queue.unbounded<void>()
          const supervisor = yield* wsSupervisor({
            module: LiveModule,
            config: reconnectingConfig(live, sockets),
            subscriptionTargets: [Live.targets.tables.user],
            onAutomaticReconnect: () => Queue.offer(reconnected, undefined),
          })
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 1,
          )
          const session = yield* liveSession(supervisor)
          const identity = session.identity
          const run = runId()
          const ids = {
            probe: decodeUserId(`${run}-probe`),
            stable: decodeUserId(`${run}-stable`),
            renamed: decodeUserId(`${run}-renamed`),
            added: decodeUserId(`${run}-added`),
            sentinel: decodeUserId(`${run}-sentinel`),
          }
          yield* session.reducers.userUpsert({
            userId: ids.stable,
            name: decodeUserName("Ada"),
          })
          yield* session.reducers.userUpsert({
            userId: ids.renamed,
            name: decodeUserName("Grace"),
          })

          // Every row change the session reports from here on.
          const changes = yield* Queue.unbounded<TableChange<UserRow>>()
          yield* session.streamTable("user").pipe(
            Stream.runForEach((change) => Queue.offer(changes, change)),
            Effect.forkScoped,
          )
          // A native subscription observes each (re)application.
          const applied = yield* Queue.unbounded<void>()
          session.connection
            .subscriptionBuilder()
            .onApplied(() => {
              Queue.offerUnsafe(applied, undefined)
            })
            .subscribe((tables) => tables.user)
          yield* Queue.take(applied)
          // The probe's insert proves the stream is subscribed; start clean.
          yield* session.reducers.userUpsert({
            userId: ids.probe,
            name: decodeUserName("Probe"),
          })
          yield* Stream.fromQueue(changes).pipe(
            Stream.filter(
              (change) =>
                Predicate.isTagged(change, "Insert") &&
                change.row.id === ids.probe,
            ),
            Stream.runHead,
          )
          yield* Queue.clear(changes)

          const releaseReconnect = yield* sockets.holdNextOpen
          yield* sockets.dropCurrent
          const recovering = yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "recovering",
          )
          expect(recovering).toMatchObject({
            status: "recovering",
            attempt: 1,
            reconnectAttempt: 1,
          })

          // While the SDK reconnects, calls are refused unsent and the cache
          // stays readable.
          const refused = yield* Effect.flip(
            session.reducers.userUpsert({
              userId: ids.added,
              name: decodeUserName("Refused"),
            }),
          )
          expect(CallNotSentError.is(refused)).toBe(true)
          const duringOutage = yield* session.cache.tables.user.toArray()
          expect(duringOutage.map((row) => row.id)).toEqual(
            expect.arrayContaining([ids.stable, ids.renamed]),
          )

          // Another client changes the table while this one is away.
          const writer = yield* live.makeConnection(LiveModule)
          yield* callLiveReducer(writer, wireFunction("userUpsert"), {
            userId: ids.renamed,
            name: decodeUserName("Grace Hopper"),
          })
          yield* callLiveReducer(writer, wireFunction("userUpsert"), {
            userId: ids.added,
            name: decodeUserName("Lin"),
          })

          yield* releaseReconnect
          yield* Queue.take(reconnected)
          // The replay re-applies the subscription; the SDK dispatches the
          // reconciled row changes in the same turn.
          yield* Queue.take(applied)
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 1,
          )

          expect(sockets.openedCount()).toBe(2)
          expect(yield* liveSession(supervisor)).toBe(session)
          expect(session.identity.isEqual(identity)).toBe(true)
          const rows = yield* session.cache.tables.user.toArray()
          expect(rows).toEqual(
            expect.arrayContaining([
              { id: ids.stable, name: decodeUserName("Ada") },
              { id: ids.renamed, name: decodeUserName("Grace Hopper") },
              { id: ids.added, name: decodeUserName("Lin") },
            ]),
          )

          // The recovered session takes calls again. Its sentinel row's insert
          // follows the replay on the wire, so every change the replay caused
          // is delivered before it.
          yield* session.reducers.userUpsert({
            userId: ids.sentinel,
            name: decodeUserName("Sentinel"),
          })
          const sinceDrop = yield* Stream.fromQueue(changes).pipe(
            Stream.takeUntil(
              (change) =>
                Predicate.isTagged(change, "Insert") &&
                change.row.id === ids.sentinel,
            ),
            Stream.runCollect,
          )

          // Only the rows that changed during the outage fire callbacks: no
          // delete/insert storm for the unchanged ones.
          expect(sinceDrop).toHaveLength(3)
          expect(sinceDrop).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                _tag: "Update",
                oldRow: { id: ids.renamed, name: decodeUserName("Grace") },
                newRow: {
                  id: ids.renamed,
                  name: decodeUserName("Grace Hopper"),
                },
              }),
              expect.objectContaining({
                _tag: "Insert",
                row: { id: ids.added, name: decodeUserName("Lin") },
              }),
              expect.objectContaining({
                _tag: "Insert",
                row: { id: ids.sentinel, name: decodeUserName("Sentinel") },
              }),
            ]),
          )
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "fails a call in flight at the drop as outcome-unknown and recovers",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const sockets = yield* makeDroppableSockets
          const reconnected = yield* Queue.unbounded<void>()
          const supervisor = yield* wsSupervisor({
            module: LiveModule,
            config: reconnectingConfig(live, sockets),
            onAutomaticReconnect: () => Queue.offer(reconnected, undefined),
          })
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live",
          )
          const session = yield* liveSession(supervisor)
          const userId = decodeUserId(`${runId()}-in-flight`)

          yield* sockets.swallowCurrentSends
          const inFlight = yield* session.reducers
            .userUpsert({ userId, name: decodeUserName("Unknown") })
            .pipe(Effect.flip, Effect.forkScoped)
          yield* sockets.nextSwallowed
          yield* sockets.dropCurrent
          const failure = yield* Fiber.join(inFlight)
          expect(ConnectionLostError.is(failure)).toBe(true)
          if (ConnectionLostError.is(failure)) {
            expect(failure.raw).toContain("may or may not have run")
          }

          yield* Queue.take(reconnected)
          yield* session.reducers.userUpsert({
            userId,
            name: decodeUserName("Known"),
          })
          expect(session.isInvalidated()).toBe(false)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "refreshes a retained token that needs it before the reconnect attempt",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const sockets = yield* makeDroppableSockets
          // An anonymous token has no expiry, so the SDK refreshes it before
          // every reconnect; the refresh is a 60 s token for the same identity.
          const anonymous = yield* mintAnonymousToken(live)
          const fresh = yield* mintShortLivedToken(live, anonymous)
          const { token, evaluations } = scriptedToken([anonymous, fresh])
          const events: Array<string> = []
          const reconnected = yield* Queue.unbounded<void>()
          const supervisor = yield* wsSupervisor({
            module: LiveModule,
            config: reconnectingConfig(live, sockets, token),
            onAutomaticReconnect: () =>
              Effect.suspend(() => {
                events.push(`reconnected after ${evaluations.length} tokens`)
                return Queue.offer(reconnected, undefined)
              }),
          })
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live",
          )
          const session = yield* liveSession(supervisor)
          const identity = session.identity
          expect(session.token).toBe(anonymous)

          yield* sockets.dropCurrent
          yield* Queue.take(reconnected)
          expect(evaluations).toEqual([anonymous, fresh])
          expect(events).toEqual(["reconnected after 2 tokens"])
          expect(session.token).toBe(fresh)
          expect(session.identity.isEqual(identity)).toBe(true)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "keeps a retained token that is not near expiry",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const sockets = yield* makeDroppableSockets
          const anonymous = yield* mintAnonymousToken(live)
          // 60 s of validity is well outside the SDK's 30 s refresh margin.
          const fresh = yield* mintShortLivedToken(live, anonymous)
          const { token, evaluations } = scriptedToken([fresh])
          const reconnected = yield* Queue.unbounded<void>()
          const supervisor = yield* wsSupervisor({
            module: LiveModule,
            config: reconnectingConfig(live, sockets, token),
            onAutomaticReconnect: () => Queue.offer(reconnected, undefined),
          })
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live",
          )

          yield* sockets.dropCurrent
          yield* Queue.take(reconnected)
          expect(evaluations).toEqual([fresh])
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "ends the session and parks the supervisor when a reconnect changes identity",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const sockets = yield* makeDroppableSockets
          const first = yield* mintAnonymousToken(live)
          const someoneElse = yield* mintAnonymousToken(live)
          const { token } = scriptedToken([first, someoneElse])
          const supervisor = yield* wsSupervisor({
            module: LiveModule,
            config: reconnectingConfig(live, sockets, token),
            policy: supervisorPolicy,
          })
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live",
          )
          const session = yield* liveSession(supervisor)

          yield* sockets.dropCurrent
          const fatal = yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "fatal",
          )
          expect(
            fatal.status === "fatal" &&
              WsConnectError.is(fatal.failure) &&
              ConnectionIdentityChangedError.is(fatal.failure.cause),
          ).toBe(true)
          expect(session.isInvalidated()).toBe(true)
          const refused = yield* Effect.flip(
            session.reducers.userUpsert({
              userId: decodeUserId(`${runId()}-other`),
              name: decodeUserName("Other"),
            }),
          )
          expect(ConnectionIdentityChangedError.is(refused)).toBe(true)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "replaces the session after a drop the SDK does not retry",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const sockets = yield* makeDroppableSockets
          const supervisor = yield* wsSupervisor({
            module: LiveModule,
            config: reconnectingConfig(live, sockets),
            policy: supervisorPolicy,
          })
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 1,
          )
          const first = yield* liveSession(supervisor)

          yield* sockets.closeCurrentWithProtocolError
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 2,
          )
          const second = yield* liveSession(supervisor)
          expect(second).not.toBe(first)
          expect(first.isInvalidated()).toBe(true)
          yield* second.reducers.userUpsert({
            userId: decodeUserId(`${runId()}-replaced`),
            name: decodeUserName("Replaced"),
          })
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "without automatic reconnect a dropped socket ends the session and the supervisor replaces it",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const sockets = yield* makeDroppableSockets
          const supervisor = yield* wsSupervisor({
            module: LiveModule,
            config: {
              ...live.makeWsConfig(LiveModule),
              createWebSocket: sockets.createWebSocket,
            },
            policy: supervisorPolicy,
          })
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 1,
          )
          const first = yield* liveSession(supervisor)

          yield* sockets.dropCurrent
          yield* awaitPhase(
            supervisor.phase,
            (phase) => phase.status === "live" && phase.attempt === 2,
          )
          expect(first.isInvalidated()).toBe(true)
          expect(yield* liveSession(supervisor)).not.toBe(first)
          expect(sockets.openedCount()).toBe(2)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
