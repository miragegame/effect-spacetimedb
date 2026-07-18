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

export const identityKey = (value: unknown): string | undefined =>
  Result.getOrUndefined(normalizeIdentity(value))

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
