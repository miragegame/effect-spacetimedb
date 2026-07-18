import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as EffectRuntime from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Tracer from "effect/Tracer"

type NativeSpanFactory = (
  options: Parameters<Tracer.Tracer["span"]>[0],
) => Tracer.Span

class DeterministicNativeSpan implements Tracer.Span {
  readonly _tag = "Span"
  readonly spanId: string
  readonly traceId: string
  readonly name: string
  readonly parent: Option.Option<Tracer.AnySpan>
  readonly annotations: Context.Context<never>
  readonly links: Array<Tracer.SpanLink>
  readonly sampled: boolean
  readonly kind: Tracer.SpanKind
  readonly attributes = new Map<string, unknown>()
  readonly events: Array<[string, bigint, Record<string, unknown>]> = []
  status: Tracer.SpanStatus

  constructor(options: Parameters<Tracer.Tracer["span"]>[0], spanId: string) {
    this.spanId = spanId
    this.name = options.name
    this.parent = options.parent
    this.annotations = options.annotations
    this.links = options.links
    this.sampled = options.sampled
    this.kind = options.kind
    this.status = { _tag: "Started", startTime: options.startTime }
    this.traceId =
      Option.getOrUndefined(options.parent)?.traceId ??
      this.spanId.padStart(32, "0")
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    this.status = {
      _tag: "Ended",
      startTime: this.status.startTime,
      endTime,
      exit,
    }
  }

  attribute(key: string, value: unknown): void {
    this.attributes.set(key, value)
  }

  event(
    name: string,
    startTime: bigint,
    attributes: Record<string, unknown> = {},
  ): void {
    this.events.push([name, startTime, attributes])
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    for (const link of links) {
      this.links.push(link)
    }
  }
}

export const makeDeterministicNativeSpanFactory = (): NativeSpanFactory => {
  const spanSequences = new WeakMap<Tracer.AnySpan, { value: bigint }>()

  return (options) => {
    const parent = Option.getOrUndefined(options.parent)
    const sequence =
      parent === undefined
        ? { value: 0n }
        : (spanSequences.get(parent) ?? { value: 0n })
    sequence.value += 1n
    const spanId = sequence.value.toString(16).padStart(16, "0")
    const span = new DeterministicNativeSpan(options, spanId)
    spanSequences.set(span, sequence)
    return span
  }
}

const makeDeterministicNativeTracer = (): Tracer.Tracer =>
  Tracer.make({ span: makeDeterministicNativeSpanFactory() })

const defaultEffectTracer = Context.get(Context.empty(), Tracer.Tracer)

export const withDeterministicDefaultTracer = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  EffectRuntime.flatMap(EffectRuntime.tracer, (tracer) =>
    tracer === defaultEffectTracer
      ? EffectRuntime.withTracer(effect, makeDeterministicNativeTracer())
      : effect,
  )
