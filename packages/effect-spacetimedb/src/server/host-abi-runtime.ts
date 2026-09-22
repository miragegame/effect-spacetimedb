import { cloneRangeLike, isRangeLike, type RangeLike } from "../range-like.ts"
import * as Result from "effect/Result"
import { normalizeIdentity } from "../identity.ts"

export type HostErrorName =
  | "AutoIncOverflow"
  | "NoSuchRow"
  | "ScheduleAtDelayTooLong"
  | "UniqueAlreadyExists"

export const HostErrorNames = {
  AutoIncOverflow: "AutoIncOverflow",
  NoSuchRow: "NoSuchRow",
  ScheduleAtDelayTooLong: "ScheduleAtDelayTooLong",
  UniqueAlreadyExists: "UniqueAlreadyExists",
} as const

export const hostErrorName = (cause: unknown): HostErrorName | undefined => {
  if (!(cause instanceof Error)) {
    return undefined
  }

  switch (cause.name) {
    case HostErrorNames.AutoIncOverflow:
    case HostErrorNames.NoSuchRow:
    case HostErrorNames.ScheduleAtDelayTooLong:
    case HostErrorNames.UniqueAlreadyExists:
      return cause.name
    default:
      return undefined
  }
}

export const errorName = (cause: unknown): string | undefined =>
  cause instanceof Error ? cause.name : undefined

export const senderErrorMessage = (cause: unknown): string | undefined =>
  cause instanceof Error && cause.name === "SenderError"
    ? cause.message
    : undefined

export const identityKey = (value: unknown): string | undefined => {
  const normalized = normalizeIdentity(value)
  if (Result.isSuccess(normalized)) {
    return normalized.success
  }

  // The compiler bundle contains distinct public and server-runtime Identity
  // constructors. Reducer contexts therefore fail a nominal instanceof check
  // even though both native values carry the same U256 host representation.
  const hostIdentity =
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "__identity__") &&
    typeof (value as { readonly __identity__?: unknown }).__identity__ ===
      "bigint"
      ? (value as { readonly __identity__: bigint }).__identity__
      : undefined

  return hostIdentity === undefined
    ? undefined
    : Result.getOrUndefined(normalizeIdentity(hostIdentity))
}

export const isHostRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const isScheduledRowPayload = (value: unknown): boolean =>
  isHostRecord(value) &&
  (Object.hasOwn(value, "scheduledId") ||
    Object.hasOwn(value, "scheduledAt") ||
    Object.hasOwn(value, "scheduled_id") ||
    Object.hasOwn(value, "scheduled_at"))

export { cloneRangeLike, isRangeLike, type RangeLike }
