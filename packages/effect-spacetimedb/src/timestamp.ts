import { Timestamp } from "spacetimedb"

// Timestamp-to-Date conversion truncates to milliseconds. Compare native
// microseconds directly so values within the same millisecond remain ordered.
export const compareTimestampAsc = (a: Timestamp, b: Timestamp): number => {
  const difference = a.microsSinceUnixEpoch - b.microsSinceUnixEpoch
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

export const compareTimestampDesc = (a: Timestamp, b: Timestamp): number =>
  compareTimestampAsc(b, a)

export const timestampAddMillis = (
  timestamp: Timestamp,
  millis: number,
): Timestamp =>
  new Timestamp(
    timestamp.microsSinceUnixEpoch + BigInt(Math.round(millis)) * 1000n,
  )

export const timestampIsDue = (timestamp: Timestamp, now: Timestamp): boolean =>
  timestamp.microsSinceUnixEpoch <= now.microsSinceUnixEpoch

/** Converts to a Date with millisecond precision. */
export const timestampToDate = (timestamp: Timestamp): Date =>
  timestamp.toDate()

/** Converts to ISO-8601 through Date, truncating to millisecond precision. */
export const timestampToIso = (timestamp: Timestamp): string =>
  timestampToDate(timestamp).toISOString()

/** Converts to a number with millisecond precision and Date's safe range guard. */
export const timestampToMillis = (timestamp: Timestamp): number => {
  const millis = timestamp.microsSinceUnixEpoch / 1000n
  if (
    millis > BigInt(Number.MAX_SAFE_INTEGER) ||
    millis < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError(
      "Timestamp is outside of the representable range of JS's Date",
    )
  }
  return Number(millis)
}
