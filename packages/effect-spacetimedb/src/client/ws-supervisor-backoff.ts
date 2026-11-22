import { finiteDelayMillis } from "./call-duration.ts"
import * as Clock from "effect/Clock"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"

export const reconnectDelayFirstDefault = Duration.millis(250)
export const reconnectDelayMaxDefault = Duration.seconds(30)
/**
 * How long a session stays live before its end counts as healthy, when a policy
 * does not set `stabilityWindow`.
 */
export const stabilityWindowDefault = Duration.seconds(30)

export type WsSessionBackoffPolicy = {
  readonly reconnectDelayFirst?: Duration.Input | undefined
  readonly reconnectDelayMax?: Duration.Input | undefined
  readonly reconnectJitter?: boolean | undefined
  /**
   * How long a session must stay live for the reconnect delay to start over
   * from `reconnectDelayFirst`. Going live alone proves little: a server
   * that accepts a session and ends it at once, every time, would otherwise see
   * every client back at the shortest delay after each session. A shorter
   * session keeps the delay growing. Defaults to `stabilityWindowDefault`,
   * 30 seconds. Must be positive and finite: a supervisor built with any other
   * value throws a `TypeError`.
   */
  readonly stabilityWindow?: Duration.Input | undefined
}

/**
 * Throws a `TypeError` unless every delay is finite and not negative, and the
 * stability window is finite and positive. A delay of `NaN` reads as zero, which
 * retries with no backoff at all, and `Infinity` waits forever with no error. A
 * window of `0` would start the delay over after every session, `Infinity` never
 * would, and `NaN` compares false to everything.
 */
export const backoffBounds = (policy: WsSessionBackoffPolicy | undefined) => {
  const first = finiteDelayMillis(
    "WebSocket session supervisor reconnectDelayFirst",
    policy?.reconnectDelayFirst ?? reconnectDelayFirstDefault,
  )
  const max = finiteDelayMillis(
    "WebSocket session supervisor reconnectDelayMax",
    policy?.reconnectDelayMax ?? reconnectDelayMaxDefault,
  )
  const window = finiteDelayMillis(
    "WebSocket session supervisor stabilityWindow",
    policy?.stabilityWindow ?? stabilityWindowDefault,
  )
  if (window === 0)
    throw new TypeError(
      "WebSocket session supervisor stabilityWindow must be positive",
    )
  const delayFirstMillis = Math.max(1, first)
  return {
    delayFirstMillis,
    delayMaxMillis: Math.max(delayFirstMillis, max),
    stableMillis: window,
    jitter: policy?.reconnectJitter ?? true,
  }
}

/** The most `Schedule.jittered` can multiply a delay by. */
const jitterFactorMax = 1.2

/**
 * The supervisor's wait between sessions. `schedule` is exponential in the ends
 * seen since the last stable session and outlives every session, so an end that
 * proves nothing keeps the delay growing.
 *
 * With jitter the exponential stops short of the ceiling by jitter's own reach, so
 * the drawn delay lands anywhere from two thirds of the ceiling to all of it.
 * Capping the drawn delay instead would put half of the clients that reached the
 * ceiling on exactly the same delay.
 *
 * `liveBegan` and `liveEnded` mark a stretch of being live, and a stretch that
 * lasted the window is the one thing that starts the delay over. It is judged
 * as it closes, so an unbroken session and one that stayed live between two of
 * the SDK's recoveries count alike.
 */
export const makeSupervisorBackoff = Effect.fnUntraced(function* ({
  delayFirstMillis,
  delayMaxMillis,
  stableMillis,
  jitter,
}: ReturnType<typeof backoffBounds>) {
  const endsSinceStable = yield* Ref.make(0)
  const liveSince = yield* Ref.make<number | undefined>(undefined)
  const exponentialMaxMillis = jitter
    ? delayMaxMillis / jitterFactorMax
    : delayMaxMillis

  const exponential = Schedule.forever.pipe(
    Schedule.modifyDelay(() =>
      Ref.getAndUpdate(endsSinceStable, (ends) => ends + 1).pipe(
        Effect.map((ends) =>
          Duration.millis(
            Math.min(delayFirstMillis * 2 ** ends, exponentialMaxMillis),
          ),
        ),
      ),
    ),
  )

  return {
    schedule: jitter ? exponential.pipe(Schedule.jittered) : exponential,
    liveBegan: Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) => Ref.set(liveSince, now)),
    ),
    liveEnded: Effect.gen(function* () {
      const began = yield* Ref.getAndSet(liveSince, undefined)
      const now = yield* Clock.currentTimeMillis
      if (began !== undefined && now - began >= stableMillis) {
        yield* Ref.set(endsSinceStable, 0)
      }
    }),
  }
})
