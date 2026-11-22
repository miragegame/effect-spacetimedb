import * as Data from "effect/Data"
import { errorTypeId, hasErrorTypeId } from "./error-identity.ts"

const StdbHostCallErrorTypeId = errorTypeId("StdbHostCallError")
export class StdbHostCallError extends Data.TaggedError("StdbHostCallError")<{
  readonly op: string
  readonly cause: unknown
  readonly hostErrorName?: string
}> {
  readonly [StdbHostCallErrorTypeId] = StdbHostCallErrorTypeId
  static is = hasErrorTypeId<StdbHostCallError>(StdbHostCallErrorTypeId)
}

const StdbUniqueAlreadyExistsErrorTypeId = errorTypeId(
  "StdbUniqueAlreadyExistsError",
)
export class StdbUniqueAlreadyExistsError extends Data.TaggedError(
  "StdbUniqueAlreadyExistsError",
)<{
  readonly op: string
  readonly cause: unknown
}> {
  readonly [StdbUniqueAlreadyExistsErrorTypeId] =
    StdbUniqueAlreadyExistsErrorTypeId
  static is = hasErrorTypeId<StdbUniqueAlreadyExistsError>(
    StdbUniqueAlreadyExistsErrorTypeId,
  )
}

const StdbAutoIncOverflowErrorTypeId = errorTypeId("StdbAutoIncOverflowError")
export class StdbAutoIncOverflowError extends Data.TaggedError(
  "StdbAutoIncOverflowError",
)<{
  readonly op: string
  readonly cause: unknown
}> {
  readonly [StdbAutoIncOverflowErrorTypeId] = StdbAutoIncOverflowErrorTypeId
  static is = hasErrorTypeId<StdbAutoIncOverflowError>(
    StdbAutoIncOverflowErrorTypeId,
  )
}

const StdbNoSuchRowErrorTypeId = errorTypeId("StdbNoSuchRowError")
export class StdbNoSuchRowError extends Data.TaggedError("StdbNoSuchRowError")<{
  readonly op: string
  readonly cause: unknown
}> {
  readonly [StdbNoSuchRowErrorTypeId] = StdbNoSuchRowErrorTypeId
  static is = hasErrorTypeId<StdbNoSuchRowError>(StdbNoSuchRowErrorTypeId)
}

const StdbScheduleDelayTooLongErrorTypeId = errorTypeId(
  "StdbScheduleDelayTooLongError",
)
export class StdbScheduleDelayTooLongError extends Data.TaggedError(
  "StdbScheduleDelayTooLongError",
)<{
  readonly op: string
  readonly cause: unknown
}> {
  readonly [StdbScheduleDelayTooLongErrorTypeId] =
    StdbScheduleDelayTooLongErrorTypeId
  static is = hasErrorTypeId<StdbScheduleDelayTooLongError>(
    StdbScheduleDelayTooLongErrorTypeId,
  )
}

export type HostFailure =
  | StdbHostCallError
  | StdbUniqueAlreadyExistsError
  | StdbAutoIncOverflowError
  | StdbNoSuchRowError
  | StdbScheduleDelayTooLongError

export const isStdbHostFailure = (error: unknown): error is HostFailure =>
  StdbHostCallError.is(error) ||
  StdbUniqueAlreadyExistsError.is(error) ||
  StdbAutoIncOverflowError.is(error) ||
  StdbNoSuchRowError.is(error) ||
  StdbScheduleDelayTooLongError.is(error)

const StdbSenderErrorTypeId = errorTypeId("StdbSenderError")
export class StdbSenderError extends Data.TaggedError("StdbSenderError")<{
  readonly value: string
}> {
  readonly [StdbSenderErrorTypeId] = StdbSenderErrorTypeId
  static is = hasErrorTypeId<StdbSenderError>(StdbSenderErrorTypeId)
}
