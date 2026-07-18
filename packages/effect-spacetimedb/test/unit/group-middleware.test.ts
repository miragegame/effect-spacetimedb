import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

class MiddlewareFailure extends Schema.TaggedErrorClass<MiddlewareFailure>()(
  "MiddlewareFailure",
  {},
) {}

const record = (events: Array<string>, value: string) =>
  Effect.suspend(() => {
    events.push(value)
    return Effect.void
  })

const runnableHandlers = <Handlers>(handlers: unknown): Handlers =>
  handlers as Handlers

describe("group middleware", (it) => {
  it.effect(
    "runs per-kind middleware before reducer and procedure handlers",
    () =>
      Effect.gen(function* () {
        const events: Array<string> = []
        const Calls = Stdb.StdbGroup.make("Calls").add(
          Stdb.StdbFn.reducer("reduce", {}),
          Stdb.StdbFn.procedure("proceed", { returns: Stdb.unit() }),
        )
        const Module = Stdb.StdbModule.make("group_middleware_order", {}).add(
          Calls,
        )
        const impl = Stdb.StdbBuilder.group(
          Module,
          "Calls",
          {
            reduce: () => record(events, "reducer-handler"),
            proceed: () => record(events, "procedure-handler"),
          },
          {
            middleware: {
              reducers: record(events, "reducer-middleware"),
              procedures: record(events, "procedure-middleware"),
            },
          },
        )
        const handlers = runnableHandlers<{
          readonly reduce: (args: Record<string, never>) => Effect.Effect<void>
          readonly proceed: (args: Record<string, never>) => Effect.Effect<void>
        }>(Stdb.StdbBuilder.handlersOf(Module, impl))

        yield* handlers.reduce({})
        yield* handlers.proceed({})

        expect(events).toEqual([
          "reducer-middleware",
          "reducer-handler",
          "procedure-middleware",
          "procedure-handler",
        ])
      }),
  )

  it.effect("short-circuits handlers when declared middleware fails", () =>
    Effect.gen(function* () {
      const events: Array<string> = []
      const Calls = Stdb.StdbGroup.make("Calls", {
        errors: Stdb.errors(MiddlewareFailure),
      }).add(Stdb.StdbFn.reducer("reduce", {}))
      const Module = Stdb.StdbModule.make("group_middleware_failure", {}).add(
        Calls,
      )
      const impl = Stdb.StdbBuilder.group(
        Module,
        "Calls",
        {
          reduce: () => {
            events.push("handler-created")
            return record(events, "handler")
          },
        },
        {
          middleware: {
            reducers: Effect.fail(MiddlewareFailure.make({})),
          },
        },
      )
      const handlers = runnableHandlers<{
        readonly reduce: (
          args: Record<string, never>,
        ) => Effect.Effect<void, MiddlewareFailure>
      }>(Stdb.StdbBuilder.handlersOf(Module, impl))

      const exit = yield* Effect.exit(handlers.reduce({}))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(events).toEqual([])
    }),
  )

  it.effect(
    "does not apply shorthand middleware to views or lifecycle hooks",
    () =>
      Effect.gen(function* () {
        const events: Array<string> = []
        const Mixed = Stdb.StdbGroup.make("Mixed").add(
          Stdb.StdbFn.reducer("reduce", {}),
          Stdb.StdbFn.anonymousView("inspect", {
            returns: Stdb.array(Stdb.struct({ id: Stdb.string() })),
          }),
          Stdb.StdbFn.init(),
        )
        const Module = Stdb.StdbModule.make(
          "group_middleware_exclusions",
          {},
        ).add(Mixed)
        const impl = Stdb.StdbBuilder.group(
          Module,
          "Mixed",
          {
            reduce: () => record(events, "reducer-handler"),
            inspect: () => record(events, "view-handler").pipe(Effect.as([])),
            init: () => record(events, "lifecycle-handler"),
          },
          { middleware: record(events, "middleware") },
        )
        const handlers = runnableHandlers<{
          readonly reduce: (args: Record<string, never>) => Effect.Effect<void>
          readonly inspect: () => Effect.Effect<ReadonlyArray<{ id: string }>>
          readonly init: () => Effect.Effect<void>
        }>(Stdb.StdbBuilder.handlersOf(Module, impl))

        yield* handlers.inspect()
        yield* handlers.init()
        yield* handlers.reduce({})

        expect(events).toEqual([
          "view-handler",
          "lifecycle-handler",
          "middleware",
          "reducer-handler",
        ])
      }),
  )

  it.effect("routes only HTTP middleware to typed HTTP handlers", () =>
    Effect.gen(function* () {
      const events: Array<string> = []
      const Http = Stdb.StdbHttpGroup.make("Http").add(
        Stdb.StdbHttp.post("typedRoute", "/typed", {
          request: Schema.Struct({}),
          response: Schema.Struct({}),
        }),
      )
      const Module = Stdb.StdbModule.make("group_http_middleware", {}).add(Http)
      const impl = Stdb.StdbBuilder.group(
        Module,
        "Http",
        {
          typedRoute: () => record(events, "http-handler").pipe(Effect.as({})),
        },
        {
          middleware: {
            reducers: record(events, "reducer-middleware"),
            httpHandlers: record(events, "http-middleware"),
          },
        },
      )
      const handlers = runnableHandlers<{
        readonly typedRoute: () => Effect.Effect<Record<string, never>>
      }>(Stdb.StdbBuilder.handlersOf(Module, impl))

      yield* handlers.typedRoute()

      expect(events).toEqual(["http-middleware", "http-handler"])
    }),
  )

  it("rejects malformed middleware at an erased builder boundary", () => {
    const Calls = Stdb.StdbGroup.make("Calls").add(
      Stdb.StdbFn.reducer("reduce", {}),
    )
    const Module = Stdb.StdbModule.make("invalid_group_middleware", {}).add(
      Calls,
    )

    expect(() =>
      Stdb.StdbBuilder.group(Module, "Calls", { reduce: () => Effect.void }, {
        middleware: { reducers: "not-an-effect" },
      } as never),
    ).toThrow(Stdb.StdbValidationError)
  })
})
