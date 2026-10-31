import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/reactivity/AsyncResult"
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
} from "./connection-state.ts"
import { GeneratedArtifactShapeError } from "./generated-artifact-shape.ts"
import {
  type GeneratedConnectionClassLike,
  type GeneratedErrorContextOf,
  type MismatchedGeneratedModuleDiagnostic,
  WsUnsupportedBuilderFeatureError,
} from "./generated-ws-adapter.ts"
import {
  GeneratedArtifactValidation,
  generated,
  type InternalWsBuilderConfig,
  makeScopedFromModulePlan,
  type WsBuilderConfig,
  type WsGeneratedConfig,
} from "./ws-resource.ts"
import type { SubscriptionFailure } from "./ws-subscription.ts"
import {
  WsConnectError,
  WsConnectTimeoutError,
} from "./ws-resource-lifecycle.ts"
import type { WsSession } from "./ws-session-tag.ts"
import {
  followRecoveringSession,
  type RecoveringConnection,
} from "./ws-supervised-recovery.ts"

export const reconnectDelayMillisFirstDefault = 250
export const reconnectDelayMillisMaxDefault = 30_000

/**
 * Page events after which a browser may have torn a socket down without
 * delivering `onclose`: the page became visible again, regained focus, came
 * back online, or was restored from the back-forward cache. The SDK's own
 * connection manager re-checks its sockets on the same events.
 */
const pageResumeEventTypes = [
  "visibilitychange",
  "focus",
  "online",
  "pageshow",
] as const

/**
 * Re-checks a live session's socket whenever the page resumes, for as long as
 * the enclosing scope lives. Reading the session's liveness invalidates a
 * socket that closed without its close event, so the supervisor reconnects
 * at once instead of publishing a dead session as live until the next call.
 * Outside a page (Bun, Node) none of these events fires.
 */
const recheckOnPageResume = (
  check: () => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.suspend(() => {
      if (typeof globalThis.addEventListener !== "function") {
        return Effect.succeed(false)
      }
      for (const type of pageResumeEventTypes) {
        globalThis.addEventListener(type, check)
      }
      return Effect.succeed(true)
    }),
    (registered) =>
      Effect.suspend(() => {
        if (registered) {
          for (const type of pageResumeEventTypes) {
            globalThis.removeEventListener(type, check)
          }
        }
        return Effect.void
      }),
  ).pipe(Effect.asVoid)

const WsSessionSupervisorDefectErrorTypeId = errorTypeId(
  "WsSessionSupervisorDefectError",
)
export class WsSessionSupervisorDefectError extends Data.TaggedError(
  "WsSessionSupervisorDefectError",
)<{
  readonly cause: Cause.Cause<unknown>
}> {
  readonly [WsSessionSupervisorDefectErrorTypeId] =
    WsSessionSupervisorDefectErrorTypeId
  static is = hasErrorTypeId<WsSessionSupervisorDefectError>(
    WsSessionSupervisorDefectErrorTypeId,
  )
}

export type WsSessionSupervisorPolicy<Failure> = {
  readonly reconnectDelayMillisFirst?: number | undefined
  readonly reconnectDelayMillisMax?: number | undefined
  readonly reconnectJitter?: boolean | undefined
  readonly isRetryable?: ((failure: Failure) => boolean) | undefined
}

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
  | WsSessionSupervisorDefectError
  | WsConnectError
  | ValidationError
  | SubscriptionFailure
  | SetupError

type SessionSetup<
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
> = WsSessionSupervisorPolicy<
  ConnectionLostError | AcquireError | SubscriptionFailure | SetupError
> & {
  readonly acquire: Effect.Effect<
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

const reconnectSchedule = (options: {
  readonly reconnectDelayMillisFirst: number
  readonly reconnectDelayMillisMax: number
  readonly reconnectJitter: boolean
}) => {
  const exponential = Schedule.exponential(
    Duration.millis(options.reconnectDelayMillisFirst),
  )
  const withJitter = options.reconnectJitter
    ? exponential.pipe(Schedule.jittered)
    : exponential
  return withJitter.pipe(
    Schedule.modifyDelay(({ duration }) =>
      Effect.succeed(
        Duration.min(
          duration,
          Duration.millis(options.reconnectDelayMillisMax),
        ),
      ),
    ),
  )
}

const publishRetryingSession = <Session, Failure>(
  ref: SubscriptionRef.SubscriptionRef<
    AsyncResult.AsyncResult<Session, Failure>
  >,
  failure: Failure,
) =>
  SubscriptionRef.update(ref, (current) =>
    AsyncResult.isSuccess(current)
      ? AsyncResult.waiting(current)
      : AsyncResult.failWithPrevious(failure, {
          previous: Option.some(current),
          waiting: true,
        }),
  )

const recoveringPhase = (attempt: number, recovery: RecoveringConnection) =>
  ({
    status: "recovering",
    attempt,
    reconnectAttempt: recovery.reconnectAttempt,
    reconnectDelayMillis: recovery.reconnectDelayMillis,
    reason: recovery.reason,
  }) as const

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
    | WsSessionSupervisorDefectError
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
    type Failure = AttemptFailure | WsSessionSupervisorDefectError
    type Session = WsSession<Module, ErrorContext, RelationContext>

    const session = yield* SubscriptionRef.make<
      AsyncResult.AsyncResult<Session, Failure>
    >(AsyncResult.initial<Session, Failure>(true))
    const phase = yield* SubscriptionRef.make<
      WsSessionSupervisorPhase<Failure>
    >({ status: "connecting", attempt: 1 })
    const attemptRef = yield* Ref.make(0)
    const failureLastRef = yield* Ref.make<AttemptFailure | undefined>(
      undefined,
    )
    const failureAfterLiveRef = yield* Ref.make<Option.Option<AttemptFailure>>(
      Option.none(),
    )
    const subscriptionTargets = [...(options.subscriptionTargets ?? [])]
    const reconnectDelayMillisFirst = Math.max(
      1,
      options.reconnectDelayMillisFirst ?? reconnectDelayMillisFirstDefault,
    )
    const reconnectDelayMillisMax = Math.max(
      reconnectDelayMillisFirst,
      options.reconnectDelayMillisMax ?? reconnectDelayMillisMaxDefault,
    )
    const schedule = reconnectSchedule({
      reconnectDelayMillisFirst,
      reconnectDelayMillisMax,
      reconnectJitter: options.reconnectJitter ?? true,
    })
    const isRetryable = options.isRetryable ?? (() => true)

    const publishFailure = Effect.fn(function* (failure: AttemptFailure) {
      const attempt = yield* Ref.get(attemptRef)
      yield* Ref.set(failureLastRef, failure)
      yield* publishRetryingSession(session, failure)
      yield* SubscriptionRef.set(phase, {
        status: "reconnecting",
        attempt,
        failure,
      })
    })

    const publishLive = Effect.fn(function* (
      current: Session,
      attempt: number,
    ) {
      yield* Ref.set(failureLastRef, undefined)
      yield* SubscriptionRef.set(session, AsyncResult.success(current))
      yield* SubscriptionRef.set(phase, { status: "live", attempt })
    })

    // The session stays published (as waiting, like a supervisor reconnect
    // retains its previous session) while the SDK recovers its connection.
    const publishRecovering = Effect.fn(function* (
      current: Session,
      attempt: number,
      recovery: RecoveringConnection,
    ) {
      yield* SubscriptionRef.set(
        session,
        AsyncResult.waiting(AsyncResult.success(current)),
      )
      yield* SubscriptionRef.set(phase, recoveringPhase(attempt, recovery))
    })

    // How a session's terminal invalidation ends its attempt. A token
    // refresh that died is a defect, like one during acquisition: the
    // supervisor parks fatal rather than retry it.
    const endedBy = (
      invalidation: ConnectionInvalidation,
    ): Effect.Effect<never, AttemptFailure> => {
      switch (invalidation.kind) {
        case "identityChanged":
          return Effect.fail(
            options.connectFailure(
              new ConnectionIdentityChangedError({ raw: invalidation.message }),
            ),
          )
        case "credentialsFailed":
          return Effect.fail(options.connectFailure(invalidation.cause))
        case "credentialsDefect":
          return Effect.die(invalidation.defect)
        case "lost":
          return Effect.fail(
            new ConnectionLostError({ raw: invalidation.message }),
          )
      }
    }

    const runAttempt = Effect.gen(function* () {
      const attempt = yield* Ref.getAndUpdate(
        attemptRef,
        (current) => current + 1,
      ).pipe(Effect.map((current) => current + 1))
      const failureLast = yield* Ref.get(failureLastRef)
      yield* SubscriptionRef.set(
        phase,
        failureLast === undefined
          ? { status: "connecting", attempt }
          : { status: "reconnecting", attempt, failure: failureLast },
      )

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
        targetFailure === undefined
          ? endedBy(invalidation)
          : Effect.fail(targetFailure)
      const failOnInvalidationOf = (current: Session) =>
        current.awaitInvalidation().pipe(Effect.flatMap(endedFailure))

      const attemptScope = yield* Scope.make()
      return yield* Effect.gen(function* () {
        const current = yield* Effect.gen(function* () {
          const acquired = yield* options.acquire
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
            yield* publishLive(acquired, attempt)
          }).pipe(Effect.raceFirst(failOnInvalidation))
          return acquired
        }).pipe(
          Effect.timeoutOrElse({
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
            publishLive: publishLive(current, attempt),
            publishRecovering: (recovery) =>
              publishRecovering(current, attempt, recovery),
          })
        }
        yield* recheckOnPageResume(() => {
          current.isInvalidated()
        })
        const invalidation = yield* current.awaitInvalidation()
        return yield* Effect.flip(endedFailure(invalidation))
      }).pipe(
        Effect.provideService(Scope.Scope, attemptScope),
        Effect.onExit((exit) => Scope.close(attemptScope, exit)),
      )
    }).pipe(Effect.tap(publishFailure), Effect.tapError(publishFailure))

    const runRetryEpoch = Ref.getAndSet(
      failureAfterLiveRef,
      Option.none(),
    ).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => runAttempt,
          onSome: (failure) => Effect.fail(failure),
        }),
      ),
      Effect.retry({ schedule, while: isRetryable }),
      Effect.tap((failure) =>
        Ref.set(failureAfterLiveRef, Option.some(failure)),
      ),
    )

    const publishFatal = Effect.fn(function* (failure: Failure) {
      const attempt = yield* Ref.get(attemptRef)
      const previous = yield* SubscriptionRef.get(session)
      yield* SubscriptionRef.set(
        session,
        AsyncResult.failWithPrevious(failure, {
          previous: Option.some(previous),
        }),
      )
      yield* SubscriptionRef.set(phase, {
        status: "fatal",
        attempt,
        failure,
      })
      return yield* Effect.never
    })

    const run = runRetryEpoch.pipe(
      Effect.forever,
      Effect.catch(publishFatal),
      Effect.catchCause((cause) =>
        Cause.hasDies(cause)
          ? publishFatal(new WsSessionSupervisorDefectError({ cause }))
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
    WsConnectError.is(failure) &&
    (WsUnsupportedBuilderFeatureError.is(failure.cause) ||
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
  return makeWithAcquire<
    Module,
    ErrorContext,
    RelationContext,
    WsConnectError,
    SetupError,
    SetupR
  >({
    acquire: makeScopedFromModulePlan<Module, ErrorContext, RelationContext>({
      plan: options.plan,
      config: options.config,
      recoveryEnabledByOwner: true,
    }),
    activationTimeoutFailure: () =>
      new WsConnectError({
        cause: new WsConnectTimeoutError({
          timeoutMillis: options.config.connectTimeoutMillis,
        }),
      }),
    activationTimeoutMillis: options.config.connectTimeoutMillis,
    connectFailure: connectFailureOf,
    automaticReconnect,
    subscriptionTargets: options.subscriptionTargets,
    setup: options.setup,
    onAutomaticReconnect: options.onAutomaticReconnect,
    ...options.policy,
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
  const config: InternalWsBuilderConfig<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    GeneratedArtifactShapeError
  > = {
    ...generated(options.config),
    [GeneratedArtifactValidation]: true,
  }
  return makeWithAcquire<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    WsConnectError | GeneratedArtifactShapeError,
    SetupError,
    SetupR
  >({
    acquire: makeScopedFromModulePlan<
      Module,
      GeneratedErrorContextOf<ConnectionClass>,
      RelationContext,
      GeneratedArtifactShapeError
    >({
      plan: makeModulePlan(options.module),
      config,
      recoveryEnabledByOwner: true,
    }),
    activationTimeoutFailure: () =>
      new WsConnectError({
        cause: new WsConnectTimeoutError({
          timeoutMillis: options.config.connectTimeoutMillis,
        }),
      }),
    activationTimeoutMillis: options.config.connectTimeoutMillis,
    connectFailure: connectFailureOf,
    automaticReconnect,
    subscriptionTargets: options.subscriptionTargets,
    setup: options.setup,
    onAutomaticReconnect: options.onAutomaticReconnect,
    ...options.policy,
    isRetryable: options.policy?.isRetryable ?? wsSupervisorIsRetryableDefault,
  })
}
