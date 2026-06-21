import * as Cron from "effect/Cron"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import { Timestamp } from "spacetimedb"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const expectIntervalMicros = (
  value: Stdb.ScheduleAt.ScheduleAtValue,
  micros: bigint,
) => {
  expect(value.tag).toBe("Interval")
  if (value.tag !== "Interval") {
    throw new Error("Expected Interval ScheduleAt")
  }

  expect(value.value.micros).toBe(micros)
}

const expectTimeMicros = (
  value: Stdb.ScheduleAt.ScheduleAtValue,
  micros: bigint,
) => {
  expect(value.tag).toBe("Time")
  if (value.tag !== "Time") {
    throw new Error("Expected Time ScheduleAt")
  }

  expect(value.value.microsSinceUnixEpoch).toBe(micros)
}

describe("ScheduleAt helpers", (it) => {
  it.effect("constructs native-compatible interval and time values", () =>
    Effect.gen(function* () {
      const interval = Stdb.ScheduleAt.interval(Duration.nanos(1_999n))
      const timestamp = new Timestamp(1_234_567n)
      const atTimestamp = Stdb.ScheduleAt.at(timestamp)
      const atDateTime = Stdb.ScheduleAt.at(
        DateTime.makeUnsafe("1970-01-01T00:00:02.003Z"),
      )
      const afterTimestamp = Stdb.ScheduleAt.after(timestamp, "2 seconds")

      expectIntervalMicros(interval, 1n)
      expectTimeMicros(atTimestamp, 1_234_567n)
      expectTimeMicros(atDateTime, 2_003_000n)
      expectTimeMicros(afterTimestamp, 3_234_567n)
    }),
  )

  it.effect("matches and narrows ScheduleAt tags", () =>
    Effect.gen(function* () {
      const interval = Stdb.ScheduleAt.interval("5 seconds")
      const time = Stdb.ScheduleAt.at(new Timestamp(10n))

      expect(Stdb.ScheduleAt.$is("Interval")(interval)).toBe(true)
      expect(Stdb.ScheduleAt.$is("Time")(interval)).toBe(false)
      expect(
        Stdb.ScheduleAt.$match(interval, {
          Interval: (value) => value.value.micros,
          Time: () => 0n,
        }),
      ).toBe(5_000_000n)
      expect(
        Stdb.ScheduleAt.$match(time, {
          Interval: () => 0n,
          Time: (value) => value.value.microsSinceUnixEpoch,
        }),
      ).toBe(10n)
    }),
  )

  it.effect("derives the next cron time strictly after the timestamp", () =>
    Effect.gen(function* () {
      const cron = Cron.parseUnsafe("0 * * * * *")
      const after = Timestamp.fromDate(new Date("2024-01-01T00:00:00.000Z"))
      const expected =
        BigInt(new Date("2024-01-01T00:01:00.000Z").getTime()) * 1_000n

      expectTimeMicros(Stdb.ScheduleAt.nextCron(cron, after), expected)
    }),
  )
})
