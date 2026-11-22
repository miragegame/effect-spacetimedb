import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as References from "effect/References"
import * as Tracer from "effect/Tracer"

const { describe, expect, it } = EffectVitest

import { HandlerAsyncNotAllowedDefect } from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, type UserId } from "../fixtures/full-module"
import { makeServer } from "../helpers/module-server"

const upsertArgs = {
  name: "Ada" as never,
  userId: "user-1" as UserId as never,
}

class CallerService extends Context.Service<CallerService, string>()(
  "effect-spacetimedb/test/unit/server-handler-async.test/CallerService",
) {}

describe("sleeping in a handler", () => {
  const harness = StdbTesting.makeTestModuleHarness(FullModule)

  it("dies, past any catch, with a message that names where", () => {
    const server = makeServer({ module: FullModule })
    let recovered = false
    const reducers = server.reducers({
      userUpsert: Effect.fn(function* () {
        yield* Effect.sleep(Duration.seconds(1)).pipe(
          // @effect-diagnostics-next-line catchUnfailableEffect:off The point: a sleep that failed instead of dying would land here.
          Effect.catch(() => {
            recovered = true
            return Effect.void
          }),
        )
      }) as never,
    })

    const reducer = reducers.userUpsert!
    expect(() => reducer.invoke(harness.makeMutationCtx(), upsertArgs)).toThrow(
      /reducers, procedures and views/,
    )
    expect(recovered).toBe(false)
  })

  it("lets retry and repeat without a delay finish", () => {
    let attempts = 0
    const server = makeServer({ module: FullModule })
    const reducers = server.reducers({
      userUpsert: Effect.fn(function* () {
        yield* Effect.suspend(() => {
          attempts = attempts + 1
          return attempts < 6 ? Effect.fail("again") : Effect.void
        }).pipe(Effect.retry({ times: 5 }), Effect.orDie)
      }) as never,
    })

    reducers.userUpsert!.invoke(harness.makeMutationCtx(), upsertArgs)

    expect(attempts).toBe(6)
  })

  it("keeps the same defect class", () => {
    const reducers = makeServer({ module: FullModule }).reducers({
      userUpsert: (() => Effect.sleep(Duration.millis(1))) as never,
    })

    expect(() =>
      reducers.userUpsert!.invoke(harness.makeMutationCtx(), upsertArgs),
    ).toThrow(HandlerAsyncNotAllowedDefect)
  })
})

describe("withTx bodies", () => {
  it("keep the services their caller provided", () => {
    const harness = StdbTesting.makeTestModuleHarness(FullModule)
    const server = makeServer({ module: FullModule })
    let seen: string | undefined
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        yield* server
          .withTx(
            Effect.gen(function* () {
              seen = yield* CallerService
            }),
          )
          .pipe(Effect.provideService(CallerService, "from the caller"))
      }) as never,
    })

    procedures.userGet!.invoke(harness.makeProcedureCtx(), {
      userId: "user-1" as UserId as never,
    })

    expect(seen).toBe("from the caller")
  })

  it("keep the caller's log annotations and span", () => {
    const harness = StdbTesting.makeTestModuleHarness(FullModule)
    const server = makeServer({ module: FullModule })
    let annotations: Record<string, unknown> = {}
    let parentName: string | undefined
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        yield* server
          .withTx(
            Effect.gen(function* () {
              annotations = {
                ...(yield* References.CurrentLogAnnotations),
              }
              const parent = yield* Effect.option(Effect.currentParentSpan)
              parentName = Option.match(parent, {
                onNone: () => undefined,
                onSome: (span) => (span as Tracer.Span).name,
              })
            }),
          )
          .pipe(
            Effect.annotateLogs({ request: "r-1" }),
            Effect.withSpan("caller"),
          )
      }) as never,
    })

    procedures.userGet!.invoke(harness.makeProcedureCtx(), {
      userId: "user-1" as UserId as never,
    })

    expect(annotations).toMatchObject({ request: "r-1" })
    expect(parentName).toBe("caller")
  })

  it("get transaction services from the transaction", () => {
    const harness = StdbTesting.makeTestModuleHarness(FullModule)
    const server = makeServer({ module: FullModule })
    let senderAuth: unknown
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        yield* server.withTx(
          Effect.gen(function* () {
            senderAuth = (yield* server.TxCtx).senderAuth
          }),
        )
      }) as never,
    })

    procedures.userGet!.invoke(harness.makeProcedureCtx(), {
      userId: "user-1" as UserId as never,
    })

    expect(senderAuth).toBeDefined()
  })

  for (const runtimeMode of ["runtime", "dev-guarded"] as const) {
    describe(`in ${runtimeMode} mode`, () => {
      const makeTracedHarness = (order: Array<string>) => {
        const harness = StdbTesting.makeTestModuleHarness(FullModule)
        const ctx = harness.makeProcedureCtx()
        return {
          harness,
          ctx: {
            ...ctx,
            withTx: <A>(body: (tx: never) => A): A => {
              const result = ctx.withTx((tx) => body(tx as never))
              order.push("commit")
              return result
            },
          },
        }
      }

      it("release what they acquired before the commit, with their Db", () => {
        const order: Array<string> = []
        const { harness, ctx } = makeTracedHarness(order)
        const server = makeServer({ module: FullModule, runtimeMode })
        const procedures = server.procedures({
          userGet: Effect.fn(function* () {
            yield* server.withTx(
              Effect.gen(function* () {
                const db = yield* server.Db
                yield* Effect.acquireRelease(Effect.void, () =>
                  db.user
                    .insert({ id: "user-1" as never, name: "Ada" as never })
                    .pipe(
                      Effect.orDie,
                      Effect.andThen(
                        Effect.suspend(() => {
                          order.push("release")
                          return Effect.void
                        }),
                      ),
                    ),
                )
              }),
            )
          }) as never,
        })

        const reply = procedures.userGet!.invoke(ctx, {
          userId: "user-1" as UserId as never,
        })

        expect(reply).toHaveProperty("ok")
        expect(order).toEqual(["release", "commit"])
        expect(harness.db.user.count()).toBe(1n)
      })

      it("abort the transaction when a release dies", () => {
        const order: Array<string> = []
        const observed: Array<Cause.Cause<unknown>> = []
        const { harness, ctx } = makeTracedHarness(order)
        const server = makeServer({
          module: FullModule,
          runtimeMode,
          onDefect: (cause) => {
            observed.push(cause)
          },
        })
        const procedures = server.procedures({
          userGet: Effect.fn(function* () {
            yield* server.withTx(
              Effect.gen(function* () {
                const db = yield* server.Db
                yield* db.user.insert({
                  id: "user-1" as never,
                  name: "Ada" as never,
                })
                yield* Effect.acquireRelease(Effect.void, () =>
                  Effect.die("the release failed"),
                )
              }),
            )
          }) as never,
        })

        const reply = procedures.userGet!.invoke(ctx, {
          userId: "user-1" as UserId as never,
        })

        expect(reply).toHaveProperty("err")
        expect(order).toEqual([])
        expect(harness.db.user.count()).toBe(0n)
        expect(observed.length).toBe(1)
      })

      it("shadow a scope the caller holds", () => {
        const order: Array<string> = []
        const { ctx } = makeTracedHarness(order)
        const server = makeServer({ module: FullModule, runtimeMode })
        const procedures = server.procedures({
          userGet: Effect.fn(function* () {
            yield* server
              .withTx(
                Effect.acquireRelease(Effect.void, () =>
                  Effect.suspend(() => {
                    order.push("release")
                    return Effect.void
                  }),
                ),
              )
              .pipe(
                Effect.andThen(
                  Effect.suspend(() => {
                    order.push("after withTx")
                    return Effect.void
                  }),
                ),
                Effect.scoped,
              )
          }) as never,
        })

        procedures.userGet!.invoke(ctx, {
          userId: "user-1" as UserId as never,
        })

        expect(order).toEqual(["release", "commit", "after withTx"])
      })
    })
  }

  it("resolve going asynchronous before the caller or the commit sees it", () => {
    const harness = StdbTesting.makeTestModuleHarness(FullModule)
    const server = makeServer({ module: FullModule })
    let bodyExit: Exit.Exit<unknown, unknown> | undefined
    let released = false
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        bodyExit = yield* Effect.exit(
          server.withTx(
            Effect.gen(function* () {
              const db = yield* server.Db
              yield* db.user.insert({
                id: "user-1" as never,
                name: "Ada" as never,
              })
              yield* Effect.acquireRelease(Effect.void, () =>
                Effect.suspend(() => {
                  released = true
                  return Effect.void
                }),
              )
              yield* Effect.promise(() => Promise.withResolvers<void>().promise)
            }),
          ),
        )
      }) as never,
    })

    procedures.userGet!.invoke(harness.makeProcedureCtx(), {
      userId: "user-1" as UserId as never,
    })

    expect(released).toBe(true)
    expect(harness.db.user.count()).toBe(0n)
    expect(() => Date.now()).not.toThrow()
    expect(bodyExit !== undefined && Exit.isFailure(bodyExit)).toBe(true)
    if (bodyExit !== undefined && Exit.isFailure(bodyExit)) {
      expect(
        bodyExit.cause.reasons.find(Cause.isDieReason)?.defect,
      ).toBeInstanceOf(HandlerAsyncNotAllowedDefect)
    }
  })

  it("cannot reach the procedure's own context", () => {
    const observed: Array<Cause.Cause<unknown>> = []
    const harness = StdbTesting.makeTestModuleHarness(FullModule)
    const server = makeServer({
      module: FullModule,
      onDefect: (cause) => {
        observed.push(cause)
      },
    })
    const procedures = server.procedures({
      userGet: Effect.fn(function* () {
        yield* server.withTx(
          server.ProcedureCtx as unknown as Effect.Effect<void>,
        )
      }) as never,
    })

    const reply = procedures.userGet!.invoke(harness.makeProcedureCtx(), {
      userId: "user-1" as UserId as never,
    })

    expect(reply).toHaveProperty("err")
    expect(observed.length).toBe(1)
  })
})
