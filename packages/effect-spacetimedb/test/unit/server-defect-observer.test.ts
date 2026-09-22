import { make as makeServer } from "../../src/server/bind.ts"
import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

const { describe, expect, it } = EffectVitest

import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, UserMissing, type UserId } from "../fixtures/full-module"

class ExampleInvariantDefect extends Data.TaggedError(
  "ExampleInvariantDefect",
)<{
  readonly handler: "userUpsert"
}> {}

const harness = StdbTesting.makeTestModuleHarness(FullModule)
const userId = "user-1" as UserId

const makeObservedServer = (observed: Array<Cause.Cause<unknown>>) =>
  makeServer({
    module: FullModule,
    onDefect: (cause) => {
      observed.push(cause)
    },
  })

const invokeFailure = (invoke: () => unknown): unknown => {
  try {
    invoke()
    return undefined
  } catch (thrown) {
    return thrown
  }
}

describe("server defect observer", () => {
  it("reports a reducer die and still aborts the transaction", () => {
    const observed: Array<Cause.Cause<unknown>> = []
    const server = makeObservedServer(observed)
    const reducers = server.reducers({
      userUpsert: server.reducer(
        Effect.fn(function* () {
          return yield* Effect.die(
            new ExampleInvariantDefect({ handler: "userUpsert" }),
          )
        }),
      ) as never,
    })

    const thrown = invokeFailure(() =>
      reducers.userUpsert!.invoke(harness.makeMutationCtx() as never, {
        name: "Ada" as never,
        userId: userId as never,
      }),
    )

    // The host only ever learns of a defect by the reducer throwing: the
    // observer must not turn a die into a completed transaction.
    expect(thrown).toBeDefined()
    expect(observed.length).toBe(1)
    const defects = observed[0]!.reasons
      .filter(Cause.isDieReason)
      .map((reason) => reason.defect)
    expect(defects.length).toBe(1)
    expect(defects[0]).toBeInstanceOf(ExampleInvariantDefect)
    expect(defects[0]).toMatchObject({ handler: "userUpsert" })
  })

  it("stays silent for a declared typed failure", () => {
    const observed: Array<Cause.Cause<unknown>> = []
    const server = makeObservedServer(observed)
    const reducers = server.reducers({
      userRequire: server.reducer(
        Effect.fn(function* () {
          return yield* UserMissing.make({ userId })
        }),
      ) as never,
    })

    const thrown = invokeFailure(() =>
      reducers.userRequire!.invoke(harness.makeMutationCtx() as never, {
        userId: userId as never,
      }),
    )

    // A declared error still aborts the reducer at the host boundary; what it
    // must not do is look like an invariant violation.
    expect(thrown).toBeDefined()
    expect(observed.length).toBe(0)
  })

  it("leaves handlers untouched when no observer is supplied", () => {
    const server = makeServer({ module: FullModule })
    const reducers = server.reducers({
      userUpsert: server.reducer(
        Effect.fn(function* () {
          return undefined
        }),
      ) as never,
    })

    expect(
      invokeFailure(() =>
        reducers.userUpsert!.invoke(harness.makeMutationCtx() as never, {
          name: "Ada" as never,
          userId: userId as never,
        }),
      ),
    ).toBeUndefined()
  })
})
