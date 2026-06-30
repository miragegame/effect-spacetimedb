import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import {
  type ProcedureCallableDescriptor,
  procedureResponseType,
  type ReducerCallableDescriptor,
} from "../callable-protocol.ts"
import * as ErrorCodec from "../contract/error.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import type { AnyValueType } from "../contract/type.ts"
import {
  type CallFailure,
  classifyRawCallFailure,
  DomainCallError,
  type RawCallFailure,
  RemoteRejectedError,
  remoteFailureMessageFromUnknown,
  remoteRejectedFromRaw,
  StdbDecodeError,
  TransportError,
} from "./call-errors.ts"
import type {
  DeclaredErrorsOf,
  ParamsOf,
  ProcedureEnvelopeOf,
  ReturnsOf,
} from "./rpc.ts"

type ValueDecoder = <A>(
  type: AnyValueType,
  value: unknown,
) => Effect.Effect<A, StdbDecodeError>

type ReducerCallRuntime<Prepared, InvokeError, R> = {
  readonly prepareArgs: <Spec extends ReducerSpec>(
    spec: Spec,
    payload: ParamsOf<Spec>,
  ) => Effect.Effect<Prepared, StdbDecodeError>
  readonly invoke: <Spec extends ReducerSpec>(
    name: string,
    spec: Spec,
    prepared: Prepared,
  ) => Effect.Effect<unknown, InvokeError, R>
}

type ProcedureCallRuntime<Prepared, InvokeError, R> = {
  readonly prepareArgs: <Spec extends ProcedureSpec>(
    spec: Spec,
    payload: ParamsOf<Spec>,
  ) => Effect.Effect<Prepared, StdbDecodeError>
  readonly invoke: <Spec extends ProcedureSpec>(
    name: string,
    spec: Spec,
    prepared: Prepared,
  ) => Effect.Effect<unknown, InvokeError, R>
  readonly decodeValue: ValueDecoder
}

type DomainErrorMode = "direct" | "raw"

type ReducerCallOptions<
  Spec extends ReducerSpec,
  Prepared,
  InvokeError,
  R,
  Mode extends DomainErrorMode = DomainErrorMode,
> = {
  readonly moduleName: string
  readonly transport: "http" | "ws"
  readonly callable: ReducerCallableDescriptor<Spec>
  readonly payload: ParamsOf<Spec>
  readonly runtime: ReducerCallRuntime<Prepared, InvokeError, R>
  readonly domainErrorMode: Mode
}

type ProcedureCallOptions<
  Spec extends ProcedureSpec,
  Prepared,
  InvokeError,
  R,
  Mode extends DomainErrorMode = DomainErrorMode,
> = {
  readonly moduleName: string
  readonly transport: "http" | "ws"
  readonly callable: ProcedureCallableDescriptor<Spec>
  readonly payload: ParamsOf<Spec>
  readonly runtime: ProcedureCallRuntime<Prepared, InvokeError, R>
  readonly domainErrorMode: Mode
}

type ProcedureEnvelopeRuntime =
  | {
      readonly tag: "ok"
      readonly value?: unknown
    }
  | {
      readonly tag: "err"
      readonly value: string
    }

const isTransportCallFailure = (
  cause: unknown,
): cause is StdbDecodeError | RemoteRejectedError | TransportError =>
  StdbDecodeError.is(cause) ||
  RemoteRejectedError.is(cause) ||
  TransportError.is(cause)

const isRawCallFailure = <E>(cause: unknown): cause is RawCallFailure<E> =>
  isTransportCallFailure(cause) || DomainCallError.is(cause)

const failDeclaredDomain = <E>(
  error: E,
  mode: DomainErrorMode,
  remote?: RemoteRejectedError,
): Effect.Effect<never, E | RawCallFailure<E>> =>
  Match.value(mode).pipe(
    Match.when("raw", () =>
      Effect.fail(
        new DomainCallError({
          error,
          ...(remote != null ? { remote } : {}),
        }) as RawCallFailure<E>,
      ),
    ),
    Match.when("direct", () => Effect.fail(error)),
    Match.exhaustive,
  )

const classifyCallFailure = <Spec extends ReducerSpec | ProcedureSpec>(
  spec: Spec,
  cause: unknown,
  mode: DomainErrorMode,
): Effect.Effect<
  never,
  CallFailure<DeclaredErrorsOf<Spec>> | RawCallFailure<DeclaredErrorsOf<Spec>>
> => {
  if (mode === "raw" && isRawCallFailure<DeclaredErrorsOf<Spec>>(cause)) {
    return Effect.fail(cause)
  }

  if (isTransportCallFailure(cause)) {
    return Effect.fail(cause)
  }

  if (spec.errors != null) {
    return ErrorCodec.matchEffect(spec.errors, cause).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => classifyRemoteFailure(spec, cause, mode),
          onSome: (error) =>
            failDeclaredDomain<DeclaredErrorsOf<Spec>>(
              error as DeclaredErrorsOf<Spec>,
              mode,
            ) as Effect.Effect<
              never,
              | CallFailure<DeclaredErrorsOf<Spec>>
              | RawCallFailure<DeclaredErrorsOf<Spec>>
            >,
        }),
      ),
    )
  }

  return classifyRemoteFailure(spec, cause, mode)
}

const classifyRemoteFailure = <Spec extends ReducerSpec | ProcedureSpec>(
  spec: Spec,
  cause: unknown,
  mode: DomainErrorMode,
): Effect.Effect<
  never,
  CallFailure<DeclaredErrorsOf<Spec>> | RawCallFailure<DeclaredErrorsOf<Spec>>
> => {
  if (mode === "raw" && isRawCallFailure<DeclaredErrorsOf<Spec>>(cause)) {
    return Effect.fail(cause)
  }

  if (isTransportCallFailure(cause)) {
    return Effect.fail(cause)
  }

  const remoteFailure = remoteFailureMessageFromUnknown(cause)
  if (remoteFailure !== undefined) {
    if (spec.errors == null) {
      return Effect.fail(
        classifyRawCallFailure<DeclaredErrorsOf<Spec>>(remoteFailure),
      )
    }

    return decodeDeclaredFailure(spec.errors, remoteFailure).pipe(
      Effect.flatMap(
        (error) =>
          failDeclaredDomain<DeclaredErrorsOf<Spec>>(
            error as DeclaredErrorsOf<Spec>,
            mode,
            remoteRejectedFromRaw(remoteFailure),
          ) as Effect.Effect<
            never,
            | CallFailure<DeclaredErrorsOf<Spec>>
            | RawCallFailure<DeclaredErrorsOf<Spec>>
          >,
      ),
    )
  }

  return Effect.fail(classifyRawCallFailure<DeclaredErrorsOf<Spec>>(cause))
}

const decodeDeclaredFailure = <
  Definition extends ErrorCodec.AnyErrorDefinition,
>(
  definition: Definition,
  raw: string,
): Effect.Effect<
  ErrorCodec.ErrorInstances<Definition>,
  RemoteRejectedError | StdbDecodeError
> => {
  const declaredTag = ErrorCodec.peekStringEnvelopeTag(raw)
  if (
    declaredTag == null ||
    declaredTag === "" ||
    !definition.tags.has(declaredTag)
  ) {
    return Effect.fail(remoteRejectedFromRaw(raw))
  }

  return ErrorCodec.decodeString(definition, raw).pipe(
    Effect.mapError(
      (cause) =>
        new StdbDecodeError({
          phase: cause.phase,
          declaredTag: cause.declaredTag ?? declaredTag,
          cause: cause.cause,
        }),
    ),
  )
}

function callReducerWithMode<
  Spec extends ReducerSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: ReducerCallOptions<Spec, Prepared, InvokeError, R, "direct">,
): Effect.Effect<void, CallFailure<DeclaredErrorsOf<Spec>>, R>
function callReducerWithMode<
  Spec extends ReducerSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: ReducerCallOptions<Spec, Prepared, InvokeError, R, "raw">,
): Effect.Effect<void, RawCallFailure<DeclaredErrorsOf<Spec>>, R>
function callReducerWithMode<
  Spec extends ReducerSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: ReducerCallOptions<Spec, Prepared, InvokeError, R>,
): Effect.Effect<
  void,
  CallFailure<DeclaredErrorsOf<Spec>> | RawCallFailure<DeclaredErrorsOf<Spec>>,
  R
> {
  return Effect.suspend(() => {
    const callable = options.callable
    return options.runtime.prepareArgs(callable.spec, options.payload).pipe(
      Effect.flatMap((prepared) =>
        options.runtime.invoke(callable.name, callable.spec, prepared),
      ),
      Effect.asVoid,
      Effect.matchEffect({
        onSuccess: () => Effect.void,
        onFailure: (cause) =>
          classifyCallFailure(callable.spec, cause, options.domainErrorMode),
      }),
      Effect.withSpan("spacetimedb.callable.invoke", {
        attributes: {
          "spacetimedb.module": options.moduleName,
          "spacetimedb.callable": callable.name,
          "spacetimedb.callable.declared": callable.declaredName,
          "spacetimedb.callable.kind": callable.kind,
          "spacetimedb.transport": options.transport,
        },
      }),
    )
  }) as Effect.Effect<
    void,
    | CallFailure<DeclaredErrorsOf<Spec>>
    | RawCallFailure<DeclaredErrorsOf<Spec>>,
    R
  >
}

export const callReducer = <Spec extends ReducerSpec, Prepared, InvokeError, R>(
  options: Omit<
    ReducerCallOptions<Spec, Prepared, InvokeError, R>,
    "domainErrorMode"
  >,
): Effect.Effect<void, CallFailure<DeclaredErrorsOf<Spec>>, R> =>
  callReducerWithMode({
    ...options,
    domainErrorMode: "direct",
  })

export const callReducerRaw = <
  Spec extends ReducerSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: Omit<
    ReducerCallOptions<Spec, Prepared, InvokeError, R>,
    "domainErrorMode"
  >,
): Effect.Effect<void, RawCallFailure<DeclaredErrorsOf<Spec>>, R> =>
  callReducerWithMode({
    ...options,
    domainErrorMode: "raw",
  })

function callProcedureWithMode<
  Spec extends ProcedureSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: ProcedureCallOptions<Spec, Prepared, InvokeError, R, "direct">,
): Effect.Effect<ReturnsOf<Spec>, CallFailure<DeclaredErrorsOf<Spec>>, R>
function callProcedureWithMode<
  Spec extends ProcedureSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: ProcedureCallOptions<Spec, Prepared, InvokeError, R, "raw">,
): Effect.Effect<ReturnsOf<Spec>, RawCallFailure<DeclaredErrorsOf<Spec>>, R>
function callProcedureWithMode<
  Spec extends ProcedureSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: ProcedureCallOptions<Spec, Prepared, InvokeError, R>,
): Effect.Effect<
  ReturnsOf<Spec>,
  CallFailure<DeclaredErrorsOf<Spec>> | RawCallFailure<DeclaredErrorsOf<Spec>>,
  R
> {
  return Effect.suspend(() => {
    const callable = options.callable
    return options.runtime.prepareArgs(callable.spec, options.payload).pipe(
      Effect.flatMap((prepared) =>
        options.runtime.invoke(callable.name, callable.spec, prepared),
      ),
      Effect.flatMap((response) => {
        if (Predicate.isUndefined(callable.errors)) {
          return options.runtime.decodeValue<ReturnsOf<Spec>>(
            callable.returns,
            response,
          )
        }

        return options.runtime
          .decodeValue<ProcedureEnvelopeOf<Spec>>(
            procedureResponseType(callable.spec),
            response,
          )
          .pipe(
            Effect.flatMap((decoded) =>
              Match.value(decoded as ProcedureEnvelopeRuntime).pipe(
                Match.discriminatorsExhaustive("tag")({
                  err: (failure) => {
                    const errors = callable.errors
                    if (Predicate.isUndefined(errors)) {
                      return Effect.fail(
                        remoteRejectedFromRaw(failure.value) as CallFailure<
                          DeclaredErrorsOf<Spec>
                        >,
                      )
                    }

                    return decodeDeclaredFailure(errors, failure.value).pipe(
                      Effect.flatMap((error) =>
                        failDeclaredDomain<DeclaredErrorsOf<Spec>>(
                          error as DeclaredErrorsOf<Spec>,
                          options.domainErrorMode,
                          remoteRejectedFromRaw(failure.value),
                        ),
                      ),
                    )
                  },
                  ok: (success) =>
                    Effect.succeed(
                      ("value" in success
                        ? success.value
                        : undefined) as ReturnsOf<Spec>,
                    ),
                }),
              ),
            ),
          )
      }),
      Effect.matchEffect({
        onSuccess: Effect.succeed,
        onFailure: (cause) =>
          classifyCallFailure(callable.spec, cause, options.domainErrorMode),
      }),
      Effect.withSpan("spacetimedb.callable.invoke", {
        attributes: {
          "spacetimedb.module": options.moduleName,
          "spacetimedb.callable": callable.name,
          "spacetimedb.callable.declared": callable.declaredName,
          "spacetimedb.callable.kind": callable.kind,
          "spacetimedb.transport": options.transport,
        },
      }),
    )
  }) as Effect.Effect<
    ReturnsOf<Spec>,
    | CallFailure<DeclaredErrorsOf<Spec>>
    | RawCallFailure<DeclaredErrorsOf<Spec>>,
    R
  >
}

export const callProcedure = <
  Spec extends ProcedureSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: Omit<
    ProcedureCallOptions<Spec, Prepared, InvokeError, R>,
    "domainErrorMode"
  >,
): Effect.Effect<ReturnsOf<Spec>, CallFailure<DeclaredErrorsOf<Spec>>, R> =>
  callProcedureWithMode({
    ...options,
    domainErrorMode: "direct",
  })

export const callProcedureRaw = <
  Spec extends ProcedureSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: Omit<
    ProcedureCallOptions<Spec, Prepared, InvokeError, R>,
    "domainErrorMode"
  >,
): Effect.Effect<ReturnsOf<Spec>, RawCallFailure<DeclaredErrorsOf<Spec>>, R> =>
  callProcedureWithMode({
    ...options,
    domainErrorMode: "raw",
  })
