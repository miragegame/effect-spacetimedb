import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { describe, expect, it } = EffectVitest
import * as StdbInternal from "effect-spacetimedb/testing/internal"
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
  expect(() => StdbInternal.decodeStdbEventContextSync(value)).toThrow(
    StdbInternal.StdbDecodeError,
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

        expect(StdbInternal.decodeStdbEventContextSync(okContext)).toEqual(
          StdbInternal.StdbEventContext.Reducer({
            reducer: "userUpsert",
            timestamp: StableTimestamp,
            outcome: StdbInternal.StdbReducerOutcome.Ok(),
          }),
        )
        expect(yield* StdbInternal.decodeStdbEventContext(okContext)).toEqual(
          StdbInternal.StdbEventContext.Reducer({
            reducer: "userUpsert",
            timestamp: StableTimestamp,
            outcome: StdbInternal.StdbReducerOutcome.Ok(),
          }),
        )
        expect(
          StdbInternal.decodeStdbEventContextSync(
            reducerContext({ outcome: reducerErr(errorBytes), reducer }),
          ),
        ).toEqual(
          StdbInternal.StdbEventContext.Reducer({
            reducer: "userUpsert",
            timestamp: StableTimestamp,
            outcome: StdbInternal.StdbReducerOutcome.Err({ error: errorBytes }),
          }),
        )
        expect(
          StdbInternal.decodeStdbEventContextSync(
            reducerContext({
              outcome: reducerInternalError("host failed"),
              reducer,
            }),
          ),
        ).toEqual(
          StdbInternal.StdbEventContext.Reducer({
            reducer: "userUpsert",
            timestamp: StableTimestamp,
            outcome: StdbInternal.StdbReducerOutcome.InternalError({
              message: "host failed",
            }),
          }),
        )
        expect(
          StdbInternal.decodeStdbEventContextSync(
            reducerContext({ outcome: reducerOkEmpty(), reducer }),
          ),
        ).toEqual(
          StdbInternal.StdbEventContext.Reducer({
            reducer: "userUpsert",
            timestamp: StableTimestamp,
            outcome: StdbInternal.StdbReducerOutcome.OkEmpty(),
          }),
        )
      }),
  )

  it("decodes native non-reducer event tags", () => {
    const error = new Error("subscription failed")

    expect(
      StdbInternal.decodeStdbEventContextSync(subscribeAppliedContext()),
    ).toEqual(StdbInternal.StdbEventContext.SubscribeApplied())
    expect(
      StdbInternal.decodeStdbEventContextSync(unsubscribeAppliedContext()),
    ).toEqual(StdbInternal.StdbEventContext.UnsubscribeApplied())
    expect(
      StdbInternal.decodeStdbEventContextSync(transactionContext()),
    ).toEqual(StdbInternal.StdbEventContext.Transaction())
    expect(
      StdbInternal.decodeStdbEventContextSync(errorContext(error)),
    ).toEqual(StdbInternal.StdbEventContext.Error({ error }))
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
      const failure = yield* StdbInternal.decodeStdbEventContext({
        event: {
          tag: "Reducer",
          value: {
            timestamp: StableTimestamp,
            outcome: { tag: "Committed" },
            reducer,
          },
        },
      }).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(StdbInternal.StdbDecodeError)
    }),
  )
})
