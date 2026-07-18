import * as Cron from "effect/Cron"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Match from "effect/Match"
import {
  Interval as NativeInterval,
  Timestamp,
  Time as NativeTime,
  type Interval,
  type ScheduleAt as NativeScheduleAtValue,
  type Time,
} from "spacetimedb"

export type ScheduleAtValue = NativeScheduleAtValue

const microsFromDuration = (input: Duration.Input): bigint =>
  Duration.toNanosUnsafe(input) / 1_000n

const microsFromDateTime = (time: DateTime.Utc): bigint =>
  BigInt(DateTime.toEpochMillis(time)) * 1_000n

const timestampMicros = (time: Timestamp): bigint => time.microsSinceUnixEpoch

const dateMicros = (date: Date): bigint => BigInt(date.getTime()) * 1_000n

export const interval = (input: Duration.Input): Interval =>
  NativeInterval(microsFromDuration(input))

export const at = (time: Timestamp | DateTime.Utc): Time =>
  NativeTime(
    time instanceof Timestamp
      ? timestampMicros(time)
      : microsFromDateTime(time),
  )

export const after = (from: Timestamp, duration: Duration.Input): Time =>
  NativeTime(timestampMicros(from) + microsFromDuration(duration))

export const nextCron = (cron: Cron.Cron, afterTime: Timestamp): Time =>
  NativeTime(dateMicros(Cron.next(cron, afterTime.toDate())))

export const $is =
  <Tag extends ScheduleAtValue["tag"]>(tag: Tag) =>
  (value: ScheduleAtValue): value is Extract<ScheduleAtValue, { tag: Tag }> =>
    value.tag === tag

export const timeOrUndefined = (
  value: ScheduleAtValue,
): Timestamp | undefined => ($is("Time")(value) ? value.value : undefined)

export const $match = <A>(
  value: ScheduleAtValue,
  cases: {
    readonly Interval: (
      value: Extract<ScheduleAtValue, { tag: "Interval" }>,
    ) => A
    readonly Time: (value: Extract<ScheduleAtValue, { tag: "Time" }>) => A
  },
): A =>
  Match.value(value).pipe(
    Match.discriminatorsExhaustive("tag")({
      Interval: cases.Interval,
      Time: cases.Time,
    }),
  ) as A
