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
import { addDecodeContext } from "../decode-error.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import type { AnyValueType } from "../contract/type.ts"
import {
  type CallFailure,
  classifyRawCallFailure,
  DomainCallError,
  isConnectionCallFailure,
  type RawCallFailure,
  type RawWsCallFailure,
  RemoteRejectedBodyError,
  RemoteRejectedError,
  remoteFailureMessageFromUnknown,
  remoteRejectedFromRaw,
  remoteRejectedFromUndeclared,
  StdbDecodeError,
  TransportError,
  type WsCallFailure,
  type WsConnectionFailure,
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

/**
 * The connection failures a runtime can raise, read off its `invoke`. These
 * helpers classify every failure the same way at run time, so the type is what
 * tells an HTTP call from a WebSocket one.
 */
type ConnectionFailureOf<InvokeError> = Extract<
  InvokeError,
  WsConnectionFailure
>

/** Every failure classification can produce, on either mode and transport. */
type ClassifiedFailure<E> = WsCallFailure<E> | RawWsCallFailure<E>

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
): cause is
  | WsConnectionFailure
  | StdbDecodeError
  | RemoteRejectedError
  | TransportError =>
  isConnectionCallFailure(cause) ||
  StdbDecodeError.is(cause) ||
  RemoteRejectedError.is(cause) ||
  TransportError.is(cause)

const isRawCallFailure = <E>(cause: unknown): cause is RawWsCallFailure<E> =>
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
): Effect.Effect<never, ClassifiedFailure<DeclaredErrorsOf<Spec>>> => {
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
              ClassifiedFailure<DeclaredErrorsOf<Spec>>
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
): Effect.Effect<never, ClassifiedFailure<DeclaredErrorsOf<Spec>>> => {
  if (mode === "raw" && isRawCallFailure<DeclaredErrorsOf<Spec>>(cause)) {
    return Effect.fail(cause)
  }

  if (isTransportCallFailure(cause)) {
    return Effect.fail(cause)
  }

  const remoteFailure = remoteFailureMessageFromUnknown(cause)
  if (remoteFailure !== undefined) {
    const remoteStatus = RemoteRejectedBodyError.is(cause)
      ? cause.status
      : undefined
    if (spec.errors == null) {
      return Effect.fail(
        classifyRawCallFailure<DeclaredErrorsOf<Spec>>(
          RemoteRejectedBodyError.is(cause) ? cause : remoteFailure,
        ),
      )
    }

    return decodeDeclaredFailure(spec.errors, remoteFailure, remoteStatus).pipe(
      Effect.flatMap(
        (error) =>
          failDeclaredDomain<DeclaredErrorsOf<Spec>>(
            error as DeclaredErrorsOf<Spec>,
            mode,
            remoteRejectedFromRaw(remoteFailure, remoteStatus),
          ) as Effect.Effect<never, ClassifiedFailure<DeclaredErrorsOf<Spec>>>,
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
  status?: number,
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
    return Effect.fail(remoteRejectedFromRaw(raw, status))
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
): Effect.Effect<
  void,
  CallFailure<DeclaredErrorsOf<Spec>> | ConnectionFailureOf<InvokeError>,
  R
>
function callReducerWithMode<
  Spec extends ReducerSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: ReducerCallOptions<Spec, Prepared, InvokeError, R, "raw">,
): Effect.Effect<
  void,
  RawCallFailure<DeclaredErrorsOf<Spec>> | ConnectionFailureOf<InvokeError>,
  R
>
function callReducerWithMode<
  Spec extends ReducerSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: ReducerCallOptions<Spec, Prepared, InvokeError, R>,
): Effect.Effect<void, ClassifiedFailure<DeclaredErrorsOf<Spec>>, R> {
  return Effect.suspend(() => {
    const callable = options.callable
    return options.runtime.prepareArgs(callable.spec, options.payload).pipe(
      Effect.mapError((error) =>
        addDecodeContext(error, {
          callable: callable.name,
          op: "encodeArgs",
        }),
      ),
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
  }) as Effect.Effect<void, ClassifiedFailure<DeclaredErrorsOf<Spec>>, R>
}

export const callReducer = <Spec extends ReducerSpec, Prepared, InvokeError, R>(
  options: Omit<
    ReducerCallOptions<Spec, Prepared, InvokeError, R>,
    "domainErrorMode"
  >,
): Effect.Effect<
  void,
  CallFailure<DeclaredErrorsOf<Spec>> | ConnectionFailureOf<InvokeError>,
  R
> =>
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
): Effect.Effect<
  void,
  RawCallFailure<DeclaredErrorsOf<Spec>> | ConnectionFailureOf<InvokeError>,
  R
> =>
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
): Effect.Effect<
  ReturnsOf<Spec>,
  CallFailure<DeclaredErrorsOf<Spec>> | ConnectionFailureOf<InvokeError>,
  R
>
function callProcedureWithMode<
  Spec extends ProcedureSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: ProcedureCallOptions<Spec, Prepared, InvokeError, R, "raw">,
): Effect.Effect<
  ReturnsOf<Spec>,
  RawCallFailure<DeclaredErrorsOf<Spec>> | ConnectionFailureOf<InvokeError>,
  R
>
function callProcedureWithMode<
  Spec extends ProcedureSpec,
  Prepared,
  InvokeError,
  R,
>(
  options: ProcedureCallOptions<Spec, Prepared, InvokeError, R>,
): Effect.Effect<
  ReturnsOf<Spec>,
  ClassifiedFailure<DeclaredErrorsOf<Spec>>,
  R
> {
  return Effect.suspend(() => {
    const callable = options.callable
    return options.runtime.prepareArgs(callable.spec, options.payload).pipe(
      Effect.mapError((error) =>
        addDecodeContext(error, {
          callable: callable.name,
          op: "encodeArgs",
        }),
      ),
      Effect.flatMap((prepared) =>
        options.runtime.invoke(callable.name, callable.spec, prepared),
      ),
      Effect.flatMap((response) =>
        options.runtime
          .decodeValue<ProcedureEnvelopeOf<Spec>>(
            procedureResponseType(callable.spec),
            response,
          )
          .pipe(
            Effect.flatMap((decoded) =>
              Match.value(decoded as ProcedureEnvelopeRuntime).pipe(
                Match.discriminatorsExhaustive("tag")({
                  err: (failure) => {
                    const undeclared = ErrorCodec.peekUndeclaredFailure(
                      failure.value,
                    )
                    if (undeclared !== undefined) {
                      return Effect.fail(
                        remoteRejectedFromUndeclared(undeclared) as CallFailure<
                          DeclaredErrorsOf<Spec>
                        >,
                      )
                    }

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
          ),
      ),
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
    ClassifiedFailure<DeclaredErrorsOf<Spec>>,
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
): Effect.Effect<
  ReturnsOf<Spec>,
  CallFailure<DeclaredErrorsOf<Spec>> | ConnectionFailureOf<InvokeError>,
  R
> =>
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
): Effect.Effect<
  ReturnsOf<Spec>,
  RawCallFailure<DeclaredErrorsOf<Spec>> | ConnectionFailureOf<InvokeError>,
  R
> =>
  callProcedureWithMode({
    ...options,
    domainErrorMode: "raw",
  })
