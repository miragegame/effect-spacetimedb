import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { describe, expect, it } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  StableTimestamp,
  bsatnString,
  errorContext,
  reducerContext,
  reducerErr,
  reducerInfo,
  reducerInternalError,
  reducerOk,
  reducerOkEmpty,
  subscribeAppliedContext,
  transactionContext,
  unsubscribeAppliedContext,
} from "../helpers/sdk-event-oracle"

const reducer = reducerInfo()

const expectDecodeFailure = (value: unknown) => {
  expect(() => StdbTesting.decodeStdbEventContextSync(value)).toThrow(
    StdbTesting.StdbDecodeError,
  )
}

describe("event context decoding", () => {
  it.effect(
    "decodes reducer outcomes from the native WebSocket event shape",
    () =>
      Effect.gen(function* () {
        const okContext = reducerContext({
          outcome: reducerOk(new Uint8Array([1, 2, 3])),
          reducer,
        })
        const errorBytes = bsatnString("declared reducer failure")

        expect(StdbTesting.decodeStdbEventContextSync(okContext)).toEqual(
          StdbTesting.StdbEventContext.Reducer({
            reducer: "userUpsert",
            timestamp: StableTimestamp,
            outcome: StdbTesting.StdbReducerOutcome.Ok(),
          }),
        )
        expect(yield* StdbTesting.decodeStdbEventContext(okContext)).toEqual(
          StdbTesting.StdbEventContext.Reducer({
            reducer: "userUpsert",
            timestamp: StableTimestamp,
            outcome: StdbTesting.StdbReducerOutcome.Ok(),
          }),
        )
        expect(
          StdbTesting.decodeStdbEventContextSync(
            reducerContext({ outcome: reducerErr(errorBytes), reducer }),
          ),
        ).toEqual(
          StdbTesting.StdbEventContext.Reducer({
            reducer: "userUpsert",
            timestamp: StableTimestamp,
            outcome: StdbTesting.StdbReducerOutcome.Err({ error: errorBytes }),
          }),
        )
        expect(
          StdbTesting.decodeStdbEventContextSync(
            reducerContext({
              outcome: reducerInternalError("host failed"),
              reducer,
            }),
          ),
        ).toEqual(
          StdbTesting.StdbEventContext.Reducer({
            reducer: "userUpsert",
            timestamp: StableTimestamp,
            outcome: StdbTesting.StdbReducerOutcome.InternalError({
              message: "host failed",
            }),
          }),
        )
        expect(
          StdbTesting.decodeStdbEventContextSync(
            reducerContext({ outcome: reducerOkEmpty(), reducer }),
          ),
        ).toEqual(
          StdbTesting.StdbEventContext.Reducer({
            reducer: "userUpsert",
            timestamp: StableTimestamp,
            outcome: StdbTesting.StdbReducerOutcome.OkEmpty(),
          }),
        )
      }),
  )

  it("decodes native non-reducer event tags", () => {
    const error = new Error("subscription failed")

    expect(
      StdbTesting.decodeStdbEventContextSync(subscribeAppliedContext()),
    ).toEqual(StdbTesting.StdbEventContext.SubscribeApplied())
    expect(
      StdbTesting.decodeStdbEventContextSync(unsubscribeAppliedContext()),
    ).toEqual(StdbTesting.StdbEventContext.UnsubscribeApplied())
    expect(
      StdbTesting.decodeStdbEventContextSync(transactionContext()),
    ).toEqual(StdbTesting.StdbEventContext.Transaction())
    expect(StdbTesting.decodeStdbEventContextSync(errorContext(error))).toEqual(
      StdbTesting.StdbEventContext.Error({ error }),
    )
  })

  it("rejects stale reducer outcome shapes", () => {
    expectDecodeFailure({
      event: {
        tag: "Reducer",
        value: {
          timestamp: StableTimestamp,
          status: { tag: "Committed" },
          reducer,
        },
      },
    })
    expectDecodeFailure({
      event: {
        tag: "Reducer",
        value: {
          timestamp: StableTimestamp,
          outcome: { tag: "Committed" },
          reducer,
        },
      },
    })
    expectDecodeFailure({
      event: {
        tag: "Reducer",
        value: {
          timestamp: StableTimestamp,
          status: { tag: "Ok" },
          reducer,
        },
      },
    })
  })

  it.effect("surfaces stale reducer outcomes through the Effect API", () =>
    Effect.gen(function* () {
      const failure = yield* StdbTesting.decodeStdbEventContext({
        event: {
          tag: "Reducer",
          value: {
            timestamp: StableTimestamp,
            outcome: { tag: "Committed" },
            reducer,
          },
        },
      }).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(StdbTesting.StdbDecodeError)
    }),
  )
})
