import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as FastCheck from "effect/testing/FastCheck"
import {
  IntegerTokenKey,
  isIntegerToken,
  isJsonRecord,
  markIntegerNumbers,
  parseJsonPreservingIntegers,
} from "../../src/client/http-json/http-json-parser.ts"

const { describe, expect, it } = EffectVitest

const parserPropertyOptions = {
  fastCheck: { numRuns: 100, seed: 0x1eaf_2026 },
} as const

const nonRepresentableIntegers = [
  2n ** 53n + 1n,
  2n ** 70n + 1n,
  BigInt(Number.MAX_SAFE_INTEGER) * 10n + 7n,
] as const

const floatLiterals = ["1.5", "-0.0", "2e3", "1.5E-4", "6.022e23"] as const

const nativeJsonParse = JSON["parse"].bind(JSON) as (body: string) => unknown

const jsonParseThrows = (body: string): boolean => {
  try {
    nativeJsonParse(body)
    return false
  } catch {
    return true
  }
}

const integerTokensToNumbers = (value: unknown): unknown => {
  if (isIntegerToken(value)) {
    return Number(value[IntegerTokenKey])
  }

  if (Array.isArray(value)) {
    return value.map(integerTokensToNumbers)
  }

  if (isJsonRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        integerTokensToNumbers(entry),
      ]),
    )
  }

  return value
}

const expectIntegerTokenDigits = (value: unknown): string => {
  expect(isIntegerToken(value)).toBe(true)
  return isIntegerToken(value) ? value[IntegerTokenKey] : ""
}

describe("HTTP JSON integer parser properties", () => {
  it.effect.prop(
    "agrees structurally with JSON.parse after integer tokens are normalized",
    [FastCheck.jsonValue()],
    ([value]) =>
      Effect.gen(function* () {
        const text = JSON.stringify(value)
        const parsed = yield* parseJsonPreservingIntegers(text)

        expect(integerTokensToNumbers(parsed)).toEqual(nativeJsonParse(text))
      }),
    parserPropertyOptions,
  )

  it.effect.prop(
    "is injective for nested reserved and escaped token keys",
    [FastCheck.jsonValue(), FastCheck.string()],
    ([nested, textValue]) =>
      Effect.gen(function* () {
        const value = {
          [IntegerTokenKey]: textValue,
          nested: {
            [IntegerTokenKey]: nested,
            [`$effectSpacetimeDbEscaped:${IntegerTokenKey}`]: textValue,
          },
        }
        const text = JSON.stringify(value)
        const parsed = yield* parseJsonPreservingIntegers(text)

        expect(integerTokensToNumbers(parsed)).toEqual(nativeJsonParse(text))
      }),
    parserPropertyOptions,
  )

  it.effect.prop(
    "preserves generated integer digit strings exactly",
    [FastCheck.bigInt()],
    ([integer]) =>
      Effect.gen(function* () {
        const text = integer.toString()
        const parsed = yield* parseJsonPreservingIntegers(text)

        expect(expectIntegerTokenDigits(parsed)).toBe(text)
      }),
    parserPropertyOptions,
  )

  it.effect(
    "preserves non-representable integers where JSON.parse loses precision",
    () =>
      Effect.forEach(
        nonRepresentableIntegers,
        Effect.fn(function* (integer) {
          const text = integer.toString()
          const parsed = yield* parseJsonPreservingIntegers(text)
          const tokenDigits = expectIntegerTokenDigits(parsed)

          expect(tokenDigits).toBe(text)
          expect(tokenDigits).not.toBe(String(nativeJsonParse(text)))
        }),
        { discard: true },
      ),
  )

  it.effect("leaves JSON float and exponent literals untokenized", () =>
    Effect.forEach(
      floatLiterals,
      Effect.fn(function* (text) {
        expect(markIntegerNumbers(text)).not.toContain(IntegerTokenKey)
        expect(yield* parseJsonPreservingIntegers(text)).toEqual(
          nativeJsonParse(text),
        )
      }),
      { discard: true },
    ),
  )

  it.effect.prop(
    "matches JSON.parse rejection parity",
    [FastCheck.string()],
    ([body]) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(parseJsonPreservingIntegers(body))

        expect(Exit.isFailure(exit)).toBe(jsonParseThrows(body))
      }),
    parserPropertyOptions,
  )

  it.effect("fails malformed JSON with a typed schema error", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parseJsonPreservingIntegers("{"))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.pipe(
          Cause.findErrorOption,
          Option.getOrUndefined,
        )
        expect(Schema.isSchemaError(failure)).toBe(true)
      }
    }),
  )

  it.effect("roundtrips the reserved integer-token shape as user data", () =>
    Effect.gen(function* () {
      const parsed = yield* parseJsonPreservingIntegers(
        `{"${IntegerTokenKey}":"123"}`,
      )

      expect(isIntegerToken(parsed)).toBe(false)
      expect(parsed).toEqual({ [IntegerTokenKey]: "123" })
    }),
  )
})
