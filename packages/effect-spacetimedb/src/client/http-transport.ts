// The HTTP transport shared by every STDB call the client makes: the
// per-call duration bound, response-body reading, and transport failures.

import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { TransportError } from "./call-errors.ts"

export type HttpClientConfig = {
  readonly uri: string
  readonly databaseName: string
  readonly token?: string | undefined
  /**
   * The longest one call may take, from sending the request to reading the
   * whole response. A call still unanswered at this bound fails with
   * `TransportError`, the same failure as an unreachable host. Required:
   * without it a partitioned or paused database holds each call for as long as
   * the underlying HTTP client waits, which may be forever. A request that
   * already reached the database may still commit after its caller gave up.
   * Must be positive and finite; constructing a client with anything else
   * throws a `TypeError`.
   */
  readonly callDurationMax: Duration.Input
}

/** The `TransportError` cause of a call that outlived `callDurationMax`. */
export class HttpCallDurationExceeded extends Data.TaggedError(
  "HttpCallDurationExceeded",
)<{
  readonly callName: string
  readonly callDurationMax: Duration.Input
}> {}

/**
 * Throws a `TypeError` unless `callDurationMax` is a positive, finite
 * duration, the way `Stdb.array(...)` rejects bad length bounds: eagerly, at
 * construction. `Duration.Input` admits `Infinity`, `"Infinity"`, `0` and
 * `NaN` (which `Duration` reads as zero), none of which bounds a call, so
 * "required" would otherwise still allow an unbounded one.
 */
export const assertCallDurationMaxBounded = (
  config: HttpClientConfig,
): void => {
  const input = config.callDurationMax
  const parsed = Duration.fromInput(input)
  const bounded = parsed.pipe(
    Option.filter(
      (duration) =>
        Duration.isFinite(duration) && Duration.isPositive(duration),
    ),
  )
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
      `HTTP client callDurationMax must be a positive, finite duration; received ${received}`,
    )
  }
}

export const boundCallDuration =
  (config: HttpClientConfig, callName: string) =>
  <A, E, R>(
    call: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | TransportError, R> => {
    const callDurationMax = config.callDurationMax
    return call.pipe(
      Effect.timeoutOrElse({
        duration: callDurationMax,
        orElse: () =>
          Effect.fail(
            new TransportError({
              cause: new HttpCallDurationExceeded({
                callName,
                callDurationMax,
              }),
            }),
          ),
      }),
    )
  }

export const readResponseText = <E>(response: {
  readonly status: number
  readonly text: Effect.Effect<string, E>
}): Effect.Effect<string, TransportError> =>
  response.text.pipe(Effect.mapError((cause) => new TransportError({ cause })))

export const transportErrorFrom = (cause: unknown): TransportError =>
  TransportError.is(cause) ? cause : new TransportError({ cause })

export const normalizeBaseUri = (uri: string): string =>
  uri.replace(/\/+$/u, "")
