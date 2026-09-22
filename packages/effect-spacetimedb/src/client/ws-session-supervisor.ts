import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type { AnyModuleSpec } from "../contract/module.ts"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"
import type { ModulePlan } from "../module-plan.ts"
import { makeModulePlan } from "../module-plan.ts"
import type { SubscriptionTarget } from "../subscription-target.ts"
import { ConnectionLostError } from "./call-errors.ts"
import { connectAndSubscribe } from "./connect-and-subscribe.ts"
import { GeneratedArtifactShapeError } from "./generated-artifact-shape.ts"
import {
  type GeneratedConnectionClassLike,
  type GeneratedErrorContextOf,
  type MismatchedGeneratedModuleDiagnostic,
  WsUnsupportedBuilderFeatureError,
} from "./generated-ws-adapter.ts"
import {
  makeScopedFromModulePlan,
  makeScopedGenerated,
  type WsBuilderConfig,
  type WsGeneratedConfig,
  type WsSession,
} from "./ws-resource.ts"
import type { SubscriptionFailure } from "./ws-subscription.ts"
import {
  WsConnectError,
  WsConnectTimeoutError,
} from "./ws-resource-lifecycle.ts"

export const reconnectDelayMillisFirstDefault = 250
export const reconnectDelayMillisMaxDefault = 30_000

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

type RequiredConnectTimeout<Config> = Config & {
  readonly connectTimeoutMillis: number
}

export type WsSessionSupervisorPolicy<Failure> = {
  readonly reconnectDelayMillisFirst?: number | undefined
  readonly reconnectDelayMillisMax?: number | undefined
  readonly reconnectJitter?: boolean | undefined
  readonly isRetryable?: ((failure: Failure) => boolean) | undefined
}

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
  readonly subscriptionTargets?:
    | ReadonlyArray<SubscriptionTarget<Module>>
    | undefined
  readonly setup?:
    | ((
        session: WsSession<Module, ErrorContext, RelationContext>,
      ) => Effect.Effect<void, SetupError, SetupR | Scope.Scope>)
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

      const attemptScope = yield* Scope.make()
      return yield* Effect.gen(function* () {
        const current = yield* Effect.gen(function* () {
          const acquired = yield* connectAndSubscribe(
            options.acquire,
            subscriptionTargets,
          )
          const failOnInvalidation = acquired.awaitInvalidation().pipe(
            Effect.flatMap((invalidation) =>
              Effect.fail(
                new ConnectionLostError({
                  raw: invalidation.message,
                }),
              ),
            ),
          )
          yield* Effect.gen(function* () {
            if (options.setup !== undefined) {
              yield* options.setup(acquired)
            }
            if (acquired.isInvalidated()) {
              return yield* failOnInvalidation
            }
            yield* Ref.set(failureLastRef, undefined)
            yield* SubscriptionRef.set(session, AsyncResult.success(acquired))
            yield* SubscriptionRef.set(phase, { status: "live", attempt })
          }).pipe(Effect.raceFirst(failOnInvalidation))
          return acquired
        }).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(options.activationTimeoutMillis),
            orElse: () => Effect.fail(options.activationTimeoutFailure()),
          }),
        )
        const invalidation = yield* current.awaitInvalidation()
        return new ConnectionLostError({ raw: invalidation.message })
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

const retryGeneratedConnectionFailure = (failure: unknown): boolean =>
  !GeneratedArtifactShapeError.is(failure) &&
  !(
    WsConnectError.is(failure) &&
    WsUnsupportedBuilderFeatureError.is(failure.cause)
  )

export const makeSupervisorFromModulePlan = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
  SetupError = never,
  SetupR = never,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: RequiredConnectTimeout<
    WsBuilderConfig<Module, ErrorContext, RelationContext>
  >
  readonly subscriptionTargets?:
    | ReadonlyArray<SubscriptionTarget<Module>>
    | undefined
  readonly setup?:
    | ((
        session: WsSession<Module, ErrorContext, RelationContext>,
      ) => Effect.Effect<void, SetupError, SetupR | Scope.Scope>)
    | undefined
  readonly policy?:
    | WsSessionSupervisorPolicy<WsSessionSupervisorFailure<never, SetupError>>
    | undefined
}) =>
  makeWithAcquire<
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
    }),
    activationTimeoutFailure: () =>
      new WsConnectError({
        cause: new WsConnectTimeoutError({
          timeoutMillis: options.config.connectTimeoutMillis,
        }),
      }),
    activationTimeoutMillis: options.config.connectTimeoutMillis,
    subscriptionTargets: options.subscriptionTargets,
    setup: options.setup,
    ...options.policy,
    isRetryable: options.policy?.isRetryable ?? retryGeneratedConnectionFailure,
  })

export const makeSupervisor = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
  SetupError = never,
  SetupR = never,
>(options: {
  readonly module: Module
  readonly config: RequiredConnectTimeout<
    WsBuilderConfig<Module, ErrorContext, RelationContext>
  >
  readonly subscriptionTargets?:
    | ReadonlyArray<SubscriptionTarget<Module>>
    | undefined
  readonly setup?:
    | ((
        session: WsSession<Module, ErrorContext, RelationContext>,
      ) => Effect.Effect<void, SetupError, SetupR | Scope.Scope>)
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
  readonly config: RequiredConnectTimeout<
    WsGeneratedConfig<Module, ConnectionClass, RelationContext> &
      MismatchedGeneratedModuleDiagnostic<Module, ConnectionClass>
  >
  readonly subscriptionTargets?:
    | ReadonlyArray<SubscriptionTarget<Module>>
    | undefined
  readonly setup?:
    | ((
        session: WsSession<
          Module,
          GeneratedErrorContextOf<ConnectionClass>,
          RelationContext
        >,
      ) => Effect.Effect<void, SetupError, SetupR | Scope.Scope>)
    | undefined
  readonly policy?:
    | WsSessionSupervisorPolicy<
        WsSessionSupervisorFailure<GeneratedArtifactShapeError, SetupError>
      >
    | undefined
}) =>
  makeWithAcquire<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    WsConnectError | GeneratedArtifactShapeError,
    SetupError,
    SetupR
  >({
    acquire: makeScopedGenerated({
      module: options.module,
      config: options.config,
    }),
    activationTimeoutFailure: () =>
      new WsConnectError({
        cause: new WsConnectTimeoutError({
          timeoutMillis: options.config.connectTimeoutMillis,
        }),
      }),
    activationTimeoutMillis: options.config.connectTimeoutMillis,
    subscriptionTargets: options.subscriptionTargets,
    setup: options.setup,
    ...options.policy,
    isRetryable: options.policy?.isRetryable ?? retryGeneratedConnectionFailure,
  })
