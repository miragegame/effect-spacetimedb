import * as Data from "effect/Data"
import { StdbDecodeError } from "../decode-error.ts"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"

const SubscriptionRejectedErrorTypeId = errorTypeId("SubscriptionRejectedError")
export class SubscriptionRejectedError extends Data.TaggedError(
  "SubscriptionRejectedError",
)<{
  readonly raw: string
}> {
  readonly [SubscriptionRejectedErrorTypeId] = SubscriptionRejectedErrorTypeId
  static is = hasErrorTypeId<SubscriptionRejectedError>(
    SubscriptionRejectedErrorTypeId,
  )
}

const SubscriptionInvalidatedErrorTypeId = errorTypeId(
  "SubscriptionInvalidatedError",
)
export class SubscriptionInvalidatedError extends Data.TaggedError(
  "SubscriptionInvalidatedError",
)<{
  readonly raw: string
  readonly connectionFatal: boolean
}> {
  readonly [SubscriptionInvalidatedErrorTypeId] =
    SubscriptionInvalidatedErrorTypeId
  static is = hasErrorTypeId<SubscriptionInvalidatedError>(
    SubscriptionInvalidatedErrorTypeId,
  )
}

const SubscriptionTransportErrorTypeId = errorTypeId(
  "SubscriptionTransportError",
)
export class SubscriptionTransportError extends Data.TaggedError(
  "SubscriptionTransportError",
)<{
  readonly cause: unknown
}> {
  readonly [SubscriptionTransportErrorTypeId] = SubscriptionTransportErrorTypeId
  static is = hasErrorTypeId<SubscriptionTransportError>(
    SubscriptionTransportErrorTypeId,
  )
}

export type SubscriptionFailure =
  | SubscriptionRejectedError
  | SubscriptionInvalidatedError
  | SubscriptionTransportError
  | StdbDecodeError
