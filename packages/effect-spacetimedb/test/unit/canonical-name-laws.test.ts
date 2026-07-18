import * as EffectVitest from "@effect/vitest"
import * as FastCheck from "effect/testing/FastCheck"
import * as StdbTesting from "effect-spacetimedb/testing"

const { describe, expect, it } = EffectVitest

const purePropertyOptions = {
  fastCheck: { numRuns: 300, seed: 0xca0a501 },
} as const

const { canonicalNameForPolicy, snakeCaseName, splitWords } =
  StdbTesting.ContractCanonicalName

const nameArbitrary = FastCheck.oneof(
  FastCheck.stringMatching(/^[A-Za-z0-9_ -]{0,24}$/),
  FastCheck.constantFrom(
    "",
    "HTTPServer",
    "XMLHttpRequest",
    "foo2Bar",
    "FOO__--  BAR",
    "CreatePlayer1",
    "a1b",
    "already_snake_case",
  ),
)

describe("canonical name laws", () => {
  it.prop(
    "snakeCaseName is idempotent",
    [nameArbitrary],
    ([name]) => {
      expect(snakeCaseName(snakeCaseName(name))).toBe(snakeCaseName(name))
    },
    purePropertyOptions,
  )

  it.prop(
    "snakeCaseName preserves lowercase word sequence",
    [nameArbitrary],
    ([name]) => {
      expect(splitWords(snakeCaseName(name))).toEqual(
        splitWords(name).map((word) => word.toLowerCase()),
      )
    },
    purePropertyOptions,
  )

  it.prop(
    "canonicalNameForPolicy routes to the selected policy",
    [nameArbitrary],
    ([name]) => {
      expect(canonicalNameForPolicy("none", name)).toBe(name)
      expect(canonicalNameForPolicy("snake_case", name)).toBe(
        snakeCaseName(name),
      )
      expect(canonicalNameForPolicy(undefined, name)).toBe(snakeCaseName(name))
    },
    purePropertyOptions,
  )
})
