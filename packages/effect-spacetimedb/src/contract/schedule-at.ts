import * as Cron from "effect/Cron"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Match from "effect/Match"
import { ScheduleAt as NativeScheduleAt, Timestamp } from "spacetimedb"

export type ScheduleAtValue = ReturnType<typeof NativeScheduleAt.interval>

const microsFromDuration = (input: Duration.Input): bigint =>
  Duration.toNanosUnsafe(input) / 1_000n

const microsFromDateTime = (time: DateTime.Utc): bigint =>
  BigInt(DateTime.toEpochMillis(time)) * 1_000n

const timestampMicros = (time: Timestamp): bigint => time.microsSinceUnixEpoch

const dateMicros = (date: Date): bigint => BigInt(date.getTime()) * 1_000n

export const interval = (input: Duration.Input): ScheduleAtValue =>
  NativeScheduleAt.interval(microsFromDuration(input))

export const at = (time: Timestamp | DateTime.Utc): ScheduleAtValue =>
  NativeScheduleAt.time(
    time instanceof Timestamp
      ? timestampMicros(time)
      : microsFromDateTime(time),
  )

export const after = (
  from: Timestamp,
  duration: Duration.Input,
): ScheduleAtValue =>
  NativeScheduleAt.time(timestampMicros(from) + microsFromDuration(duration))

export const nextCron = (
  cron: Cron.Cron,
  afterTime: Timestamp,
): ScheduleAtValue =>
  NativeScheduleAt.time(dateMicros(Cron.next(cron, afterTime.toDate())))

export const $is =
  (tag: ScheduleAtValue["tag"]) =>
  (value: ScheduleAtValue): boolean =>
    value.tag === tag

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
