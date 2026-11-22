import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as FastCheck from "fast-check"
import {
  supervise,
  type SupervisorEvent,
  type SupervisorState,
  supervisorStart,
} from "../../src/client/ws-supervisor-state.ts"

const { describe, expect, it } = EffectVitest

type Session = { readonly id: number }
type Failure = { readonly code: number }
type Event = SupervisorEvent<Session, Failure>

const propertyParameters = { numRuns: 500, seed: 0x5e55_1014 }

const sessions = FastCheck.integer({ min: 1, max: 5 })
const failures = FastCheck.integer({ min: 1, max: 5 }).map(
  (code): Failure => ({ code }),
)

const events: FastCheck.Arbitrary<Event> = FastCheck.oneof(
  FastCheck.constant<Event>({ kind: "attemptStarted" }),
  sessions.map((id): Event => ({ kind: "live", session: { id } })),
  FastCheck.constant<Event>({
    kind: "recovering",
    recovery: {
      status: "recovering",
      reason: "dropped",
      reconnectAttempt: 1,
      reconnectDelayMillis: 500,
    },
  }),
  failures.map(
    (failure): Event => ({ kind: "rowsRevoked", ending: Cause.fail(failure) }),
  ),
  failures.map((failure): Event => ({ kind: "attemptFailed", failure })),
  failures.map((failure): Event => ({ kind: "parked", failure })),
)

const run = (
  history: ReadonlyArray<Event>,
): SupervisorState<Session, Failure> =>
  history.reduce(supervise, supervisorStart<Session, Failure>())

/** What a reader may be shown: the last session to go live, until revoked. */
const showable = (history: ReadonlyArray<Event>): Option.Option<Session> =>
  history.reduce(
    (
      shown: { readonly over: boolean; readonly row: Option.Option<Session> },
      event,
    ) => {
      if (shown.over) {
        return shown
      }
      switch (event.kind) {
        case "live":
          return { over: false, row: Option.some(event.session) }
        case "rowsRevoked":
          return { over: false, row: Option.none() }
        case "parked":
          return { over: true, row: shown.row }
        default:
          return shown
      }
    },
    { over: false, row: Option.none<Session>() },
  ).row

describe("a supervisor's state", () => {
  it("shows no sequence the rows of a revoked session", () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.array(events, { maxLength: 40 }),
        (history) => {
          expect(AsyncResult.value(run(history).session)).toEqual(
            showable(history),
          )
        },
      ),
      propertyParameters,
    )
  })

  it("is exactly a session, not waiting, whenever it says live", () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.array(events, { maxLength: 40 }),
        sessions,
        (history, id) => {
          const { phase, session } = supervise(
            run(history.filter((event) => event.kind !== "parked")),
            { kind: "live", session: { id } },
          )
          expect(phase.status).toBe("live")
          expect(AsyncResult.isSuccess(session) && !session.waiting).toBe(true)
          expect(AsyncResult.value(session)).toEqual(Option.some({ id }))
        },
      ),
      propertyParameters,
    )
  })

  it("stays parked whatever happens after", () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.array(events, { maxLength: 20 }),
        failures,
        FastCheck.array(events, { minLength: 1, maxLength: 20 }),
        (history, failure, after) => {
          const parked = run([...history, { kind: "parked", failure }])
          expect(after.reduce(supervise, parked)).toBe(parked)
        },
      ),
      propertyParameters,
    )
  })

  it("reports its first attempt as connecting and a retry with what failed", () => {
    const started = supervise(supervisorStart<Session, Failure>(), {
      kind: "attemptStarted",
    })
    expect(started.phase).toEqual({ status: "connecting", attempt: 1 })

    const failure = { code: 7 }
    const retried = [
      { kind: "attemptFailed", failure },
      { kind: "attemptStarted" },
    ] satisfies ReadonlyArray<Event>
    expect(
      retried.reduce<SupervisorState<Session, Failure>>(supervise, started)
        .phase,
    ).toEqual({
      status: "reconnecting",
      attempt: 2,
      failure,
    })
  })

  it("forgets the failure once a session goes live", () => {
    const failure = { code: 7 }
    const history = [
      { kind: "attemptStarted" },
      { kind: "attemptFailed", failure },
      { kind: "attemptStarted" },
      { kind: "live", session: { id: 1 } },
      { kind: "attemptStarted" },
    ] satisfies ReadonlyArray<Event>
    expect(run(history).phase).toEqual({ status: "connecting", attempt: 3 })
  })

  it("keeps showing the retained session while it recovers and is replaced", () => {
    const session = { id: 1 }
    const live = run([{ kind: "attemptStarted" }, { kind: "live", session }])
    const recovering = supervise(live, {
      kind: "recovering",
      recovery: {
        status: "recovering",
        reason: "dropped",
        reconnectAttempt: 2,
        reconnectDelayMillis: 500,
      },
    })
    expect(AsyncResult.value(recovering.session)).toEqual(Option.some(session))
    expect(recovering.session.waiting).toBe(true)
    expect(recovering.phase).toEqual({
      status: "recovering",
      attempt: 1,
      reconnectAttempt: 2,
      reconnectDelayMillis: 500,
      reason: "dropped",
    })

    const replacing = supervise(recovering, {
      kind: "attemptFailed",
      failure: { code: 7 },
    })
    expect(AsyncResult.value(replacing.session)).toEqual(Option.some(session))
    expect(replacing.session.waiting).toBe(true)
  })

  it("ignores a recovery reported after the session ended", () => {
    const ended = run([
      { kind: "attemptStarted" },
      { kind: "live", session: { id: 1 } },
      { kind: "attemptFailed", failure: { code: 7 } },
    ])
    expect(
      supervise(ended, {
        kind: "recovering",
        recovery: {
          status: "recovering",
          reason: "dropped",
          reconnectAttempt: 1,
          reconnectDelayMillis: 500,
        },
      }),
    ).toBe(ended)
  })

  it("leaves a revocation with nothing on show alone", () => {
    const cold = supervise(supervisorStart<Session, Failure>(), {
      kind: "attemptStarted",
    })
    expect(
      supervise(cold, { kind: "rowsRevoked", ending: Cause.fail({ code: 7 }) }),
    ).toBe(cold)
  })
})
