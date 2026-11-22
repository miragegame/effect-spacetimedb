// The HTTP transport shared by every STDB call the client makes: the
// per-call duration bound, response-body reading, and transport failures.

import * as Data from "effect/Data"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import {
  boundedCallDurationMax,
  withDeadline,
  callDurationMaxDefault,
} from "./call-duration.ts"
import { TransportError } from "./call-errors.ts"

export { callDurationMaxDefault } from "./call-duration.ts"

export type HttpClientConfig = {
  readonly uri: string
  readonly databaseName: string
  readonly token?: string | undefined
  /**
   * The longest one call may take, from sending the request to reading the
   * whole response. A call still unanswered at this bound fails with
   * `TransportError`, the same failure as an unreachable host. Defaults to
   * `callDurationMaxDefault`, 30 seconds: without a bound a partitioned or
   * paused database holds each call for as long as the underlying HTTP client
   * waits, which may be forever. A request that already reached the database
   * may still commit after its caller gave up. Use Duration.infinity to disable the deadline. Durations must be positive;
   * constructing a client with anything else throws a `TypeError`.
   */
  readonly callDurationMax?: Duration.Input | undefined
}

/** The `TransportError` cause of a call that outlived `callDurationMax`. */
export class HttpCallDurationExceededError extends Data.TaggedError(
  "HttpCallDurationExceededError",
)<{
  readonly callName: string
  readonly callDurationMax: Duration.Input
}> {}

export const assertCallDurationMaxBounded = (
  config: HttpClientConfig,
): void => {
  boundedCallDurationMax("HTTP client", config.callDurationMax)
}

export const boundCallDuration =
  (config: HttpClientConfig, callName: string) =>
  <A, E, R>(
    call: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | TransportError, R> => {
    const callDurationMax = config.callDurationMax ?? callDurationMaxDefault
    return call.pipe(
      withDeadline({
        duration: callDurationMax,
        orElse: () =>
          Effect.fail(
            new TransportError({
              cause: new HttpCallDurationExceededError({
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
