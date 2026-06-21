import * as Data from "effect/Data"
import { StdbDecodeError } from "../decode-error.ts"

export class SubscriptionRejectedError extends Data.TaggedError(
  "SubscriptionRejectedError",
)<{
  readonly raw: string
}> {}

export class SubscriptionInvalidatedError extends Data.TaggedError(
  "SubscriptionInvalidatedError",
)<{
  readonly raw: string
  readonly connectionFatal: boolean
}> {}

export class SubscriptionTransportError extends Data.TaggedError(
  "SubscriptionTransportError",
)<{
  readonly cause: unknown
}> {}

export type SubscriptionFailure =
  | SubscriptionRejectedError
  | SubscriptionInvalidatedError
  | SubscriptionTransportError
  | StdbDecodeError
