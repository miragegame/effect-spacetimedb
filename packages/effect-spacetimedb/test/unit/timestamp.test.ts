import * as EffectVitest from "@effect/vitest"
import {
  compareTimestampAsc,
  compareTimestampDesc,
  timestampAddMillis,
  timestampIsDue,
  timestampToDate,
  timestampToIso,
  timestampToMillis,
} from "effect-spacetimedb"
import { Timestamp } from "spacetimedb"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

describe("timestamp utilities", (it) => {
  it("orders values at microsecond precision", () => {
    const earlier = new Timestamp(1_000n)
    const later = new Timestamp(1_001n)

    expect(compareTimestampAsc(earlier, later)).toBe(-1)
    expect(compareTimestampAsc(later, earlier)).toBe(1)
    expect(compareTimestampAsc(earlier, earlier)).toBe(0)
    expect(compareTimestampDesc(earlier, later)).toBe(1)
  })

  it("preserves whole-millisecond rounding for additions", () => {
    const base = new Timestamp(10_000n)

    expect(timestampAddMillis(base, 1.5).microsSinceUnixEpoch).toBe(12_000n)
    expect(timestampAddMillis(base, -1.5).microsSinceUnixEpoch).toBe(9_000n)
    expect(timestampAddMillis(base, -0.5).microsSinceUnixEpoch).toBe(10_000n)
    expect(
      timestampAddMillis(timestampAddMillis(base, 5), -5).microsSinceUnixEpoch,
    ).toBe(base.microsSinceUnixEpoch)
  })

  it("checks due timestamps inclusively", () => {
    const now = new Timestamp(5_000n)

    expect(timestampIsDue(new Timestamp(4_999n), now)).toBe(true)
    expect(timestampIsDue(now, now)).toBe(true)
    expect(timestampIsDue(new Timestamp(5_001n), now)).toBe(false)
  })

  it("converts through millisecond precision", () => {
    for (const micros of [1_999n, 1_000n, -1_999n, -1_000n, -999n]) {
      const timestamp = new Timestamp(micros)
      expect(timestampToMillis(timestamp)).toBe(timestamp.toDate().getTime())
    }

    const timestamp = new Timestamp(1_234_567_890_123n)
    expect(timestampToDate(timestamp)).toEqual(timestamp.toDate())
    expect(timestampToIso(timestamp)).toBe(timestamp.toDate().toISOString())
  })

  it("matches the native safe-integer range guard", () => {
    const maximum = BigInt(Number.MAX_SAFE_INTEGER)
    const minimum = BigInt(Number.MIN_SAFE_INTEGER)

    expect(timestampToMillis(new Timestamp(maximum * 1000n))).toBe(
      Number.MAX_SAFE_INTEGER,
    )
    expect(timestampToMillis(new Timestamp(minimum * 1000n))).toBe(
      Number.MIN_SAFE_INTEGER,
    )
    expect(() =>
      timestampToMillis(new Timestamp((maximum + 1n) * 1000n)),
    ).toThrow(RangeError)
    expect(() =>
      timestampToMillis(new Timestamp((minimum - 1n) * 1000n)),
    ).toThrow(RangeError)
    expect(() => new Timestamp((maximum + 1n) * 1000n).toDate()).toThrow(
      RangeError,
    )
  })
})
