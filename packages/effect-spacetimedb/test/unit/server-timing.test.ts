import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Tracer from "effect/Tracer"
import { consoleTimerTracer } from "effect-spacetimedb/server"

const { describe, expect, it } = EffectVitest

const withConsoleTimers = <A>(
  methods: {
    readonly time: ((label: string) => void) | undefined
    readonly timeEnd: ((label: string) => void) | undefined
  },
  body: () => A,
): A => {
  const time = Object.getOwnPropertyDescriptor(globalThis.console, "time")
  const timeEnd = Object.getOwnPropertyDescriptor(globalThis.console, "timeEnd")

  Object.defineProperty(globalThis.console, "time", {
    configurable: true,
    value: methods.time,
  })
  Object.defineProperty(globalThis.console, "timeEnd", {
    configurable: true,
    value: methods.timeEnd,
  })

  try {
    return body()
  } finally {
    if (time === undefined) {
      Reflect.deleteProperty(globalThis.console, "time")
    } else {
      Object.defineProperty(globalThis.console, "time", time)
    }
    if (timeEnd === undefined) {
      Reflect.deleteProperty(globalThis.console, "timeEnd")
    } else {
      Object.defineProperty(globalThis.console, "timeEnd", timeEnd)
    }
  }
}

const runWithConsoleTimerTracer = <A>(effect: Effect.Effect<A>) =>
  effect.pipe(
    Effect.provideService(Tracer.Tracer, consoleTimerTracer),
    Effect.runSync,
  )

const withMissingConsole = <A>(body: () => A): A => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "console")
  Object.defineProperty(globalThis, "console", {
    configurable: true,
    value: undefined,
  })

  try {
    return body()
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, "console")
    } else {
      Object.defineProperty(globalThis, "console", descriptor)
    }
  }
}

describe("console timer tracer", () => {
  it("pairs unique labels across nested spans", () => {
    const starts: Array<string> = []
    const ends: Array<string> = []

    withConsoleTimers(
      {
        time: (label) => starts.push(label),
        timeEnd: (label) => ends.push(label),
      },
      () =>
        runWithConsoleTimerTracer(
          Effect.void.pipe(
            Effect.withSpan("child", {}, { captureStackTrace: false }),
            Effect.withSpan("parent", {}, { captureStackTrace: false }),
          ),
        ),
    )

    expect(starts).toHaveLength(2)
    expect(new Set(starts).size).toBe(2)
    expect(starts[0]!).toMatch(/^parent#[a-f0-9]{16}$/)
    expect(starts[1]!).toMatch(/^child#[a-f0-9]{16}$/)
    expect(ends).toEqual([starts[1], starts[0]])
  })

  it("retains NativeSpan behavior", () => {
    const isNative = withConsoleTimers(
      { time: () => undefined, timeEnd: () => undefined },
      () =>
        runWithConsoleTimerTracer(
          Effect.useSpan("native", {}, (span) =>
            Effect.succeed(
              span.name === "native" &&
                span.spanId.length === 16 &&
                span.traceId.length === 32,
            ),
          ),
        ),
    )

    expect(isNative).toBe(true)
  })

  it("keeps root span IDs local to each invocation", () => {
    const spanIds = [
      runWithConsoleTimerTracer(
        Effect.currentSpan.pipe(
          Effect.orDie,
          Effect.map((span) => span.spanId),
          Effect.withSpan("first", {}, { captureStackTrace: false }),
        ),
      ),
      runWithConsoleTimerTracer(
        Effect.currentSpan.pipe(
          Effect.orDie,
          Effect.map((span) => span.spanId),
          Effect.withSpan("second", {}, { captureStackTrace: false }),
        ),
      ),
    ]

    expect(spanIds).toEqual(["0000000000000001", "0000000000000001"])
  })

  it("degrades to a no-op when console timers are absent", () => {
    expect(() =>
      withConsoleTimers({ time: undefined, timeEnd: undefined }, () =>
        runWithConsoleTimerTracer(
          Effect.void.pipe(
            Effect.withSpan("no-timer", {}, { captureStackTrace: false }),
          ),
        ),
      ),
    ).not.toThrow()
  })

  it("does not start a timer unless timeEnd is also available", () => {
    const starts: Array<string> = []

    withConsoleTimers(
      { time: (label) => starts.push(label), timeEnd: undefined },
      () =>
        runWithConsoleTimerTracer(
          Effect.void.pipe(
            Effect.withSpan("unpaired", {}, { captureStackTrace: false }),
          ),
        ),
    )

    expect(starts).toEqual([])
  })

  it("degrades to a no-op when console is absent", () => {
    expect(() =>
      withMissingConsole(() =>
        runWithConsoleTimerTracer(
          Effect.void.pipe(
            Effect.withSpan("no-console", {}, { captureStackTrace: false }),
          ),
        ),
      ),
    ).not.toThrow()
  })
})
