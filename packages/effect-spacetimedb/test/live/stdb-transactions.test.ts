/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

const { describe, expect, live } = EffectVitest

import {
  decodeThingId,
  LIVE_TEST_TIMEOUT_MS,
  makeExampleSession,
  wireFunction,
} from "./helpers/example-live"
import {
  callLiveProcedure,
  callLiveReducer,
  callLiveReducerExpectingRejection,
  provideLiveTest,
} from "./helpers/live-harness"

type ThingRow = {
  readonly id: string
  readonly label: string
  readonly count: bigint
}

class LiveTransactionProcedureCallError extends Data.TaggedError(
  "LiveTransactionProcedureCallError",
)<{
  readonly cause: unknown
}> {}

const expectThing = (
  value: ThingRow | undefined,
  expected: ThingRow | undefined,
): void => {
  expect(value).toEqual(expected)
}

// A reducer that fails with a declared error rejects the caller's call and
// carries the encoded error payload back to it. The host does not record the
// payload anywhere else, so the caller's rejection is the only observation of
// which declared error aborted the transaction.
const expectDeclaredAbort = (rejection: unknown, thingId: string): void => {
  expect(String(rejection)).toContain(`"thingId":"${thingId}"`)
}

describe("effect-spacetimedb live transactions", () => {
  live(
    "commits and rolls back reducer and Tx.run writes atomically",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { connection } = yield* makeExampleSession
          yield* callLiveReducer(connection, wireFunction("thingClear"), {})

          const abortedThingId = decodeThingId("tx-aborted")
          expectDeclaredAbort(
            yield* callLiveReducerExpectingRejection(
              connection,
              wireFunction("thingInsertThenAbort"),
              {
                thingId: abortedThingId,
                label: "aborted",
                count: 1n,
              },
            ),
            abortedThingId,
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              {
                thingId: abortedThingId,
              },
            ),
            undefined,
          )

          const committedThingId = decodeThingId("tx-committed")
          yield* callLiveReducer(connection, wireFunction("thingSet"), {
            thingId: committedThingId,
            label: "committed",
            count: 2n,
          })
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              {
                thingId: committedThingId,
              },
            ),
            {
              id: committedThingId,
              label: "committed",
              count: 2n,
            },
          )

          const atomicIdFirst = decodeThingId("tx-atomic-first")
          const atomicIdSecond = decodeThingId("tx-atomic-second")
          yield* callLiveReducer(
            connection,
            wireFunction("thingInsertTwiceAtomic"),
            {
              firstThingId: atomicIdFirst,
              firstLabel: "first",
              firstCount: 3n,
              secondThingId: atomicIdSecond,
              secondLabel: "second",
              secondCount: 4n,
            },
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: atomicIdFirst },
            ),
            {
              id: atomicIdFirst,
              label: "first",
              count: 3n,
            },
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: atomicIdSecond },
            ),
            {
              id: atomicIdSecond,
              label: "second",
              count: 4n,
            },
          )

          const rollbackIdFirst = decodeThingId("tx-rollback-first")
          const rollbackIdSecond = decodeThingId("tx-rollback-second")
          expectDeclaredAbort(
            yield* callLiveReducerExpectingRejection(
              connection,
              wireFunction("thingInsertTwiceThenAbort"),
              {
                firstThingId: rollbackIdFirst,
                firstLabel: "rollback first",
                firstCount: 5n,
                secondThingId: rollbackIdSecond,
                secondLabel: "rollback second",
                secondCount: 6n,
              },
            ),
            rollbackIdFirst,
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: rollbackIdFirst },
            ),
            undefined,
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: rollbackIdSecond },
            ),
            undefined,
          )

          const txRunIdFirst = decodeThingId("tx-run-first")
          const txRunIdSecond = decodeThingId("tx-run-second")
          yield* callLiveProcedure(
            connection,
            wireFunction("thingInsertTwiceInTx"),
            {
              firstThingId: txRunIdFirst,
              firstLabel: "tx run first",
              firstCount: 7n,
              secondThingId: txRunIdSecond,
              secondLabel: "tx run second",
              secondCount: 8n,
            },
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: txRunIdFirst },
            ),
            {
              id: txRunIdFirst,
              label: "tx run first",
              count: 7n,
            },
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: txRunIdSecond },
            ),
            {
              id: txRunIdSecond,
              label: "tx run second",
              count: 8n,
            },
          )

          const txRunAbortId = decodeThingId("tx-run-aborted")
          yield* Effect.tryPromise({
            try: () =>
              connection.callProcedureWithParams(
                wireFunction("thingInsertInTxThenAbort"),
                undefined,
                {
                  thingId: txRunAbortId,
                  label: "tx run aborted",
                  count: 9n,
                },
                undefined,
              ),
            catch: (cause) => new LiveTransactionProcedureCallError({ cause }),
          }).pipe(Effect.result)
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: txRunAbortId },
            ),
            undefined,
          )
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
