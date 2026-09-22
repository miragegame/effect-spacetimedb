import * as EffectVitest from "@effect/vitest"
import { Timestamp } from "spacetimedb"
import { makeServerRandom } from "../../src/server/runtime-layer.ts"

const { describe, expect, it } = EffectVitest

const safeMin = Number.MIN_SAFE_INTEGER
const safeMax = Number.MAX_SAFE_INTEGER
const safeBigIntMin = BigInt(safeMin)
const safeBigIntMax = BigInt(safeMax)

type HostRandom = {
  (): number
  readonly fill: <T>(array: T) => T
  readonly uint32: () => number
  readonly integerInRange: (min: number, max: number) => number
  readonly bigintInRange: (min: bigint, max: bigint) => bigint
}

type MakeHostRandom = (seed: Timestamp) => HostRandom

const loadMakeRandom = async (): Promise<MakeHostRandom> => {
  const sourcePath = new URL(
    "../src/server/rng.ts",
    import.meta.resolve("spacetimedb"),
  ).href
  const module = (await import(sourcePath)) as {
    readonly makeRandom: MakeHostRandom
  }
  return module.makeRandom
}

describe("server random precision", () => {
  it("draws full-range integers through the host bigint surface", () => {
    const calls: Array<{ readonly min: bigint; readonly max: bigint }> = []
    const random = Object.assign(() => 0.5, {
      fill: <T>(array: T): T => array,
      uint32: () => 1,
      integerInRange: () => safeMin,
      bigintInRange: (min: bigint, max: bigint) => {
        calls.push({ min, max })
        return safeBigIntMax
      },
    })

    expect(makeServerRandom({ random }).nextIntUnsafe()).toBe(safeMax)
    expect(calls).toEqual([{ min: safeBigIntMin, max: safeBigIntMax }])
  })

  it("is deterministic and avoids the host integer reconstruction path", async () => {
    const makeRandom = await loadMakeRandom()
    const seed = new Timestamp(123_456_789n)
    const serverRandomA = makeServerRandom({ random: makeRandom(seed) })
    const serverRandomB = makeServerRandom({ random: makeRandom(seed) })
    const integerPathRandom = makeRandom(seed)
    const bigintPathRandom = makeRandom(seed)

    const drawsA = Array.from({ length: 12 }, () =>
      serverRandomA.nextIntUnsafe(),
    )
    const drawsB = Array.from({ length: 12 }, () =>
      serverRandomB.nextIntUnsafe(),
    )
    const integerPathDraws = Array.from({ length: 12 }, () =>
      integerPathRandom.integerInRange(safeMin, safeMax),
    )
    const bigintPathDraws = Array.from({ length: 12 }, () =>
      Number(bigintPathRandom.bigintInRange(safeBigIntMin, safeBigIntMax)),
    )

    expect(drawsA).toEqual(drawsB)
    expect(drawsA).toEqual(bigintPathDraws)
    expect(drawsA).not.toEqual(integerPathDraws)
    for (const draw of drawsA) {
      expect(Number.isInteger(draw)).toBe(true)
      expect(Number.isSafeInteger(draw)).toBe(true)
      expect(draw).toBeGreaterThanOrEqual(safeMin)
      expect(draw).toBeLessThanOrEqual(safeMax)
    }
  })
})
