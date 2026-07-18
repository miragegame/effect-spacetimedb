import type * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Tracer from "effect/Tracer"
import { makeDeterministicNativeSpanFactory } from "./tracing.ts"

type SpanOptions = Parameters<Tracer.Tracer["span"]>[0]

type StartedTimer = {
  readonly owner: object
  readonly timeEnd: Function
}

const startTimer = (label: string): StartedTimer | undefined => {
  const owner = Reflect.get(globalThis, "console")
  if (typeof owner !== "object" || owner === null) {
    return undefined
  }

  const time = Reflect.get(owner, "time")
  const timeEnd = Reflect.get(owner, "timeEnd")
  if (typeof time !== "function" || typeof timeEnd !== "function") {
    return undefined
  }

  Reflect.apply(time, owner, [label])
  return { owner, timeEnd }
}

const makeNativeSpan = makeDeterministicNativeSpanFactory()

const makeConsoleTimerSpan = (options: SpanOptions): Tracer.Span => {
  const span = makeNativeSpan(options)
  const timerLabel = `${span.name}#${span.spanId}`
  const timer = startTimer(timerLabel)
  let timerRunning = timer !== undefined
  const end = span.end

  span.end = function (
    this: Tracer.Span,
    endTime: bigint,
    exit: Exit.Exit<unknown, unknown>,
  ): void {
    end.call(this, endTime, exit)

    if (timerRunning && timer !== undefined) {
      timerRunning = false
      Reflect.apply(timer.timeEnd, timer.owner, [timerLabel])
    }
  }

  return span
}

/**
 * A native Effect tracer that mirrors every span to `console.time` and
 * `console.timeEnd`. In a SpacetimeDB module those calls use the host timer
 * syscalls and emit timing entries to the database log.
 *
 * This tracer is intentionally opt-in: it adds two host calls per span and is
 * best reserved for focused timing investigations, especially on reducer hot
 * paths.
 */
export const consoleTimerTracer: Tracer.Tracer = Tracer.make({
  span: makeConsoleTimerSpan,
})

/** Installs {@link consoleTimerTracer} as the active Effect tracer. */
export const consoleTimerTracerLayer = Layer.succeed(
  Tracer.Tracer,
  consoleTimerTracer,
)
