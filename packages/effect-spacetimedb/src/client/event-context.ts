import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import { Timestamp } from "spacetimedb"
import { StdbDecodeError } from "../decode-error.ts"

export type StdbReducerOutcome = Data.TaggedEnum<{
  Ok: {}
  OkEmpty: {}
  Err: {
    /**
     * BSATN-encoded reducer error bytes. This layer does not have the reducer
     * error AlgebraicType needed to decode a typed or human-readable value.
     */
    readonly error: Uint8Array
  }
  InternalError: {
    readonly message: string
  }
}>

export const StdbReducerOutcome = Data.taggedEnum<StdbReducerOutcome>()

export type StdbEventContext = Data.TaggedEnum<{
  Reducer: {
    readonly reducer: string
    readonly timestamp: Timestamp
    readonly outcome: StdbReducerOutcome
  }
  SubscribeApplied: {}
  UnsubscribeApplied: {}
  Transaction: {}
  Error: {
    readonly error: Error
  }
}>

export const StdbEventContext = Data.taggedEnum<StdbEventContext>()

type DecodeContext = {
  readonly table?: string
}

const decodeFailure = (cause: unknown, context: DecodeContext) =>
  new StdbDecodeError({
    phase: "row",
    cause,
    op: "eventContext",
    ...(context.table !== undefined ? { table: context.table } : {}),
  })

const readRecord = (
  value: unknown,
  label: string,
  context: DecodeContext,
): Record<string, unknown> => {
  if (Predicate.isObject(value)) {
    return value
  }
  throw decodeFailure(new Error(`Expected ${label}`), context)
}

const readString = (
  record: Record<string, unknown>,
  key: string,
  context: DecodeContext,
): string => {
  const value = record[key]
  if (typeof value !== "string") {
    throw decodeFailure(
      new Error(`Expected event.${key} to be a string`),
      context,
    )
  }
  return value
}

const readNativeError = (value: unknown, context: DecodeContext): Error => {
  if (value instanceof Error) {
    return value
  }
  throw decodeFailure(new Error("Expected event.value to be an Error"), context)
}

const readTimestamp = (value: unknown, context: DecodeContext): Timestamp => {
  if (value instanceof Timestamp) {
    return value
  }
  throw decodeFailure(
    new Error("Expected reducer timestamp to be a native Timestamp"),
    context,
  )
}

const readReducerErrBytes = (
  value: unknown,
  context: DecodeContext,
): Uint8Array => {
  if (value instanceof Uint8Array) {
    return value
  }
  throw decodeFailure(
    new Error("Expected reducer Err value to be a Uint8Array"),
    context,
  )
}

const readInternalErrorMessage = (
  value: unknown,
  context: DecodeContext,
): string => {
  if (typeof value === "string") {
    return value
  }
  throw decodeFailure(
    new Error("Expected reducer InternalError value to be a string"),
    context,
  )
}

const decodeReducerOutcome = (
  value: unknown,
  context: DecodeContext,
): StdbReducerOutcome => {
  const record = readRecord(value, "reducer outcome", context)
  if (typeof record.tag !== "string") {
    throw decodeFailure(new Error("Expected reducer outcome tag"), context)
  }

  switch (record.tag) {
    case "Ok":
      return StdbReducerOutcome.Ok()
    case "OkEmpty":
      return StdbReducerOutcome.OkEmpty()
    case "Err":
      return StdbReducerOutcome.Err({
        error: readReducerErrBytes(record.value, context),
      })
    case "InternalError":
      return StdbReducerOutcome.InternalError({
        message: readInternalErrorMessage(record.value, context),
      })
    default:
      throw decodeFailure(
        new Error(`Unknown reducer outcome tag: ${record.tag}`),
        context,
      )
  }
}

const decodeReducer = (
  value: unknown,
  context: DecodeContext,
): StdbEventContext => {
  const record = readRecord(value, "reducer event value", context)
  const reducer = readRecord(record.reducer, "reducer event reducer", context)

  return StdbEventContext.Reducer({
    reducer: readString(reducer, "name", context),
    timestamp: readTimestamp(record.timestamp, context),
    outcome: decodeReducerOutcome(record.outcome, context),
  })
}

export const decodeStdbEventContextSync = (
  value: unknown,
  context: DecodeContext = {},
): StdbEventContext => {
  const record = readRecord(value, "generated event context", context)
  const event = readRecord(
    record.event,
    "generated event context event",
    context,
  )
  const tag = readString(event, "tag", context)

  switch (tag) {
    case "Reducer":
      return decodeReducer(event.value, context)
    case "SubscribeApplied":
      return StdbEventContext.SubscribeApplied()
    case "UnsubscribeApplied":
      return StdbEventContext.UnsubscribeApplied()
    case "Transaction":
      return StdbEventContext.Transaction()
    case "Error":
      return StdbEventContext.Error({
        error: readNativeError(event.value, context),
      })
    default:
      throw decodeFailure(new Error(`Unknown event tag: ${tag}`), context)
  }
}

export const decodeStdbEventContext = (
  value: unknown,
  context: DecodeContext = {},
): Effect.Effect<StdbEventContext, StdbDecodeError> =>
  Effect.try({
    try: () => decodeStdbEventContextSync(value, context),
    catch: (cause) =>
      StdbDecodeError.is(cause) ? cause : decodeFailure(cause, context),
  })
