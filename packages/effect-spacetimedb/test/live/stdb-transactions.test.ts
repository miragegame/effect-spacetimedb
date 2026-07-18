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
  provideLiveTest,
  waitForLiveServerLog,
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

describe("effect-spacetimedb live transactions", () => {
  live(
    "commits and rolls back reducer and Tx.run writes atomically",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { connection, live } = yield* makeExampleSession
          yield* callLiveReducer(connection, wireFunction("thingClear"), {})

          const abortedThingId = decodeThingId("tx-aborted")
          yield* callLiveReducer(
            connection,
            wireFunction("thingInsertThenAbort"),
            {
              thingId: abortedThingId,
              label: "aborted",
              count: 1n,
            },
          ).pipe(Effect.result)
          yield* waitForLiveServerLog(
            live.logPath,
            `"thingId":"${abortedThingId}"`,
            "declared reducer abort was not recorded by the live host",
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

          const firstAtomicId = decodeThingId("tx-atomic-first")
          const secondAtomicId = decodeThingId("tx-atomic-second")
          yield* callLiveReducer(
            connection,
            wireFunction("thingInsertTwiceAtomic"),
            {
              firstThingId: firstAtomicId,
              firstLabel: "first",
              firstCount: 3n,
              secondThingId: secondAtomicId,
              secondLabel: "second",
              secondCount: 4n,
            },
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: firstAtomicId },
            ),
            {
              id: firstAtomicId,
              label: "first",
              count: 3n,
            },
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: secondAtomicId },
            ),
            {
              id: secondAtomicId,
              label: "second",
              count: 4n,
            },
          )

          const firstRollbackId = decodeThingId("tx-rollback-first")
          const secondRollbackId = decodeThingId("tx-rollback-second")
          yield* callLiveReducer(
            connection,
            wireFunction("thingInsertTwiceThenAbort"),
            {
              firstThingId: firstRollbackId,
              firstLabel: "rollback first",
              firstCount: 5n,
              secondThingId: secondRollbackId,
              secondLabel: "rollback second",
              secondCount: 6n,
            },
          ).pipe(Effect.result)
          yield* waitForLiveServerLog(
            live.logPath,
            `"thingId":"${firstRollbackId}"`,
            "declared multi-write reducer abort was not recorded by the live host",
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: firstRollbackId },
            ),
            undefined,
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: secondRollbackId },
            ),
            undefined,
          )

          const firstTxRunId = decodeThingId("tx-run-first")
          const secondTxRunId = decodeThingId("tx-run-second")
          yield* callLiveProcedure(
            connection,
            wireFunction("thingInsertTwiceInTx"),
            {
              firstThingId: firstTxRunId,
              firstLabel: "tx run first",
              firstCount: 7n,
              secondThingId: secondTxRunId,
              secondLabel: "tx run second",
              secondCount: 8n,
            },
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: firstTxRunId },
            ),
            {
              id: firstTxRunId,
              label: "tx run first",
              count: 7n,
            },
          )
          expectThing(
            yield* callLiveProcedure<ThingRow | undefined>(
              connection,
              wireFunction("thingGet"),
              { thingId: secondTxRunId },
            ),
            {
              id: secondTxRunId,
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
