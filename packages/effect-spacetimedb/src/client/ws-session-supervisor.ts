import { withDeadline } from "./call-duration.ts"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as AsyncResult from "effect/reactivity/AsyncResult"
import type { AnyModuleSpec } from "../contract/module.ts"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"
import type { ModulePlan } from "../module-plan.ts"
import { makeModulePlan } from "../module-plan.ts"
import type { SubscriptionTarget } from "../subscription-target.ts"
import {
  ConnectionIdentityChangedError,
  ConnectionLostError,
} from "./call-errors.ts"
import {
  type ConnectionInvalidation,
  connectionStateFor,
  type RevokingInvalidation,
} from "./connection-state.ts"
import { GeneratedArtifactShapeError } from "./generated-artifact-shape.ts"
import {
  type GeneratedConnectionClassLike,
  type GeneratedErrorContextOf,
  type MismatchedGeneratedModuleDiagnostic,
  WsUnsupportedBuilderFeatureError,
} from "./generated-ws-adapter.ts"
import type { TokenUnavailable } from "./ws-attempt-credentials.ts"
import {
  GeneratedArtifactValidation,
  generated,
  type InternalWsBuilderConfig,
  makeScopedFromModulePlan,
  type WsBuilderConfig,
  type WsGeneratedConfig,
} from "./ws-resource.ts"
import {
  invalidationRevokesRows,
  SubscriptionInvalidatedError,
  type SubscriptionFailure,
} from "./ws-subscription.ts"
import {
  wsTimeBounds,
  WsConnectError,
  WsConnectTimeoutError,
  WsProtocolError,
} from "./ws-resource-lifecycle.ts"
import { recheckOnPageResume } from "./ws-page-resume.ts"
import type { WsSession } from "./ws-session-tag.ts"
import {
  followRecoveringSession,
  type RecoveringConnection,
} from "./ws-supervised-recovery.ts"
import { makeSupervisedRows } from "./ws-supervised-rows.ts"
import {
  backoffBounds,
  makeSupervisorBackoff,
  type WsSessionBackoffPolicy,
} from "./ws-supervisor-backoff.ts"
import {
  type SupervisorEvent,
  supervise,
  supervisorStart,
  type WsSessionSupervisorPhase,
} from "./ws-supervisor-state.ts"

export {
  reconnectDelayFirstDefault,
  reconnectDelayMaxDefault,
  stabilityWindowDefault,
} from "./ws-supervisor-backoff.ts"
export type { WsSessionSupervisorPhase } from "./ws-supervisor-state.ts"

const anotherIdentityMessage =
  "The session's replacement connected under a different identity"

const WsSessionSupervisorFatalErrorTypeId = errorTypeId(
  "WsSessionSupervisorFatalError",
)
export class WsSessionSupervisorFatalError extends Data.TaggedError(
  "WsSessionSupervisorFatalError",
)<{
  readonly cause: Cause.Cause<unknown>
}> {
  readonly [WsSessionSupervisorFatalErrorTypeId] =
    WsSessionSupervisorFatalErrorTypeId
  static is = hasErrorTypeId<WsSessionSupervisorFatalError>(
    WsSessionSupervisorFatalErrorTypeId,
  )
}

export type WsSessionSupervisorPolicy<Failure> = WsSessionBackoffPolicy & {
  readonly isRetryable?: ((failure: Failure) => boolean) | undefined
}

export type WsSessionSupervisorHandle<Session, Failure> = {
  readonly session: SubscriptionRef.SubscriptionRef<
    AsyncResult.AsyncResult<Session, Failure>
  >
  readonly phase: SubscriptionRef.SubscriptionRef<
    WsSessionSupervisorPhase<Failure>
  >
}

export type WsSessionSupervisor<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  Failure,
> = WsSessionSupervisorHandle<
  WsSession<Module, ErrorContext, RelationContext>,
  Failure
>

export type WsSessionSupervisorFailure<ValidationError, SetupError> =
  | ConnectionLostError
  | WsSessionSupervisorFatalError
  | WsConnectError
  | ValidationError
  | SubscriptionFailure
  | SetupError

export type SessionSetup<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  SetupError,
  SetupR,
> = (
  session: WsSession<Module, ErrorContext, RelationContext>,
) => Effect.Effect<void, SetupError, SetupR | Scope.Scope>

type SupervisorOptions<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  AcquireError,
  SetupError,
  SetupR,
> = {
  readonly backoff: ReturnType<typeof backoffBounds>
  readonly isRetryable: (
    failure:
      | ConnectionLostError
      | AcquireError
      | SubscriptionFailure
      | SetupError,
  ) => boolean
  readonly acquire: (
    onTokenUnavailable: TokenUnavailable,
  ) => Effect.Effect<
    WsSession<Module, ErrorContext, RelationContext>,
    AcquireError,
    Scope.Scope
  >
  readonly activationTimeoutFailure: () => AcquireError
  readonly activationTimeoutMillis: number
  /**
   * How a session ended by its connection failing to reconnect is reported:
   * the identity changed, or the token Effect failed while refreshing.
   */
  readonly connectFailure: (cause: unknown) => AcquireError
  /** Whether acquired sessions reconnect on their own (automatic reconnect). */
  readonly automaticReconnect: boolean
  readonly subscriptionTargets?:
    | ReadonlyArray<SubscriptionTarget<Module>>
    | undefined
  readonly setup?:
    | SessionSetup<Module, ErrorContext, RelationContext, SetupError, SetupR>
    | undefined
  readonly onAutomaticReconnect?:
    | SessionSetup<Module, ErrorContext, RelationContext, SetupError, SetupR>
    | undefined
}

/**
 * Throws a `TypeError` when a reconnect hook is configured for a connection
 * that never reconnects on its own, where it could never run.
 */
const assertReconnectHookReachable = (
  hook: unknown,
  automaticReconnect: boolean,
): void => {
  if (hook !== undefined && !automaticReconnect) {
    throw new TypeError(
      "WebSocket session supervisor onAutomaticReconnect requires config.automaticReconnect",
    )
  }
}

const makeWithAcquire = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  AcquireError,
  SetupError = never,
  SetupR = never,
>(
  options: SupervisorOptions<
    Module,
    ErrorContext,
    RelationContext,
    AcquireError,
    SetupError,
    SetupR
  >,
): Effect.Effect<
  WsSessionSupervisor<
    Module,
    ErrorContext,
    RelationContext,
    | ConnectionLostError
    | WsSessionSupervisorFatalError
    | AcquireError
    | SubscriptionFailure
    | SetupError
  >,
  never,
  SetupR | Scope.Scope
> =>
  Effect.gen(function* () {
    type AttemptFailure =
      | ConnectionLostError
      | AcquireError
      | SubscriptionFailure
      | SetupError
    type Failure = AttemptFailure | WsSessionSupervisorFatalError
    type Session = WsSession<Module, ErrorContext, RelationContext>

    const start = supervisorStart<Session, Failure>()
    const session = yield* SubscriptionRef.make(start.session)
    const phase = yield* SubscriptionRef.make(start.phase)
    const stateRef = yield* Ref.make(start)
    const rows = makeSupervisedRows()
    const subscriptionTargets = [...(options.subscriptionTargets ?? [])]
    const backoff = yield* makeSupervisorBackoff(options.backoff)
    const isRetryable = options.isRetryable ?? (() => true)

    // Publishing happens one event at a time and always finishes, so the refs
    // cannot end up behind the state, and an event that waited its turn is judged
    // when its turn comes. Token refreshes get here on fibers of their own.
    const publishing = yield* Semaphore.make(1)
    const inOrder = <E, R>(step: Effect.Effect<void, E, R>) =>
      publishing.withPermit(step).pipe(Effect.uninterruptible)

    // Both refs are views of the state, so nothing else writes them. The session
    // goes first, so a reader that sees `live` finds the session there.
    const apply = Effect.fn(function* (
      event: SupervisorEvent<Session, Failure>,
    ) {
      const before = yield* Ref.get(stateRef)
      const after = supervise(before, event)
      yield* Ref.set(stateRef, after)
      if (after.session !== before.session) {
        yield* SubscriptionRef.set(session, after.session)
      }
      if (after.phase !== before.phase) {
        yield* SubscriptionRef.set(phase, after.phase)
      }
    })

    const publish = (event: SupervisorEvent<Session, Failure>) =>
      inOrder(apply(event))

    // Whatever else ended an attempt, its connection outlived the end: watching
    // for a revocation stops when another failure wins, and the connection stays
    // up until its scope has closed. An attempt only fails after that close, so
    // the answer here is final, and a revocation nobody heard still takes the rows.
    const applyUnheardRevocation = (failure: Failure) =>
      Effect.suspend(() =>
        rows.isRevoked()
          ? apply({ kind: "rowsRevoked", ending: Cause.fail(failure) })
          : Effect.void,
      )

    const publishFailure = (failure: AttemptFailure) =>
      inOrder(
        backoff.liveEnded.pipe(
          Effect.andThen(applyUnheardRevocation(failure)),
          Effect.andThen(apply({ kind: "attemptFailed", failure })),
        ),
      )

    // Whether the session is still fit to show is asked here, in turn. Asked any
    // earlier, a revocation could land after the answer and be undone by this.
    const publishLive = (current: Session, isCurrent: () => boolean) =>
      inOrder(
        Effect.suspend(() =>
          isCurrent()
            ? backoff.liveBegan.pipe(
                Effect.andThen(apply({ kind: "live", session: current })),
              )
            : Effect.void,
        ),
      )

    const publishRecovering = (recovery: RecoveringConnection) =>
      inOrder(
        backoff.liveEnded.pipe(
          Effect.andThen(apply({ kind: "recovering", recovery })),
        ),
      )

    // How a session's terminal invalidation ends its attempt. A token
    // refresh that died is a defect, like one during acquisition: the
    // supervisor parks fatal rather than retry it.
    const endedBy = (
      invalidation: ConnectionInvalidation,
    ): Cause.Cause<AttemptFailure> => {
      switch (invalidation.kind) {
        case "identityChanged":
          return Cause.fail(
            options.connectFailure(
              new ConnectionIdentityChangedError({ raw: invalidation.message }),
            ),
          )
        case "protocolError":
        case "credentialsFailed":
          return Cause.fail(options.connectFailure(invalidation.cause))
        case "credentialsDefect":
          return Cause.die(invalidation.defect)
        case "lost":
          return Cause.fail(
            new ConnectionLostError({ raw: invalidation.message }),
          )
      }
    }

    const failSession = (
      invalidation: ConnectionInvalidation,
      ending: Cause.Cause<AttemptFailure>,
    ): Effect.Effect<never, AttemptFailure> =>
      invalidationRevokesRows(invalidation.kind)
        ? publish({ kind: "rowsRevoked", ending }).pipe(
            Effect.andThen(Effect.failCause(ending)),
          )
        : Effect.failCause(ending)

    // What vouched for a retained session, which only lost its socket, is gone: a
    // token a replacement could not get, or a replacement that is someone else. A
    // signed-out user and a passing failure of the token source look the same
    // from here, so the rows go, from every session a reader may still hold them
    // from. Those connections have already ended, so their refs need telling.
    const revokeRows = Effect.fn(function* (
      invalidation: RevokingInvalidation,
      ending: Cause.Cause<AttemptFailure>,
    ) {
      rows.revoke(invalidation)
      yield* publish({ kind: "rowsRevoked", ending })
    })
    const acquire = options.acquire((invalidation) =>
      revokeRows(invalidation, endedBy(invalidation)),
    )

    // Only the identity decides whether a replacement inherits what came before.
    // A different one is no failure of the replacement, which starts clean: a
    // client with no token gets a new identity on every connection. So the session
    // signal reports what happened to the old session, a lost connection, and
    // `ConnectionIdentityChangedError` keeps meaning a supervisor that parked.
    const adoptSession = Effect.fn(function* (acquired: Session) {
      if (rows.belongToAnother(acquired.identity)) {
        yield* revokeRows(
          { kind: "identityChanged", message: anotherIdentityMessage },
          Cause.fail(new ConnectionLostError({ raw: anotherIdentityMessage })),
        )
      }
      rows.adopt(acquired.identity, connectionStateFor(acquired.connection))
    })

    const runAttempt = Effect.gen(function* () {
      yield* publish({ kind: "attemptStarted" })

      // A subscription target the server ends after it applied (an automatic
      // reconnect's replay refused it) ends the session: it would otherwise
      // stay live without the data its consumers rely on.
      let targetFailure: SubscriptionFailure | undefined
      const subscribeTarget =
        (current: Session) => (target: SubscriptionTarget<Module>) =>
          current.subscribe(target, (failure) => {
            targetFailure ??= failure
            connectionStateFor(current.connection).invalidateFromTransport(
              "A subscription target failed after it applied",
            )
          })
      const endedFailure = (invalidation: ConnectionInvalidation) =>
        failSession(
          invalidation,
          targetFailure === undefined
            ? endedBy(invalidation)
            : Cause.fail(targetFailure),
        )
      const failOnInvalidationOf = (current: Session) =>
        current.awaitInvalidation().pipe(Effect.flatMap(endedFailure))

      const attemptScope = yield* Scope.make()
      return yield* Effect.gen(function* () {
        const current = yield* Effect.gen(function* () {
          const acquired = yield* acquire
          // The attempt's bound must not fall between revoking and withdrawing.
          yield* adoptSession(acquired).pipe(Effect.uninterruptible)
          yield* Effect.forEach(
            subscriptionTargets,
            subscribeTarget(acquired),
            {
              discard: true,
            },
          )
          const failOnInvalidation = failOnInvalidationOf(acquired)
          yield* Effect.gen(function* () {
            if (options.setup !== undefined) {
              yield* options.setup(acquired)
            }
            // Checked before recovery is enabled, which would turn a socket
            // found closed into recovery: a drop before the session is live
            // ends a session nobody used, and the attempt fails.
            if (acquired.isInvalidated()) {
              return yield* failOnInvalidation
            }
            // Recovery starts once the session is live.
            if (options.automaticReconnect) {
              connectionStateFor(acquired.connection).enableRecovery()
            }
            yield* publishLive(acquired, () => !acquired.isInvalidated())
          }).pipe(Effect.raceFirst(failOnInvalidation))
          return acquired
        }).pipe(
          withDeadline({
            duration: Duration.millis(options.activationTimeoutMillis),
            orElse: () => Effect.fail(options.activationTimeoutFailure()),
          }),
        )
        if (options.automaticReconnect) {
          // The SDK watches page resumes itself and reconnects a socket that
          // closed silently, so no resume check here.
          const reconnectHook = options.onAutomaticReconnect
          return yield* followRecoveringSession({
            connectionState: connectionStateFor(current.connection),
            reconnectHook:
              reconnectHook === undefined
                ? undefined
                : () => reconnectHook(current),
            hookTimeoutMillis: options.activationTimeoutMillis,
            hookTimeoutFailure: options.activationTimeoutFailure,
            ended: failOnInvalidationOf(current),
            publishLive: (isCurrent) => publishLive(current, isCurrent),
            publishRecovering,
          })
        }
        yield* recheckOnPageResume(() => {
          current.isInvalidated()
        })
        return yield* current
          .awaitInvalidation()
          .pipe(Effect.flatMap(endedFailure))
      }).pipe(
        Effect.provideService(Scope.Scope, attemptScope),
        Effect.onExit((exit) => Scope.close(attemptScope, exit)),
      )
    }).pipe(Effect.tapError(publishFailure))

    const publishFatal = (failure: Failure) =>
      inOrder(
        applyUnheardRevocation(failure).pipe(
          Effect.andThen(apply({ kind: "parked", failure })),
        ),
      ).pipe(Effect.andThen(Effect.never))

    // An attempt only ever ends in failure, a live session's end included, so
    // one retry spans the supervisor's life and its schedule every session.
    const run = runAttempt.pipe(
      Effect.retry({ schedule: backoff.schedule, while: isRetryable }),
      Effect.catch(publishFatal),
      Effect.catchCause((cause) =>
        Cause.hasDies(cause)
          ? publishFatal(new WsSessionSupervisorFatalError({ cause }))
          : Effect.failCause(cause),
      ),
    )

    yield* run.pipe(Effect.forkScoped)
    return { session, phase }
  })

/**
 * The default retry policy. Deterministic failures park the supervisor: a
 * generated artifact that does not match the contract, a builder that lacks
 * a configured capability, and an automatic reconnect that came back as a
 * different identity (retrying would serve another identity's data). A
 * policy that parks on failures of its own extends it: `isRetryable:
 * (failure) => !mine(failure) && wsSupervisorIsRetryableDefault(failure)`.
 */
export const wsSupervisorIsRetryableDefault = (failure: unknown): boolean =>
  !GeneratedArtifactShapeError.is(failure) &&
  !(
    SubscriptionInvalidatedError.is(failure) && failure.kind === "protocolError"
  ) &&
  !(
    WsConnectError.is(failure) &&
    (WsProtocolError.is(failure.cause) ||
      WsUnsupportedBuilderFeatureError.is(failure.cause) ||
      ConnectionIdentityChangedError.is(failure.cause))
  )

const connectFailureOf = (cause: unknown) => new WsConnectError({ cause })

export const makeSupervisorFromModulePlan = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
  SetupError = never,
  SetupR = never,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: WsBuilderConfig<Module, ErrorContext, RelationContext>
  readonly subscriptionTargets?:
    | ReadonlyArray<SubscriptionTarget<Module>>
    | undefined
  readonly setup?:
    | SessionSetup<Module, ErrorContext, RelationContext, SetupError, SetupR>
    | undefined
  /**
   * Runs after every automatic reconnect of the live session (requires
   * `config.automaticReconnect`), before the session is published live again:
   * the place to redo per-connection server state the drop discarded, such as
   * presence. Its scope lasts until the next drop or the end of the session.
   * It is bounded like an activation; its failure ends the session, which
   * the supervisor then replaces. It may run although `setup` already ran on
   * the reconnected socket, so keep it idempotent.
   */
  readonly onAutomaticReconnect?:
    | SessionSetup<Module, ErrorContext, RelationContext, SetupError, SetupR>
    | undefined
  readonly policy?:
    | WsSessionSupervisorPolicy<WsSessionSupervisorFailure<never, SetupError>>
    | undefined
}) => {
  const automaticReconnect = options.config.automaticReconnect !== undefined
  assertReconnectHookReachable(options.onAutomaticReconnect, automaticReconnect)
  const backoff = backoffBounds(options.policy)
  const timeBounds = wsTimeBounds(options.config)
  return makeWithAcquire<
    Module,
    ErrorContext,
    RelationContext,
    WsConnectError,
    SetupError,
    SetupR
  >({
    acquire: (onTokenUnavailable) =>
      makeScopedFromModulePlan<Module, ErrorContext, RelationContext>({
        plan: options.plan,
        config: options.config,
        timeBounds,
        recoveryEnabledByOwner: true,
        onTokenUnavailable,
      }),
    activationTimeoutFailure: () =>
      new WsConnectError({
        cause: new WsConnectTimeoutError({
          timeoutMillis: timeBounds.connectMillis,
        }),
      }),
    activationTimeoutMillis: timeBounds.connectMillis,
    connectFailure: connectFailureOf,
    automaticReconnect,
    subscriptionTargets: options.subscriptionTargets,
    setup: options.setup,
    onAutomaticReconnect: options.onAutomaticReconnect,
    backoff,
    isRetryable: options.policy?.isRetryable ?? wsSupervisorIsRetryableDefault,
  })
}

export const makeSupervisor = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
  SetupError = never,
  SetupR = never,
>(options: {
  readonly module: Module
  readonly config: WsBuilderConfig<Module, ErrorContext, RelationContext>
  readonly subscriptionTargets?:
    | ReadonlyArray<SubscriptionTarget<Module>>
    | undefined
  readonly setup?:
    | SessionSetup<Module, ErrorContext, RelationContext, SetupError, SetupR>
    | undefined
  /** See `makeSupervisorFromModulePlan`. */
  readonly onAutomaticReconnect?:
    | SessionSetup<Module, ErrorContext, RelationContext, SetupError, SetupR>
    | undefined
  readonly policy?:
    | WsSessionSupervisorPolicy<WsSessionSupervisorFailure<never, SetupError>>
    | undefined
}) =>
  makeSupervisorFromModulePlan<
    Module,
    ErrorContext,
    RelationContext,
    SetupError,
    SetupR
  >({
    ...options,
    plan: makeModulePlan(options.module),
  })

export const makeSupervisorGenerated = <
  Module extends AnyModuleSpec,
  ConnectionClass extends GeneratedConnectionClassLike,
  RelationContext = unknown,
  SetupError = never,
  SetupR = never,
>(options: {
  readonly module: Module
  readonly config: WsGeneratedConfig<Module, ConnectionClass, RelationContext> &
    MismatchedGeneratedModuleDiagnostic<Module, ConnectionClass>
  readonly subscriptionTargets?:
    | ReadonlyArray<SubscriptionTarget<Module>>
    | undefined
  readonly setup?:
    | SessionSetup<
        Module,
        GeneratedErrorContextOf<ConnectionClass>,
        RelationContext,
        SetupError,
        SetupR
      >
    | undefined
  /** See `makeSupervisorFromModulePlan`. */
  readonly onAutomaticReconnect?:
    | SessionSetup<
        Module,
        GeneratedErrorContextOf<ConnectionClass>,
        RelationContext,
        SetupError,
        SetupR
      >
    | undefined
  readonly policy?:
    | WsSessionSupervisorPolicy<
        WsSessionSupervisorFailure<GeneratedArtifactShapeError, SetupError>
      >
    | undefined
}) => {
  const automaticReconnect = options.config.automaticReconnect !== undefined
  assertReconnectHookReachable(options.onAutomaticReconnect, automaticReconnect)
  const backoff = backoffBounds(options.policy)
  const timeBounds = wsTimeBounds(options.config)
  const config: InternalWsBuilderConfig<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    GeneratedArtifactShapeError
  > = {
    ...generated(options.config),
    [GeneratedArtifactValidation]: true,
  }
  const plan = makeModulePlan(options.module)
  return makeWithAcquire<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    WsConnectError | GeneratedArtifactShapeError,
    SetupError,
    SetupR
  >({
    acquire: (onTokenUnavailable) =>
      makeScopedFromModulePlan<
        Module,
        GeneratedErrorContextOf<ConnectionClass>,
        RelationContext,
        GeneratedArtifactShapeError
      >({
        plan,
        config,
        timeBounds,
        recoveryEnabledByOwner: true,
        onTokenUnavailable,
      }),
    activationTimeoutFailure: () =>
      new WsConnectError({
        cause: new WsConnectTimeoutError({
          timeoutMillis: timeBounds.connectMillis,
        }),
      }),
    activationTimeoutMillis: timeBounds.connectMillis,
    connectFailure: connectFailureOf,
    automaticReconnect,
    subscriptionTargets: options.subscriptionTargets,
    setup: options.setup,
    onAutomaticReconnect: options.onAutomaticReconnect,
    backoff,
    isRetryable: options.policy?.isRetryable ?? wsSupervisorIsRetryableDefault,
  })
}
