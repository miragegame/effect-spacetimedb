import * as Data from "effect/Data"
import { StdbDecodeError } from "../decode-error.ts"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"

/**
 * Why a connection ended for good. `lost` is every ordinary end: a close, a
 * socket error, a release, a reconnect the SDK gave up on. `identityChanged` is
 * an automatic reconnect, or a supervised replacement, that came back under
 * another identity. `credentialsFailed` and `credentialsDefect` are a token
 * refresh for a reconnect, or a token for a replacement, that failed or died.
 */
export type ConnectionInvalidationKind =
  | "lost"
  | "protocolError"
  | "identityChanged"
  | "credentialsFailed"
  | "credentialsDefect"

/**
 * Whether what a connection read stops being readable when it ends this way.
 * A connection that only lost its socket read rows its identity may still see.
 * A protocol error may have left its cache partly updated. After an identity
 * or credential failure nobody can vouch for its identity, and the cache
 * can include sender-scoped view rows.
 */
export const invalidationRevokesRows = (
  kind: ConnectionInvalidationKind,
): boolean => kind !== "lost"

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
  readonly kind: ConnectionInvalidationKind
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
