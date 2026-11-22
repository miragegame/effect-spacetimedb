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
import {
  decodeDefectFromCause,
  renderStructuredCause,
  StdbDecodeError,
} from "../decode-error.ts"
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
  CallableInterruptedDefect,
  isStdbHostFailure,
  HandlerAsyncNotAllowedDefect,
  StdbAutoIncOverflowError,
  StdbHostCallError,
  type HostFailure,
  StdbNoSuchRowError,
  StdbScheduleDelayTooLongError,
  StdbSenderError,
  StdbUniqueAlreadyExistsError,
} from "./services.ts"

export const stringifyFailure = (error: unknown): string => {
  if (typeof error === "string") {
    return error
  }
  if (StdbSenderError.is(error)) {
    return error.value
  }
  if (error instanceof Error) {
    return error.message
  }
  return typeof error === "object" && error !== null
    ? renderStructuredCause(error)
    : String(error)
}

const asyncFiberFailure = (
  cause: Cause.Cause<unknown>,
): Cause.AsyncFiberError | undefined =>
  cause.reasons
    .filter(Cause.isDieReason)
    .map((reason) => reason.defect)
    .find(Cause.isAsyncFiberError)

/**
 * A handler that went asynchronous leaves a suspended fiber behind and comes
 * back as an `AsyncFiberError`, which says nothing to whoever reads the cause.
 * The boundary resolves it first, so every later step sees the clear defect.
 */
export const resolveAsyncEscape = (
  cause: Cause.Cause<unknown>,
): Cause.Cause<unknown> => {
  const asyncFailure = asyncFiberFailure(cause)
  if (asyncFailure === undefined) {
    return cause
  }

  asyncFailure.fiber.interruptUnsafe()
  return Cause.die(new HandlerAsyncNotAllowedDefect())
}

/**
 * In a reducer or a lifecycle hook, a sender failure is the module refusing its
 * caller, which is an answer and not a fault. Those two are the only callables
 * the host gives a `SenderError` to: anywhere else it is an undeclared failure.
 */
export const isSenderRefusal = (cause: Cause.Cause<unknown>): boolean =>
  !Cause.hasDies(cause) &&
  StdbSenderError.is(Cause.findErrorOption(cause).pipe(Option.getOrUndefined))

/** Own fields a pretty cause already prints, or that say nothing of use. */
const prettyRenderedFields: ReadonlySet<string> = new Set([
  "_tag",
  "cause",
  "message",
  "name",
  "stack",
])

const unrenderedErrorFields = (value: unknown): ReadonlyArray<string> => {
  if (!(value instanceof Error)) {
    return []
  }

  const fields = Object.entries(value).filter(
    ([key]) => !prettyRenderedFields.has(key),
  )
  return fields.length === 0
    ? []
    : [
        `${value.name} fields: ${renderStructuredCause(Object.fromEntries(fields))}`,
      ]
}

/**
 * `Cause.pretty`, plus what it drops: a tagged error's own fields, which are
 * all a tagged defect without a message has to say for itself.
 */
export const prettyFailureCause = (cause: Cause.Cause<unknown>): string =>
  [
    Cause.pretty(cause),
    ...cause.reasons.flatMap((reason) =>
      Cause.isDieReason(reason)
        ? unrenderedErrorFields(reason.defect)
        : Cause.isFailReason(reason)
          ? unrenderedErrorFields(reason.error)
          : [],
    ),
  ].join("\n")

/** The longest account of a caller's bad arguments a response carries. */
const callArgumentsMessageCharsMax = 1024

/**
 * What the caller did wrong, if anything: the schema's account of its
 * arguments. `undefined` means the failure is the module's own, which never
 * reaches a caller as text.
 */
export const callRefusalMessage = (
  callable: string,
  cause: unknown,
): string | undefined => {
  if (!StdbDecodeError.is(cause) || !Schema.isSchemaError(cause.cause)) {
    return undefined
  }

  return `Invalid arguments for ${callable}: ${cause.cause.message}`.slice(
    0,
    callArgumentsMessageCharsMax,
  )
}

const hostFailureToken = (error: HostFailure): string => {
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

const hostFailureToThrow = (error: HostFailure): Error =>
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

class HttpDeclaredErrorDefinitionMissingDefect extends Data.TaggedError(
  "HttpDeclaredErrorDefinitionMissingDefect",
) {}

class InvalidRawHttpResponseDefect extends Data.TaggedError(
  "InvalidRawHttpResponseDefect",
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
      : Effect.die(new InvalidRawHttpResponseDefect())
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
    return Effect.die(new HttpDeclaredErrorDefinitionMissingDefect())
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

const throwDecodeDefect = (cause: Cause.Cause<unknown>): void => {
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
  if (options.senderError === true && StdbSenderError.is(error)) {
    throw new SenderError(error.value)
  }

  throw error instanceof Error ? error : new Error(stringifyFailure(error))
}

const handleFailureCause = (
  cause: Cause.Cause<unknown>,
  options: {
    readonly kind: "reducer" | "view" | "lifecycle"
    readonly senderError?: boolean
  },
): never => {
  throwDecodeDefect(cause)
  throwUnhandledDefect(cause)

  const failure = Cause.findErrorOption(cause)
  return Option.match(failure, {
    onNone: () => {
      throw new CallableInterruptedDefect({
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

export const toViewValue = <A>(exit: Exit.Exit<A, unknown>): A =>
  Exit.match(exit, {
    onFailure: (cause) => handleFailureCause(cause, { kind: "view" }),
    onSuccess: (value) => value,
  })
