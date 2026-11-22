import type * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import type { RecoveringConnection } from "./ws-supervised-recovery.ts"

/**
 * Where a supervisor is. `attempt` counts the supervisor's own activations.
 *
 * - `connecting`: the first activation is in progress.
 * - `live`: the current session is connected and set up.
 * - `recovering`: automatic reconnect only. The live session's socket
 *   dropped and the SDK is reconnecting it on its own, then replaying its
 *   subscriptions; the session is retained (published as waiting) and its
 *   cache stays readable, while its calls fail with `CallNotSentError`.
 *   `reconnectAttempt` and `reconnectDelayMillis` are the SDK's next
 *   scheduled attempt (`0` and `0` for a socket found closed before the SDK
 *   noticed, and a zero delay while the replay runs); `reason` is the error
 *   that ended the previous socket or attempt, or names the replay.
 * - `reconnecting`: the session ended (or an activation failed) and the
 *   supervisor is building a replacement after its own backoff.
 * - `fatal`: retrying cannot help; the supervisor stopped.
 */
export type WsSessionSupervisorPhase<Failure> =
  | {
      readonly status: "connecting"
      readonly attempt: number
    }
  | {
      readonly status: "live"
      readonly attempt: number
    }
  | {
      readonly status: "recovering"
      readonly attempt: number
      readonly reconnectAttempt: number
      readonly reconnectDelayMillis: number
      readonly reason: string
    }
  | {
      readonly status: "reconnecting"
      readonly attempt: number
      readonly failure: Failure
    }
  | {
      readonly status: "fatal"
      readonly attempt: number
      readonly failure: Failure
    }

/**
 * Everything a supervisor shows, as one value: its two public refs are views of
 * this, so what they say cannot come apart. `attempt` is the attempts started so
 * far, which is what the phase of each attempt reports.
 */
export type SupervisorState<Session, Failure> = {
  readonly attempt: number
  readonly session: AsyncResult.AsyncResult<Session, Failure>
  readonly phase: WsSessionSupervisorPhase<Failure>
}

export type SupervisorEvent<Session, Failure> =
  | { readonly kind: "attemptStarted" }
  /** A session finished activating, or finished an automatic reconnect. */
  | { readonly kind: "live"; readonly session: Session }
  | { readonly kind: "recovering"; readonly recovery: RecoveringConnection }
  /**
   * What vouched for the rows on show is gone: an end that revokes them, a
   * token a replacement could not get, or a replacement that is someone else.
   */
  | { readonly kind: "rowsRevoked"; readonly ending: Cause.Cause<Failure> }
  | { readonly kind: "attemptFailed"; readonly failure: Failure }
  | { readonly kind: "parked"; readonly failure: Failure }

export const supervisorStart = <Session, Failure>(): SupervisorState<
  Session,
  Failure
> => ({
  attempt: 0,
  session: AsyncResult.initial<Session, Failure>(true),
  phase: { status: "connecting", attempt: 1 },
})

// The session stays published as waiting while it is replaced, so that its cache
// stays readable. Only a `live` event ever puts a session on show, so the rows of a
// revoked session stay gone as long as nobody sends one for it: the supervisor
// checks that a session is still fit in the same step that publishes it.
const retained = <Session, Failure>(
  session: AsyncResult.AsyncResult<Session, Failure>,
  failure: Failure,
): AsyncResult.AsyncResult<Session, Failure> =>
  AsyncResult.isSuccess(session)
    ? AsyncResult.waiting(session)
    : AsyncResult.failWithPrevious(failure, {
        previous: Option.some(session),
        waiting: true,
      })

/** The one place a supervisor's session and phase change. `fatal` is terminal. */
export const supervise = <Session, Failure>(
  state: SupervisorState<Session, Failure>,
  event: SupervisorEvent<Session, Failure>,
): SupervisorState<Session, Failure> => {
  if (state.phase.status === "fatal") {
    return state
  }
  const { attempt } = state
  switch (event.kind) {
    case "attemptStarted": {
      const started = attempt + 1
      return {
        ...state,
        attempt: started,
        phase:
          state.phase.status === "reconnecting"
            ? { ...state.phase, attempt: started }
            : { status: "connecting", attempt: started },
      }
    }
    case "live":
      return {
        ...state,
        session: AsyncResult.success(event.session),
        phase: { status: "live", attempt },
      }
    case "recovering":
      // Only a live session recovers. One that ended stays ended, so a report
      // that lost the race with the end cannot hide the failure.
      if (
        state.phase.status !== "live" &&
        state.phase.status !== "recovering"
      ) {
        return state
      }
      return {
        ...state,
        session: AsyncResult.waiting(state.session),
        phase: {
          status: "recovering",
          attempt,
          reconnectAttempt: event.recovery.reconnectAttempt,
          reconnectDelayMillis: event.recovery.reconnectDelayMillis,
          reason: event.recovery.reason,
        },
      }
    case "rowsRevoked":
      // Published as it ends, so every later failure finds nothing to keep.
      return state.session.pipe(AsyncResult.value, Option.isSome)
        ? {
            ...state,
            session: AsyncResult.failure(event.ending, { waiting: true }),
          }
        : state
    case "attemptFailed":
      return {
        ...state,
        session: retained(state.session, event.failure),
        phase: { status: "reconnecting", attempt, failure: event.failure },
      }
    case "parked":
      return {
        ...state,
        session: AsyncResult.failWithPrevious(event.failure, {
          previous: Option.some(state.session),
        }),
        phase: { status: "fatal", attempt, failure: event.failure },
      }
  }
}
