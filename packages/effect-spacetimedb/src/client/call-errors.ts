import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { InternalError, SenderError } from "spacetimedb"
import * as ErrorCodec from "../contract/error.ts"
import * as Type from "../contract/type.ts"
import { StdbDecodeError } from "../decode-error.ts"
import { prepareHttpInputValue } from "./http-json.ts"
import * as TransportCodec from "./value-codec.ts"

export class DomainCallError<E> extends Data.TaggedError("DomainCallError")<{
  readonly error: E
  readonly remote?: RemoteRejectedError
}> {}

export class RemoteRejectedError extends Data.TaggedError(
  "RemoteRejectedError",
)<{
  readonly raw: string
  readonly declaredTag?: string
}> {}

export class RemoteRejectedBody extends Data.TaggedError("RemoteRejectedBody")<{
  readonly raw: string
}> {}

export class TransportError extends Data.TaggedError("TransportError")<{
  readonly cause: unknown
}> {}

export class WsRpcInvokeError extends Data.TaggedError("WsRpcInvokeError")<{
  readonly cause: unknown
}> {}

export type CallFailure<E> =
  | E
  | RemoteRejectedError
  | TransportError
  | StdbDecodeError

export type RawCallFailure<E> =
  | DomainCallError<E>
  | RemoteRejectedError
  | TransportError
  | StdbDecodeError

export { StdbDecodeError }

type TaggedDomainError = {
  readonly _tag: string
}

type DomainTagHandlers<
  Domain extends TaggedDomainError,
  Handlers extends object,
> = {
  readonly [Tag in keyof Handlers]: Tag extends Domain["_tag"]
    ? (
        error: Extract<Domain, { readonly _tag: Tag }>,
      ) => Effect.Effect<unknown, unknown, unknown>
    : never
}

type DefinitionDomain<Definition extends ErrorCodec.AnyErrorDefinition> =
  ErrorCodec.ErrorInstances<Definition> & TaggedDomainError

type HandlerSuccess<Handlers> = {
  readonly [Key in keyof Handlers]: Handlers[Key] extends (
    ...args: ReadonlyArray<never>
  ) => Effect.Effect<infer A, unknown, unknown>
    ? A
    : never
}[keyof Handlers]

type HandlerError<Handlers> = {
  readonly [Key in keyof Handlers]: Handlers[Key] extends (
    ...args: ReadonlyArray<never>
  ) => Effect.Effect<unknown, infer E, unknown>
    ? E
    : never
}[keyof Handlers]

type HandlerContext<Handlers> = {
  readonly [Key in keyof Handlers]: Handlers[Key] extends (
    ...args: ReadonlyArray<never>
  ) => Effect.Effect<unknown, unknown, infer R>
    ? R
    : never
}[keyof Handlers]

type HandledDomain<Domain extends TaggedDomainError, Handlers> = Extract<
  Domain,
  { readonly _tag: Extract<keyof Handlers, string> }
>

type UnhandledDomain<Domain extends TaggedDomainError, Handlers> = Exclude<
  Domain,
  HandledDomain<Domain, Handlers>
>

type UnhandledDomainError<Domain extends TaggedDomainError, Handlers> = [
  UnhandledDomain<Domain, Handlers>,
] extends [never]
  ? never
  : DomainCallError<UnhandledDomain<Domain, Handlers>>

const isDomainCallError = <Domain>(
  cause: unknown,
): cause is DomainCallError<Domain> => cause instanceof DomainCallError

type ProtocolChannelTop = {} | null | undefined

export function catchRawTags<
  Definition extends ErrorCodec.AnyErrorDefinition,
  const Handlers extends object,
>(
  definition: Definition,
  handlers: Handlers &
    DomainTagHandlers<DefinitionDomain<Definition>, Handlers>,
): <A, E, R>(
  effect: Effect.Effect<A, E, R>,
) => Effect.Effect<
  A | HandlerSuccess<Handlers>,
  | Exclude<E, DomainCallError<DefinitionDomain<Definition>>>
  | UnhandledDomainError<DefinitionDomain<Definition>, Handlers>
  | HandlerError<Handlers>,
  R | HandlerContext<Handlers>
>
export function catchRawTags(
  definition: ErrorCodec.AnyErrorDefinition,
  handlers: object,
) {
  const handlerRecord = handlers as Record<
    string,
    (
      error: unknown,
    ) => Effect.Effect<
      ProtocolChannelTop,
      ProtocolChannelTop,
      ProtocolChannelTop
    >
  >

  for (const tag of Object.keys(handlerRecord)) {
    if (!definition.tags.has(tag)) {
      throw new Error(`catchRawTags(...) received undeclared error tag ${tag}`)
    }
  }

  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchIf(isDomainCallError<ProtocolChannelTop>, (rawFailure) => {
        const failure = rawFailure as DomainCallError<ProtocolChannelTop>
        const error = failure.error
        const tag =
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          typeof error._tag === "string"
            ? error._tag
            : undefined
        const handler =
          tag != null && tag !== "" && Object.hasOwn(handlerRecord, tag)
            ? handlerRecord[tag]
            : undefined
        return handler != null ? handler(error) : Effect.fail(failure)
      }),
    ) as never
}

export const messageFromUnknown = (cause: unknown): string | undefined => {
  if (typeof cause === "string") {
    return cause
  }
  if (cause instanceof Error) {
    return cause.message
  }
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof (cause as { readonly message?: unknown }).message === "string"
  ) {
    return (cause as { readonly message: string }).message
  }
  return undefined
}

export const remoteFailureMessageFromUnknown = (
  cause: unknown,
): string | undefined => {
  if (cause instanceof WsRpcInvokeError) {
    return remoteFailureMessageFromUnknown(cause.cause)
  }
  if (typeof cause === "string") {
    return cause
  }
  if (cause instanceof RemoteRejectedBody) {
    return cause.raw
  }
  if (cause instanceof SenderError || cause instanceof InternalError) {
    return cause.message
  }
  if (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    "message" in cause &&
    typeof (cause as { readonly name?: unknown }).name === "string" &&
    typeof (cause as { readonly message?: unknown }).message === "string"
  ) {
    const namedCause = cause as {
      readonly name: string
      readonly message: string
    }

    return namedCause.name === "SenderError" ||
      namedCause.name === "InternalError"
      ? namedCause.message
      : undefined
  }

  return undefined
}

export const encodeArgs = <A>(
  type: Type.AnyValueType,
  value: A,
): Effect.Effect<unknown, StdbDecodeError> =>
  TransportCodec.http.encode(type, value)

const encodedStructEntries = (
  type: Type.StructLikeValueType,
  encoded: unknown,
): ReadonlyArray<readonly [string, unknown]> => {
  const fields = Type.structFields(type)
  if (fields == null) {
    throw new Error("Callable params must be authored with Type.struct(...)")
  }
  if (
    typeof encoded !== "object" ||
    encoded === null ||
    Array.isArray(encoded)
  ) {
    throw new Error("Encoded callable params must be an object payload")
  }

  const record = encoded as Record<string, unknown>
  return Object.keys(fields).map(
    (fieldName) => [fieldName, record[fieldName]] as const,
  )
}

const structField = (
  fields: Type.StructFields,
  fieldName: string,
): Type.AnyValueType | undefined =>
  Object.hasOwn(fields, fieldName) ? fields[fieldName] : undefined

export const encodeArgsArray = <A>(
  type: Type.StructLikeValueType,
  value: A,
): Effect.Effect<ReadonlyArray<unknown>, StdbDecodeError> =>
  encodeArgs(type, value).pipe(
    Effect.flatMap((encoded) => {
      const fields = Type.structFields(type)
      if (fields == null) {
        return Effect.fail(
          new StdbDecodeError({
            phase: "args",
            cause: new Error(
              "Callable params must be authored with Type.struct(...)",
            ),
          }),
        )
      }
      return Effect.try({
        try: () =>
          encodedStructEntries(type as Type.StructValueType, encoded).map(
            ([fieldName, fieldValue]) => {
              const fieldType = structField(fields, fieldName)
              return fieldType === undefined
                ? fieldValue
                : prepareHttpInputValue(
                    Type.structFieldWireType(fieldType),
                    fieldValue,
                  )
            },
          ),
        catch: (cause) => new StdbDecodeError({ phase: "args", cause }),
      })
    }),
  )

export const remoteRejectedFromRaw = (raw: string): RemoteRejectedError => {
  const declaredTag = ErrorCodec.peekStringEnvelopeTag(raw)
  return declaredTag != null && declaredTag !== ""
    ? new RemoteRejectedError({
        raw,
        declaredTag,
      })
    : new RemoteRejectedError({ raw })
}

export const classifyRawCallFailure = <E>(cause: unknown): CallFailure<E> =>
  cause instanceof WsRpcInvokeError
    ? classifyRawCallFailure(cause.cause)
    : cause instanceof RemoteRejectedBody || typeof cause === "string"
      ? (remoteRejectedFromRaw(
          cause instanceof RemoteRejectedBody ? cause.raw : cause,
        ) as CallFailure<E>)
      : (new TransportError({ cause }) as CallFailure<E>)
