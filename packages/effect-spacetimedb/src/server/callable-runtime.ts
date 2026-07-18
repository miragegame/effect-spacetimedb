import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { SenderError } from "spacetimedb"
import * as ErrorCodec from "../contract/error.ts"
import type { HttpHandlerSpec } from "../contract/http-handler.ts"
import { isTypedHttpHandlerSpec } from "../contract/http-handler.ts"
import { decodeDefectFromCause } from "../decode-error.ts"
import { readTaggedErrorTag } from "../error-identity.ts"
import {
  SyncResponse as NativeSyncResponse,
  SyncResponse,
} from "../http-primitives.ts"
import {
  encodeEmptyHttpBody,
  httpWireCodec,
  isHttpEmptySchema,
} from "../http-wire-codec.ts"
import { declaredErrorFromCause } from "./declared-errors.ts"
import { HostErrorNames } from "./host-abi-runtime.ts"
import {
  CallableInterruptedError,
  isStdbHostFailure,
  ReducerAsyncNotAllowedError,
  StdbAutoIncOverflowError,
  StdbHostCallError,
  type StdbHostFailure,
  StdbNoSuchRowError,
  StdbScheduleDelayTooLongError,
  StdbSenderFailure,
  StdbUniqueAlreadyExistsError,
} from "./services.ts"

export const stringifyFailure = (error: unknown): string => {
  if (typeof error === "string") {
    return error
  }
  if (StdbSenderFailure.is(error)) {
    return error.value
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

const asyncFiberFailure = (
  cause: Cause.Cause<unknown>,
): Cause.AsyncFiberError | undefined =>
  cause.reasons
    .filter(Cause.isDieReason)
    .map((reason) => reason.defect)
    .find(Cause.isAsyncFiberError)

const reducerAsyncNotAllowedDefect = (
  cause: Cause.Cause<unknown>,
): ReducerAsyncNotAllowedError | undefined =>
  cause.reasons
    .filter(Cause.isDieReason)
    .map((reason) => reason.defect)
    .find(ReducerAsyncNotAllowedError.is)

const hostFailureToken = (error: StdbHostFailure): string => {
  if (StdbUniqueAlreadyExistsError.is(error)) {
    return HostErrorNames.UniqueAlreadyExists
  }
  if (StdbAutoIncOverflowError.is(error)) {
    return HostErrorNames.AutoIncOverflow
  }
  if (StdbNoSuchRowError.is(error)) {
    return HostErrorNames.NoSuchRow
  }
  if (StdbScheduleDelayTooLongError.is(error)) {
    return HostErrorNames.ScheduleAtDelayTooLong
  }
  if (StdbHostCallError.is(error)) {
    return error.hostErrorName ?? "HostCallError"
  }
  return "HostCallError"
}

const hostFailureToThrow = (error: StdbHostFailure): Error =>
  new Error(
    `SpaceTimeDB host call failed at ${error.op} [${hostFailureToken(error)}]: ${stringifyFailure(error.cause)}`,
    {
      cause: error.cause,
    },
  )

export class HttpRequestDecodeError extends Data.TaggedError(
  "HttpRequestDecodeError",
)<{
  readonly cause: unknown
}> {}

export class HttpResponseEncodeError extends Data.TaggedError(
  "HttpResponseEncodeError",
)<{
  readonly phase: "success" | "declaredError"
  readonly cause: unknown
}> {}

export type HttpResult = Data.TaggedEnum<{
  Raw: { readonly response: SyncResponse }
  Json: {
    readonly status: number
    readonly body: string
    readonly contentType?: "application/json"
  }
  DeclaredError: {
    readonly status: number
    readonly body: string
    readonly contentType: "application/json"
  }
}>

const {
  Raw: HttpRaw,
  Json: HttpJson,
  DeclaredError: HttpDeclaredError,
} = Data.taggedEnum<HttpResult>()

class HttpDeclaredErrorDefinitionMissing extends Data.TaggedError(
  "HttpDeclaredErrorDefinitionMissing",
) {}

class InvalidRawHttpResponse extends Data.TaggedError(
  "InvalidRawHttpResponse",
) {}

const successStatus = (spec: HttpHandlerSpec): number =>
  spec.successStatus ?? 200

const declaredErrorStatus = (spec: HttpHandlerSpec, error: unknown): number => {
  const tag = readTaggedErrorTag(error)
  const errorClass = spec.errors?.errors.find(
    (candidate) => ErrorCodec.tagOf(candidate) === tag,
  )
  // Module validation requires HTTP declared errors to carry statuses; this is
  // defensive for malformed specs or undeclared runtime failures.
  return errorClass === undefined
    ? 400
    : (ErrorCodec.statusOf(errorClass) ?? 400)
}

const encodeHttpSuccess = <Spec extends HttpHandlerSpec, A>(
  spec: Spec,
  value: A,
): Effect.Effect<HttpResult, HttpResponseEncodeError> => {
  if (!isTypedHttpHandlerSpec(spec)) {
    return value instanceof SyncResponse
      ? Effect.succeed(HttpRaw({ response: value }))
      : Effect.die(new InvalidRawHttpResponse())
  }

  if (isHttpEmptySchema(spec.response)) {
    return encodeEmptyHttpBody(spec.response, value).pipe(
      Effect.mapError(
        (cause) => new HttpResponseEncodeError({ phase: "success", cause }),
      ),
      Effect.as(
        HttpJson({
          status: successStatus(spec),
          body: "",
        }),
      ),
    )
  }

  return encodeHttpWire(spec.response, value).pipe(
    Effect.mapError(
      (cause) => new HttpResponseEncodeError({ phase: "success", cause }),
    ),
    Effect.map((body) =>
      HttpJson({
        status: successStatus(spec),
        body,
        contentType: "application/json" as const,
      }),
    ),
  )
}

const encodeDeclaredHttpError = (
  spec: HttpHandlerSpec,
  error: unknown,
): Effect.Effect<HttpResult, HttpResponseEncodeError> => {
  const errors = spec.errors
  if (errors == null) {
    return Effect.die(new HttpDeclaredErrorDefinitionMissing())
  }

  return encodeHttpWire(errors.schema, error).pipe(
    Effect.mapError(
      (cause) => new HttpResponseEncodeError({ phase: "declaredError", cause }),
    ),
    Effect.map((body) =>
      HttpDeclaredError({
        status: declaredErrorStatus(spec, error),
        body,
        contentType: "application/json" as const,
      }),
    ),
  )
}

const encodeHttpWire = <S extends Schema.Top>(schema: S, value: unknown) =>
  Schema.encodeEffect(httpWireCodec(schema))(value as Schema.Schema.Type<S>)

export const encodeHttpResult =
  <Spec extends HttpHandlerSpec>(spec: Spec) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<
    HttpResult,
    E | HttpRequestDecodeError | HttpResponseEncodeError,
    R
  > =>
    effect.pipe(
      Effect.matchCauseEffect({
        onSuccess: (value) => encodeHttpSuccess(spec, value),
        onFailure: (cause) => {
          const errors = spec.errors
          if (errors == null) {
            return Effect.failCause(cause)
          }

          return declaredErrorFromCause(errors, cause).pipe(
            Effect.catchTag("StdbDecodeError", () =>
              Effect.logWarning(
                "Failed to classify declared HTTP error; preserving original failure cause",
              ).pipe(Effect.andThen(Effect.failCause(cause))),
            ),
            Effect.flatMap(
              (
                matched,
              ): Effect.Effect<HttpResult, E | HttpResponseEncodeError> =>
                Option.match(matched, {
                  onNone: () => Effect.failCause(cause),
                  onSome: (error) => encodeDeclaredHttpError(spec, error),
                }),
            ),
          )
        },
      }),
    ) as Effect.Effect<
      HttpResult,
      E | HttpRequestDecodeError | HttpResponseEncodeError,
      R
    >

const jsonResponseInit = (
  result: Extract<HttpResult, { readonly _tag: "Json" | "DeclaredError" }>,
) =>
  Match.value(result.contentType).pipe(
    Match.when("application/json", (contentType) => ({
      status: result.status,
      headers: { "content-type": contentType },
    })),
    Match.when(undefined, () => ({ status: result.status })),
    Match.exhaustive,
  )

export const toHttpResponse = (
  exit: Exit.Exit<HttpResult, unknown>,
): SyncResponse =>
  Exit.match(exit, {
    onSuccess: (result) =>
      Match.value(result).pipe(
        Match.tag("Raw", (raw) => raw.response),
        Match.tag(
          "Json",
          (json) => new NativeSyncResponse(json.body, jsonResponseInit(json)),
        ),
        Match.tag(
          "DeclaredError",
          (declaredError) =>
            new NativeSyncResponse(
              declaredError.body,
              jsonResponseInit(declaredError),
            ),
        ),
        Match.exhaustive,
      ),
    onFailure: (cause) =>
      new NativeSyncResponse(null, {
        status: isHttpClientFault(cause) ? 400 : 500,
      }),
  })

export const isHttpClientFault = (cause: Cause.Cause<unknown>): boolean =>
  cause.pipe(Cause.findErrorOption, Option.getOrUndefined) instanceof
  HttpRequestDecodeError

export const logHttpFailureCause = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.tapCause((cause) =>
      isHttpClientFault(cause)
        ? // Request decode failures are intentional 400 responses and are not
          // error-logged; server failures retain their full pretty-printed cause.
          Effect.void
        : cause.pipe(Cause.pretty, Effect.logError),
    ),
  )

const throwAsyncOrDecodeDefect = (cause: Cause.Cause<unknown>): void => {
  const directAsyncFailure = reducerAsyncNotAllowedDefect(cause)
  if (directAsyncFailure != null) {
    throw directAsyncFailure
  }

  const asyncFailure = asyncFiberFailure(cause)
  if (asyncFailure != null) {
    asyncFailure.fiber.interruptUnsafe()
    throw new ReducerAsyncNotAllowedError()
  }

  const directDecodeFailure = decodeDefectFromCause(cause)
  if (directDecodeFailure != null) {
    throw directDecodeFailure
  }
}

const throwUnhandledDefect = (cause: Cause.Cause<unknown>): void => {
  const defect = cause.reasons.find(Cause.isDieReason)?.defect
  if (defect === undefined) {
    return
  }

  throw defect instanceof Error ? defect : new Error(stringifyFailure(defect))
}

const throwFailureValue = (
  error: unknown,
  options: { readonly senderError?: boolean } = {},
): never => {
  if (isStdbHostFailure(error)) {
    throw hostFailureToThrow(error)
  }
  if (options.senderError === true && StdbSenderFailure.is(error)) {
    throw new SenderError(error.value)
  }

  throw error instanceof Error ? error : new Error(stringifyFailure(error))
}

const handleFailureCause = (
  cause: Cause.Cause<unknown>,
  options: {
    readonly kind: "reducer" | "procedure" | "view" | "lifecycle"
    readonly senderError?: boolean
  },
): never => {
  throwAsyncOrDecodeDefect(cause)
  throwUnhandledDefect(cause)

  const failure = Cause.findErrorOption(cause)
  return Option.match(failure, {
    onNone: () => {
      throw new CallableInterruptedError({
        kind: options.kind,
        cause: Cause.squash(cause),
      })
    },
    onSome: (error) => throwFailureValue(error, options),
  })
}

export const toReducerThrow = (exit: Exit.Exit<unknown, unknown>): void =>
  Exit.match(exit, {
    onFailure: (cause) =>
      handleFailureCause(cause, { kind: "reducer", senderError: true }),
    onSuccess: () => undefined,
  })

export const toLifecycleThrow = (exit: Exit.Exit<unknown, unknown>): void =>
  Exit.match(exit, {
    onFailure: (cause) =>
      handleFailureCause(cause, { kind: "lifecycle", senderError: true }),
    onSuccess: () => undefined,
  })

const toCallableValue = <A>(
  kind: "procedure" | "view",
  exit: Exit.Exit<A, unknown>,
): A =>
  Exit.match(exit, {
    onFailure: (cause) => handleFailureCause(cause, { kind }),
    onSuccess: (value) => value,
  })

export const toProcedureValue = <A>(exit: Exit.Exit<A, unknown>): A =>
  toCallableValue("procedure", exit)

export const toViewValue = <A>(exit: Exit.Exit<A, unknown>): A =>
  toCallableValue("view", exit)
