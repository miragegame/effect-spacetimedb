import * as EffectVitest from "@effect/vitest"
import * as Result from "effect/Result"
import { Identity } from "spacetimedb"
import {
  identityEquals,
  IdentityFormatError,
  normalizeIdentity,
} from "../../src/index.ts"

const { describe, expect, it } = EffectVitest

const one = "0".repeat(63) + "1"
const max = "f".repeat(64)

const expectNormalized = (input: unknown, expected: string): void => {
  const result = normalizeIdentity(input)
  expect(Result.isSuccess(result)).toBe(true)
  if (Result.isSuccess(result)) {
    expect(result.success).toBe(expected)
  }
}

describe("identity normalization", () => {
  it("canonicalizes native, bigint, prefix, and case variants", () => {
    expectNormalized(new Identity(1n), one)
    expectNormalized(1n, one)
    expectNormalized(`0x${one}`, one)
    expectNormalized(max.toUpperCase(), max)
    expect(identityEquals(new Identity(1n), 1n)).toBe(true)
    expect(identityEquals(one.toUpperCase(), `0x${one}`)).toBe(true)
    expect(identityEquals(1n, new Identity(2n))).toBe(false)
    expect(identityEquals(new Identity(2n), 1n)).toBe(false)
  })

  it("canonicalizes an Identity from the SDK's server entry", () => {
    // A module bundle holds a second Identity class (the server entry's), and
    // host contexts carry instances of it: same field, different class.
    class ServerEntryIdentity {
      readonly __identity__: bigint
      constructor(value: bigint) {
        this.__identity__ = value
      }
      toHexString(): string {
        return this.__identity__.toString(16).padStart(64, "0")
      }
    }
    const sender = new ServerEntryIdentity(1n)
    expect(sender instanceof Identity).toBe(false)
    expectNormalized(sender, one)
    expect(identityEquals(sender, one)).toBe(true)
    expect(identityEquals(sender, new Identity(1n))).toBe(true)
    expect(identityEquals(sender, new ServerEntryIdentity(2n))).toBe(false)
  })

  it("rejects malformed, negative, oversized, and unsupported inputs", () => {
    const invalid = [
      "1",
      `0X${one}`,
      "g".repeat(64),
      -1n,
      1n << 256n,
      { __identity__: 1n },
    ]
    for (const value of invalid) {
      const result = normalizeIdentity(value)
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(IdentityFormatError)
      }
      expect(identityEquals(value, value)).toBe(false)
    }
  })
})
