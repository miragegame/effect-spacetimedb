import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

/** The bound on one call when a client does not set `callDurationMax`. */
export const callDurationMaxDefault = Duration.seconds(30)

/** Infinity disables the deadline. Validate other inputs at construction. */
export const boundedCallDurationMax = (
  client: "HTTP client" | "WebSocket",
  callDurationMax: Duration.Input | undefined,
): Duration.Input => {
  const input = callDurationMax ?? callDurationMaxDefault
  const parsed = Duration.fromInput(input)
  const bounded = parsed.pipe(Option.filter(Duration.isPositive))
  if (Option.isNone(bounded)) {
    // Primitives render as given, so `NaN` stays visible rather than reading
    // as the zero `Duration` makes of it.
    const received =
      typeof input === "object"
        ? Option.match(parsed, {
            onNone: () => "an unparseable duration",
            onSome: Duration.format,
          })
        : String(input)
    throw new TypeError(
      `${client} callDurationMax must be a positive duration; received ${received}`,
    )
  }
  return input
}

/** Keep the operation interruptible by its owner when it has no deadline. */
export const withDeadline =
  <E>(options: {
    readonly duration: Duration.Input
    readonly orElse: () => Effect.Effect<never, E>
  }) =>
  <A, E2, R>(operation: Effect.Effect<A, E2, R>): Effect.Effect<A, E | E2, R> =>
    Duration.isFinite(Duration.fromInputUnsafe(options.duration))
      ? Effect.timeoutOrElse(operation, options)
      : operation

/** Convert a public input at the timer or SDK boundary. Preserve numeric NaN
 * for validation because Duration treats it as zero. */
export const durationMillis = (input: Duration.Input): number =>
  typeof input === "number"
    ? input
    : Option.match(Duration.fromInput(input), {
        onNone: () => Number.NaN,
        onSome: Duration.toMillis,
      })

export const finiteDelayMillis = (
  name: string,
  input: Duration.Input,
): number => {
  const millis = durationMillis(input)
  if (!(Number.isFinite(millis) && millis >= 0)) {
    throw new TypeError(
      `${name} must be a finite, non-negative duration; received ${String(input)}`,
    )
  }
  return millis
}
