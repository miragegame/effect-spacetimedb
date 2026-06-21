// lint-ignore: no-unnecessary-type-assertion - casts model host and type-level test boundaries intentionally.
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { ContractError as ErrorCodec } from "effect-spacetimedb/testing"
import * as EffectVitest from "@effect/vitest"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
const { describe, expect, live } = EffectVitest
import { ClientWs } from "effect-spacetimedb/testing"
import * as ExampleModuleFixture from "effect-spacetimedb/testing/example-module"
import {
  callLiveProcedure,
  callLiveReducer,
  captureLiveEventContext,
  captureLiveTransportValue,
  liveHarness,
  liveFunctionName,
  provideLiveTest,
  type TypedLiveConnection,
} from "../helpers/live-harness"
import { waitForPredicate } from "../helpers/wait-for-predicate"
const {
  ExampleErrors: LiveErrors,
  ExampleModule: LiveModule,
  ThingId,
  UserId,
  UserMissingError,
  UserName,
} = ExampleModuleFixture
const wireFunction = (name: string) => liveFunctionName(LiveModule, name)
const decodeThingId = Schema.decodeUnknownSync(ThingId)
const decodeUserId = Schema.decodeUnknownSync(UserId)
const decodeUserName = Schema.decodeUnknownSync(UserName)
type RawProcedureResult<A> =
  | {
      readonly ok: A
    }
  | {
      readonly err: string
    }

type ThingRow = {
  readonly id: string
  readonly label: string
  readonly count: bigint
}

type CapturedRelationEvent = {
  readonly context: unknown
  readonly row: ThingRow
}

class ExpectedLiveCallRejectionMissing extends Data.TaggedError(
  "ExpectedLiveCallRejectionMissing",
) {}

class ExpectedLiveCallFailureMissing extends Data.TaggedError(
  "ExpectedLiveCallFailureMissing",
) {}

class CapturedLiveCallRejected extends Data.TaggedError(
  "CapturedLiveCallRejected",
)<{
  readonly cause: unknown
}> {}

class LiveReducerCallError extends Data.TaggedError("LiveReducerCallError")<{
  readonly cause: unknown
}> {}

class LiveSubscriptionStartError extends Data.TaggedError(
  "LiveSubscriptionStartError",
)<{
  readonly cause: unknown
}> {}

class LiveSubscriptionUnsubscribeError extends Data.TaggedError(
  "LiveSubscriptionUnsubscribeError",
)<{
  readonly cause: unknown
}> {}

const namedErrorName = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof (value as { readonly name?: unknown }).name === "string"
    ? (value as { readonly name: string }).name
    : undefined

const eventTag = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "event" in value &&
  typeof (value as { readonly event?: unknown }).event === "object" &&
  (value as { readonly event?: unknown }).event !== null &&
  "tag" in ((value as { readonly event: object }).event as object) &&
  typeof (value as { readonly event: { readonly tag?: unknown } }).event.tag ===
    "string"
    ? (value as { readonly event: { readonly tag: string } }).event.tag
    : undefined

const expectNamedError = (value: unknown, expected: string): void => {
  expect(namedErrorName(value)).toBe(expected)
}

const expectEventTag = (value: unknown, expected: string): void => {
  expect(eventTag(value)).toBe(expected)
}

const expectRejectedLiveCall = (
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

const callRawReducer = (
  connection: Pick<
    TypedLiveConnection<typeof LiveModule>,
    "callReducerWithParams"
  >,
  name: string,
  args: object,
) =>
  Effect.tryPromise({
    try: () => connection.callReducerWithParams(name, undefined, args),
    catch: (cause) => new LiveReducerCallError({ cause }),
  })

const subscribeToThing = (connection: TypedLiveConnection<typeof LiveModule>) =>
  Effect.try({
    try: () =>
      connection
        .subscriptionBuilder()
        .onError((context, error) => {
          throw new Error(
            `thing subscription failed: ${error?.message ?? String(context)}`,
          )
        })
        .subscribe((tables) => tables.thing),
    catch: (cause) => new LiveSubscriptionStartError({ cause }),
  }).pipe(Effect.orDie)

const unsubscribe = (handle: { readonly unsubscribe: () => void }) =>
  Effect.try({
    try: () => {
      handle.unsubscribe()
    },
    catch: (cause) => new LiveSubscriptionUnsubscribeError({ cause }),
  }).pipe(Effect.orDie)

describe("effect-spacetimedb live reducer/procedure", () => {
  live(
    "round-trips reducer and procedure calls against a standalone SpaceTimeDB runtime",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const connection = yield* live.makeConnection(LiveModule)
          const userId = decodeUserId("live-user-1")
          const userName = decodeUserName("Ada")
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId,
            name: userName,
          })
          yield* callLiveReducer(connection, wireFunction("membershipUpsert"), {
            tenantId: "tenant-a",
            email: "ada@example.com",
            note: "from-live-test",
          })
          const thingId = decodeThingId("thing-live-1")
          yield* callLiveReducer(connection, wireFunction("thingSet"), {
            thingId,
            label: "Live Thing",
            count: 7n,
          })
          const session = ClientWs.make({
            module: LiveModule,
            connection,
          })
          yield* session.reducers.userRequire({
            userId,
          })
          const user = yield* callLiveProcedure<
            RawProcedureResult<
              | {
                  readonly id: string
                  readonly name: string
                }
              | undefined
            >
          >(connection, wireFunction("userGet"), {
            userId,
          })
          expect(user).toEqual({
            ok: {
              id: userId,
              name: userName,
            },
          })
          const wsUser = yield* session.procedures.userGet!({
            userId,
          })
          expect(wsUser).toEqual({
            id: userId,
            name: userName,
          })
          const membership = yield* callLiveProcedure<
            | {
                readonly tenantId: string
                readonly email: string
                readonly note: string
              }
            | undefined
          >(connection, wireFunction("membershipGet"), {
            tenantId: "tenant-a",
            email: "ada@example.com",
          })
          expect(membership).toEqual({
            tenantId: "tenant-a",
            email: "ada@example.com",
            note: "from-live-test",
          })
          const thing = yield* callLiveProcedure<
            | {
                readonly id: string
                readonly label: string
                readonly count: bigint
              }
            | undefined
          >(connection, wireFunction("thingGet"), {
            thingId,
          })
          expect(thing).toEqual({
            id: thingId,
            label: "Live Thing",
            count: 7n,
          })
          const wsThing = yield* session.procedures.thingGet!({
            thingId,
          })
          expect(wsThing).toEqual(thing)
          const thingOutcome = yield* session.procedures.thingOutcome!({
            thingId,
          })
          expect(thingOutcome).toEqual({
            ok: thing,
          })
          const missingThingOutcome = yield* session.procedures.thingOutcome!({
            thingId: decodeThingId("missing-thing"),
          })
          expect(missingThingOutcome).toEqual({
            err: "thing missing",
          })
          const missingReducerExit = yield* Effect.exit(
            session.reducers.userRequire({
              userId: decodeUserId("missing-user"),
            }),
          )
          expect(Exit.isFailure(missingReducerExit)).toBe(true)
          if (Exit.isFailure(missingReducerExit)) {
            const failure = missingReducerExit.cause.pipe(
              Cause.findErrorOption,
              Option.getOrUndefined,
            )
            expect(failure).toBeInstanceOf(UserMissingError)
            expect(failure).toEqual(
              expect.objectContaining({
                userId: decodeUserId("missing-user"),
              }),
            )
          }
          const missing = yield* callLiveProcedure<
            RawProcedureResult<
              | {
                  readonly id: string
                  readonly name: string
                }
              | undefined
            >
          >(connection, wireFunction("userGet"), {
            userId: decodeUserId("missing-user"),
          })
          expect("err" in missing).toBe(true)
          if ("err" in missing) {
            const decoded = yield* ErrorCodec.decodeString(
              LiveErrors,
              missing.err,
            )
            expect(decoded).toBeInstanceOf(UserMissingError)
            expect(decoded).toMatchObject({
              userId: "missing-user",
            })
          }
        }),
      ),
    { timeout: 180_000 },
  )

  live(
    "records SDK callback and callable transport fixtures when requested",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const seedConnection = yield* live.makeConnection(LiveModule)
          const connection = yield* live.makeConnection(LiveModule)
          const session = ClientWs.make({
            module: LiveModule,
            connection,
          })

          const subscribeThingId = decodeThingId("capture-subscribe-thing")
          yield* callLiveReducer(seedConnection, wireFunction("thingSet"), {
            thingId: subscribeThingId,
            label: "Subscribe Fixture",
            count: 1n,
          })

          const subscribeInserts: Array<CapturedRelationEvent> = []
          const subscribeDeletes: Array<CapturedRelationEvent> = []
          const subscribeInsert = (context: unknown, row: ThingRow) => {
            if (row.id === subscribeThingId) {
              subscribeInserts.push({ context, row })
            }
          }
          const subscribeDelete = (context: unknown, row: ThingRow) => {
            if (row.id === subscribeThingId) {
              subscribeDeletes.push({ context, row })
            }
          }
          connection.db.thing.onInsert(subscribeInsert)
          connection.db.thing.onDelete(subscribeDelete)
          const subscribeHandle = yield* subscribeToThing(connection)
          yield* waitForPredicate(
            () => subscribeInserts.length > 0,
            "live capture did not receive SubscribeApplied relation insert",
          )
          const subscribeApplied = subscribeInserts[0]!.context
          expectEventTag(subscribeApplied, "SubscribeApplied")

          yield* unsubscribe(subscribeHandle)
          yield* waitForPredicate(
            () => subscribeDeletes.length > 0,
            "live capture did not receive UnsubscribeApplied relation delete",
          )
          const unsubscribeApplied = subscribeDeletes[0]!.context
          expectEventTag(unsubscribeApplied, "UnsubscribeApplied")
          connection.db.thing.removeOnInsert(subscribeInsert)
          connection.db.thing.removeOnDelete(subscribeDelete)

          const relationConnection = yield* live.makeConnection(LiveModule)
          const relationEvents = {
            inserts: [] as Array<CapturedRelationEvent>,
            updates: [] as Array<{
              readonly context: unknown
              readonly oldRow: ThingRow
              readonly row: ThingRow
            }>,
            deletes: [] as Array<CapturedRelationEvent>,
          }
          const relationThingId = decodeThingId("capture-relation-thing")
          const relationInsert = (context: unknown, row: ThingRow) => {
            if (row.id === relationThingId) {
              relationEvents.inserts.push({ context, row })
            }
          }
          const relationUpdate = (
            context: unknown,
            oldRow: ThingRow,
            row: ThingRow,
          ) => {
            if (row.id === relationThingId) {
              relationEvents.updates.push({ context, oldRow, row })
            }
          }
          const relationDelete = (context: unknown, row: ThingRow) => {
            if (row.id === relationThingId) {
              relationEvents.deletes.push({ context, row })
            }
          }
          relationConnection.db.thing.onInsert(relationInsert)
          relationConnection.db.thing.onUpdate(relationUpdate)
          relationConnection.db.thing.onDelete(relationDelete)
          const relationHandle = yield* subscribeToThing(relationConnection)

          yield* callLiveReducer(relationConnection, wireFunction("thingSet"), {
            thingId: relationThingId,
            label: "Relation Fixture",
            count: 2n,
          })
          yield* waitForPredicate(
            () => relationEvents.inserts.length > 0,
            "live capture did not receive reducer relation insert",
          )
          const relationInsertContext = relationEvents.inserts[0]!.context
          expectEventTag(relationInsertContext, "Reducer")

          yield* callLiveReducer(relationConnection, wireFunction("thingSet"), {
            thingId: relationThingId,
            label: "Relation Fixture Updated",
            count: 3n,
          })
          yield* waitForPredicate(
            () => relationEvents.updates.length > 0,
            "live capture did not receive reducer relation update",
          )
          const relationUpdateContext = relationEvents.updates[0]!.context
          expectEventTag(relationUpdateContext, "Reducer")

          yield* callLiveReducer(
            relationConnection,
            wireFunction("thingDelete"),
            {
              thingId: relationThingId,
            },
          )
          yield* waitForPredicate(
            () => relationEvents.deletes.length > 0,
            "live capture did not receive reducer relation delete",
          )
          const relationDeleteContext = relationEvents.deletes[0]!.context
          expectEventTag(relationDeleteContext, "Reducer")

          yield* unsubscribe(relationHandle)
          relationConnection.db.thing.removeOnInsert(relationInsert)
          relationConnection.db.thing.removeOnUpdate(relationUpdate)
          relationConnection.db.thing.removeOnDelete(relationDelete)

          const reducerErr = yield* expectRejectedLiveCall(() =>
            connection.callReducerWithParams(
              wireFunction("userRequire"),
              undefined,
              { userId: decodeUserId("capture-missing-user") },
            ),
          )
          expectNamedError(reducerErr, "SenderError")

          const reducerInternalError = yield* expectRejectedLiveCall(() =>
            connection.callReducerWithParams(
              wireFunction("thingPanic"),
              undefined,
              {},
            ),
          )
          expectNamedError(reducerInternalError, "InternalError")

          const reducerOkEmpty = yield* callRawReducer(
            connection,
            wireFunction("thingNoop"),
            {},
          )
          expect(reducerOkEmpty).toBeUndefined()

          const procedureOk = yield* callLiveProcedure<unknown>(
            connection,
            wireFunction("thingOutcome"),
            {
              thingId: subscribeThingId,
            },
          )
          expect(procedureOk).toEqual({
            ok: {
              id: subscribeThingId,
              label: "Subscribe Fixture",
              count: 1n,
            },
          })
          const procedureErr = yield* callLiveProcedure<unknown>(
            connection,
            wireFunction("thingOutcome"),
            {
              thingId: decodeThingId("capture-missing-thing"),
            },
          )
          expect(procedureErr).toEqual({
            err: "thing missing",
          })

          yield* session.reducers
            .userRequire({
              userId: decodeUserId("missing-user"),
            })
            .pipe(
              Effect.exit,
              Effect.map((exit) => {
                expect(Exit.isFailure(exit)).toBe(true)
              }),
            )

          yield* captureLiveEventContext("subscribe-applied", subscribeApplied)
          yield* captureLiveEventContext(
            "unsubscribe-applied",
            unsubscribeApplied,
          )
          yield* captureLiveEventContext("reducer-ok", relationInsertContext)
          yield* captureLiveEventContext(
            "relation-insert",
            relationInsertContext,
          )
          yield* captureLiveEventContext(
            "relation-update",
            relationUpdateContext,
          )
          yield* captureLiveEventContext(
            "relation-delete",
            relationDeleteContext,
          )
          yield* captureLiveTransportValue("reducer-err", reducerErr)
          yield* captureLiveTransportValue(
            "reducer-internal-error",
            reducerInternalError,
          )
          yield* captureLiveTransportValue("reducer-ok-empty", reducerOkEmpty)
          yield* captureLiveTransportValue("procedure-ok", procedureOk)
          yield* captureLiveTransportValue("procedure-err", procedureErr)
        }),
      ),
    { timeout: 180_000 },
  )
})
