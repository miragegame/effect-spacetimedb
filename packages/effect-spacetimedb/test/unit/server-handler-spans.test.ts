import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Tracer from "effect/Tracer"
import * as Stdb from "effect-spacetimedb"
import { type SyncRunner, toSyncRunner } from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { make as makeServer } from "../../src/server/bind.ts"
import type { InternalServerInstance } from "../../src/server/handler-types.ts"
import { makeDeterministicNativeSpanFactory } from "../../src/server/tracing.ts"
import { compileModule } from "../helpers/compile-module"

const { describe, expect, it } = EffectVitest

const SpanRow = Stdb.struct({ value: Stdb.string() })

const SpanCallables = Stdb.StdbGroup.make("Spans")
  .add(
    Stdb.StdbFn.reducer("spanReducer", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("spanProcedure", {
      params: Stdb.struct({}),
      returns: Stdb.string(),
    }),
  )
  .add(
    Stdb.StdbFn.anonymousView("spanView", {
      returns: Stdb.array(SpanRow),
    }),
  )

const SpanHttp = Stdb.StdbHttpGroup.make("SpanHttp").add(
  Stdb.StdbHttp.post("spanHttp", "/span"),
)

const SpanModule = Stdb.StdbModule.make("handler_span_fixture", {
  lifecycle: {
    init: Stdb.StdbFn.init(),
  },
})
  .add(SpanCallables)
  .add(SpanHttp).spec

const harness = StdbTesting.makeTestModuleHarness(SpanModule)
const reducerCtx = harness.makeMutationCtx()
const procedureCtx = harness.makeProcedureCtx()
const httpCtx = harness.makeHttpHandlerCtx()

const makeCapturingRuntime = () => {
  const spans: Array<Tracer.Span> = []
  const makeSpan = makeDeterministicNativeSpanFactory()
  const tracer = Tracer.make({
    span: (options) => {
      const span = makeSpan(options)
      spans.push(span)
      return span
    },
  })

  return {
    spans,
    runner: toSyncRunner(Context.make(Tracer.Tracer, tracer)),
  }
}

const makeHandlers = (
  server: InternalServerInstance<typeof SpanModule>,
  reducer: () => Effect.Effect<void>,
) => {
  const handlers = server.handlers({
    reducers: {
      spanReducer: reducer,
    },
    procedures: {
      spanProcedure: Effect.fn(function* () {
        return "ok"
      }),
    },
    views: {
      spanView: Effect.fn(function* () {
        return []
      }),
    },
    httpHandlers: {
      spanHttp: Effect.fn(function* (_request: Stdb.Request) {
        return new Stdb.SyncResponse("ok")
      }),
    },
    lifecycle: {
      init: Effect.fn(function* () {}),
    },
  })

  return {
    handlers,
    reducers: server.reducers(handlers.reducers!),
    procedures: server.procedures(handlers.procedures!),
    views: server.views(handlers.views!),
    httpHandlers: server.httpHandlers(handlers.httpHandlers!),
    lifecycle: server.lifecycle(handlers.lifecycle!),
  }
}

class HandlerSpanDefect extends Data.TaggedError("HandlerSpanDefect") {}

describe("server handler spans", () => {
  it("runs group middleware inside the endpoint span", () => {
    const MiddlewareGroup = Stdb.StdbGroup.make("Middleware").add(
      Stdb.StdbFn.reducer("middlewareReducer", {}),
    )
    const MiddlewareModule = Stdb.StdbModule.make(
      "middleware_span_fixture",
      {},
    ).add(MiddlewareGroup)
    let middlewareSpanName: string | undefined
    const impl = Stdb.StdbBuilder.group(
      MiddlewareModule,
      "Middleware",
      { middlewareReducer: () => Effect.void },
      {
        middleware: Effect.flatMap(
          Effect.currentSpan.pipe(Effect.orDie),
          (span) => {
            middlewareSpanName = span.name
            return Effect.void
          },
        ),
      },
    )
    const wrapped = Stdb.StdbBuilder.handlersOf(MiddlewareModule, impl)
      .middlewareReducer as (args: Record<string, never>) => Effect.Effect<void>
    const { runner } = makeCapturingRuntime()
    const server = makeServer({
      module: MiddlewareModule.spec,
      runtime: runner,
    })
    const handlers = server.handlers({
      reducers: { middlewareReducer: wrapped },
    })
    const reducers = server.reducers(handlers.reducers!)

    reducers.middlewareReducer.invoke(reducerCtx as never, {})

    expect(middlewareSpanName).toBe("middlewareReducer")
  })

  it("uses the deterministic default tracer in dev-guarded mode", () => {
    const spanIds: Array<string> = []
    const server = makeServer({ module: SpanModule })
    const bound = makeHandlers(
      server,
      Effect.fn(function* () {
        spanIds.push((yield* Effect.currentSpan.pipe(Effect.orDie)).spanId)
      }),
    )
    compileModule({ server, handlers: bound.handlers })

    expect(() =>
      bound.reducers.spanReducer.invoke(reducerCtx as never, {}),
    ).not.toThrow()
    expect(() =>
      bound.reducers.spanReducer.invoke(reducerCtx as never, {}),
    ).not.toThrow()
    expect(spanIds).toEqual(["0000000000000001", "0000000000000001"])
  })

  it("creates one endpoint-key span with static attributes for every handler kind", () => {
    const { runner, spans } = makeCapturingRuntime()
    const server = makeServer({
      module: SpanModule,
      runtime: runner,
    })
    const bound = makeHandlers(
      server,
      Effect.fn(function* () {}),
    )
    const compiled = compileModule({ server, handlers: bound.handlers })

    bound.reducers.spanReducer.invoke(reducerCtx as never, {})
    bound.procedures.spanProcedure.invoke(procedureCtx as never, {})
    bound.views.spanView.invoke({ db: {}, from: {} } as never, {})
    bound.httpHandlers.spanHttp.invoke(
      httpCtx as never,
      new Stdb.Request("http://localhost/span", { method: "POST" }),
    )
    bound.lifecycle.init.invoke(reducerCtx as never)

    expect(compiled.exports.span_reducer).toBeDefined()
    expect(
      spans.map((span) => ({
        name: span.name,
        kind: span.attributes.get("effect-spacetimedb.endpoint.kind"),
        module: span.attributes.get("effect-spacetimedb.module"),
      })),
    ).toEqual([
      {
        name: "spanReducer",
        kind: "reducer",
        module: "handler_span_fixture",
      },
      {
        name: "spanProcedure",
        kind: "procedure",
        module: "handler_span_fixture",
      },
      {
        name: "spanView",
        kind: "view",
        module: "handler_span_fixture",
      },
      {
        name: "spanHttp",
        kind: "httpHandler",
        module: "handler_span_fixture",
      },
      {
        name: "init",
        kind: "lifecycle",
        module: "handler_span_fixture",
      },
    ])
  })

  it("renders the reducer endpoint key in a failing handler cause", () => {
    const { runner: baseRunner } = makeCapturingRuntime()
    const exits: Array<Exit.Exit<unknown, unknown>> = []
    const runner: SyncRunner = {
      runSync: baseRunner.runSync,
      runSyncExit: (effect) => {
        const exit = baseRunner.runSyncExit(effect)
        exits.push(exit)
        return exit
      },
    }
    const server = makeServer({
      module: SpanModule,
      runtime: runner,
    })
    const bound = makeHandlers(
      server,
      Effect.fn(function* () {
        return yield* Effect.die(new HandlerSpanDefect())
      }),
    )
    compileModule({ server, handlers: bound.handlers })

    expect(() =>
      bound.reducers.spanReducer.invoke(reducerCtx as never, {}),
    ).toThrow(HandlerSpanDefect)
    const exit = exits[0]
    expect(exit !== undefined && Exit.isFailure(exit)).toBe(true)
    if (exit !== undefined && Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain("at spanReducer")
    }
  })

  it("parents a retained consumer Effect.fn span under the builder span", () => {
    const { runner, spans } = makeCapturingRuntime()
    const server = makeServer({
      module: SpanModule,
      runtime: runner,
    })
    const bound = makeHandlers(
      server,
      Effect.fn("consumerReducer")(function* () {}),
    )
    compileModule({ server, handlers: bound.handlers })

    bound.reducers.spanReducer.invoke(reducerCtx as never, {})

    expect(spans.map((span) => span.name)).toEqual([
      "spanReducer",
      "consumerReducer",
    ])
    expect(Option.getOrUndefined(spans[1]!.parent)).toBe(spans[0])
  })
})
