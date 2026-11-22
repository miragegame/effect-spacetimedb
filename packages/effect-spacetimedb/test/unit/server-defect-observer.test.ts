import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { SenderError } from "spacetimedb"

const { describe, expect, it } = EffectVitest

import { StdbDecodeError } from "effect-spacetimedb"
import {
  HandlerAsyncNotAllowedDefect,
  scopedDbTx,
  StdbSenderError,
  StdbUniqueAlreadyExistsError,
  scopedDbTxFromCtx,
} from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, UserMissing, type UserId } from "../fixtures/full-module"
import { makeServer } from "../helpers/module-server"
import { makeRecordingRunner } from "../helpers/server-runtime"

class ExampleInvariantDefect extends Data.TaggedError(
  "ExampleInvariantDefect",
)<{
  readonly handler: "userUpsert"
}> {}

const harness = StdbTesting.makeTestModuleHarness(FullModule)
const userId = "user-1" as UserId
const upsertArgs = { name: "Ada" as never, userId: userId as never }

const makeObservedServer = () => {
  const observed: Array<Cause.Cause<unknown>> = []
  const logged: Array<string> = []
  const server = makeServer({
    module: FullModule,
    onDefect: (cause) => {
      observed.push(cause)
    },
    runtime: makeRecordingRunner(logged),
  })
  return { logged, observed, server }
}

const invokeFailure = (invoke: () => unknown): unknown => {
  try {
    invoke()
    return undefined
  } catch (thrown) {
    return thrown
  }
}

const defectsOf = (cause: Cause.Cause<unknown>): ReadonlyArray<unknown> =>
  cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect)

const promotedDecodeFailure = Effect.fail(
  new StdbDecodeError({ phase: "row", table: "user", cause: "undecodable" }),
).pipe(Effect.orDie)

describe("undeclared failure reporting", () => {
  it("reports a reducer die once and still aborts the transaction", () => {
    const { logged, observed, server } = makeObservedServer()
    const reducers = server.reducers({
      userUpsert: Effect.fn(function* () {
        return yield* Effect.die(
          new ExampleInvariantDefect({ handler: "userUpsert" }),
        )
      }) as never,
    })

    const thrown = invokeFailure(() =>
      reducers.userUpsert!.invoke(harness.makeMutationCtx(), upsertArgs),
    )

    // The host only ever learns of a defect by the reducer throwing: the
    // observer must not turn a die into a completed transaction.
    expect(thrown).toBeDefined()
    expect(observed.length).toBe(1)
    expect(defectsOf(observed[0]!)[0]).toBeInstanceOf(ExampleInvariantDefect)
    expect(defectsOf(observed[0]!)[0]).toMatchObject({ handler: "userUpsert" })
    expect(logged.length).toBe(1)
  })

  it("keeps a tagged defect's fields in the log line", () => {
    const { logged, server } = makeObservedServer()
    const reducers = server.reducers({
      userUpsert: Effect.fn(function* () {
        return yield* Effect.die(
          new ExampleInvariantDefect({ handler: "userUpsert" }),
        )
      }) as never,
    })

    invokeFailure(() =>
      reducers.userUpsert!.invoke(harness.makeMutationCtx(), upsertArgs),
    )

    expect(logged[0]).toContain("ExampleInvariantDefect")
    expect(logged[0]).toContain("userUpsert")
  })

  it("renders a die that is not an error", () => {
    const { logged, server } = makeObservedServer()
    const reducers = server.reducers({
      userUpsert: Effect.fn(function* () {
        return yield* Effect.die({ reason: "not an error" })
      }) as never,
    })

    const thrown = invokeFailure(() =>
      reducers.userUpsert!.invoke(harness.makeMutationCtx(), upsertArgs),
    )

    expect(logged[0]).toContain("not an error")
    expect((thrown as Error).message).toContain("not an error")
  })

  it("reports a die inside withTx once", () => {
    const { logged, observed, server } = makeObservedServer()
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        return yield* server.withTx(
          Effect.die(new ExampleInvariantDefect({ handler: "userUpsert" })),
        )
      }) as never,
    })

    procedures.userGet!.invoke(harness.makeProcedureCtx(), {
      userId: userId as never,
    })

    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
  })

  it("reports a decode failure promoted inside withTx as the die it is", () => {
    const { observed, server } = makeObservedServer()
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        return yield* server.withTx(promotedDecodeFailure)
      }) as never,
    })

    procedures.userGet!.invoke(harness.makeProcedureCtx(), {
      userId: userId as never,
    })

    expect(observed.length).toBe(1)
    expect(observed[0]!.reasons.map((reason) => reason._tag)).toEqual(["Die"])
    expect(StdbDecodeError.is(defectsOf(observed[0]!)[0])).toBe(true)
  })

  it("reports the same die from either transaction fragment runner", () => {
    const { observed, server } = makeObservedServer()
    const fromModule = scopedDbTx<typeof FullModule>(server)
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        return yield* fromModule(() => promotedDecodeFailure)
      }) as never,
    })
    const reducers = server.reducers({
      userUpsert: Effect.fn(function* () {
        const db = yield* server.Db
        const ctx = yield* server.MutationCtx
        return yield* scopedDbTxFromCtx({ db, ctx })(
          () => promotedDecodeFailure,
        )
      }) as never,
    })

    procedures.userGet!.invoke(harness.makeProcedureCtx(), {
      userId: userId as never,
    })
    invokeFailure(() =>
      reducers.userUpsert!.invoke(harness.makeMutationCtx(), upsertArgs),
    )

    expect(observed.map((cause) => cause.reasons.map((r) => r._tag))).toEqual([
      ["Die"],
      ["Die"],
    ])
  })

  it("reports a handler that went asynchronous", () => {
    const { logged, observed, server } = makeObservedServer()
    const reducers = server.reducers({
      userUpsert: Effect.fn(function* () {
        return yield* Effect.promise(() => Promise.resolve())
      }) as never,
    })

    expect(() =>
      reducers.userUpsert!.invoke(harness.makeMutationCtx(), upsertArgs),
    ).toThrow(HandlerAsyncNotAllowedDefect)

    expect(observed.length).toBe(1)
    expect(HandlerAsyncNotAllowedDefect.is(defectsOf(observed[0]!)[0])).toBe(
      true,
    )
    expect(logged.length).toBe(1)
  })

  it("reports a host failure no declared error covers", () => {
    const { logged, observed, server } = makeObservedServer()
    const reducers = server.reducers({
      userUpsert: Effect.fn(function* () {
        return yield* new StdbUniqueAlreadyExistsError({
          op: "db.user.insert",
          cause: new Error("duplicate"),
        })
      }) as never,
    })

    expect(
      invokeFailure(() =>
        reducers.userUpsert!.invoke(harness.makeMutationCtx(), upsertArgs),
      ),
    ).toBeDefined()

    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
    expect(logged[0]).toContain("db.user.insert")
  })

  it("stays silent for a declared failure", () => {
    const { logged, observed, server } = makeObservedServer()
    const reducers = server.reducers({
      userRequire: Effect.fn(function* () {
        return yield* UserMissing.make({ userId })
      }) as never,
    })

    const thrown = invokeFailure(() =>
      reducers.userRequire!.invoke(harness.makeMutationCtx(), {
        userId: userId as never,
      }),
    )

    // A declared error still aborts the reducer at the host boundary; what it
    // must not do is look like an invariant violation.
    expect(thrown).toBeDefined()
    expect(observed.length).toBe(0)
    expect(logged.length).toBe(0)
  })

  it("stays silent for a sender refusal", () => {
    const { logged, observed, server } = makeObservedServer()
    const reducers = server.reducers({
      userUpsert: Effect.fn(function* () {
        return yield* new StdbSenderError({ value: "not yours" })
      }) as never,
    })

    expect(
      invokeFailure(() =>
        reducers.userUpsert!.invoke(harness.makeMutationCtx(), upsertArgs),
      ),
    ).toBeDefined()

    expect(observed.length).toBe(0)
    expect(logged.length).toBe(0)
  })

  it("reports a sender failure in a procedure, which has nobody to tell", () => {
    const { logged, observed, server } = makeObservedServer()
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        return yield* new StdbSenderError({ value: "not yours" })
      }) as never,
    })

    const reply = procedures.userGet!.invoke(harness.makeProcedureCtx(), {
      userId: userId as never,
    })

    expect(reply).toHaveProperty("err")
    expect(JSON.stringify(reply)).not.toContain("not yours")
    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
  })

  it("reports a sender failure in a view", () => {
    const { logged, observed, server } = makeObservedServer()
    const views = server.views({
      allUsers: Effect.fn(function* () {
        return yield* new StdbSenderError({ value: "not yours" })
      }) as never,
    })

    expect(
      invokeFailure(() =>
        views.allUsers!.invoke(harness.makeAnonymousViewCtx() as never, {}),
      ),
    ).toBeDefined()

    expect(observed.length).toBe(1)
    expect(logged.length).toBe(1)
  })

  it("keeps a lifecycle hook's refusal an answer, whatever the hook", () => {
    for (const hook of [
      "clientConnected",
      "clientDisconnected",
      "init",
    ] as const) {
      const { logged, observed, server } = makeObservedServer()
      const lifecycle = server.lifecycle({
        [hook]: Effect.fn(function* () {
          return yield* new StdbSenderError({ value: "refused" })
        }),
      } as never) as Record<string, { readonly invoke: (ctx: unknown) => void }>

      expect(
        invokeFailure(() => lifecycle[hook]!.invoke(harness.makeMutationCtx())),
      ).toBeInstanceOf(SenderError)

      expect(observed.length).toBe(0)
      expect(logged.length).toBe(0)
    }
  })

  it("keeps a procedure's answer when the observer throws", () => {
    const logged: Array<string> = []
    const server = makeServer({
      module: FullModule,
      onDefect: () => {
        throw new Error("observer broke")
      },
      runtime: makeRecordingRunner(logged),
    })
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        return yield* Effect.die(
          new ExampleInvariantDefect({ handler: "userUpsert" }),
        )
      }) as never,
    })

    expect(
      procedures.userGet!.invoke(harness.makeProcedureCtx(), {
        userId: userId as never,
      }),
    ).toHaveProperty("err")
    expect(logged.some((line) => line.includes("observer broke"))).toBe(true)
  })

  it("keeps a procedure's answer when what the observer threw cannot be read", () => {
    const logged: Array<string> = []
    const unreadable = Object.defineProperty(new Error("hidden"), "message", {
      get: () => {
        throw new Error("no message for you")
      },
    })
    const server = makeServer({
      module: FullModule,
      onDefect: () => {
        throw unreadable
      },
      runtime: makeRecordingRunner(logged),
    })
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        return yield* Effect.die(
          new ExampleInvariantDefect({ handler: "userUpsert" }),
        )
      }) as never,
    })

    expect(
      procedures.userGet!.invoke(harness.makeProcedureCtx(), {
        userId: userId as never,
      }),
    ).toHaveProperty("err")
    expect(logged.some((line) => line.includes("cannot be read"))).toBe(true)
  })

  it("leaves handlers untouched when no observer is supplied", () => {
    const server = makeServer({ module: FullModule })
    const reducers = server.reducers({
      userUpsert: Effect.fn(function* () {
        return undefined
      }) as never,
    })

    expect(
      invokeFailure(() =>
        reducers.userUpsert!.invoke(harness.makeMutationCtx(), upsertArgs),
      ),
    ).toBeUndefined()
  })
})
