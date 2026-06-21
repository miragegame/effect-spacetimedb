// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - name goldens intentionally exercise raw type constructors.
import * as EffectVitest from "@effect/vitest"

const { describe, expect, it } = EffectVitest

import * as StdbTesting from "effect-spacetimedb/testing"
import { builderTypeName, typeBuilder } from "../helpers/type-builder"

const printGolden = (name: string, actual: string): void => {
  if (Bun.env.UPDATE_GOLDENS === "1") {
    process.stdout.write(`${name}: ${actual}\n`)
  }
}

const expectGolden = (
  name: string,
  actual: string | undefined,
  expected: string,
): void => {
  expect(actual).toBeDefined()
  if (actual !== undefined) {
    printGolden(name, actual)
    expect(actual).toBe(expected)
  }
}

describe("SATS type-name goldens", () => {
  it("keeps exact FNV digest outputs stable", () => {
    const fingerprint =
      StdbTesting.ContractTypeName.primitiveFingerprint("String")
    const digest =
      StdbTesting.ContractTypeName.stableStructuralDigest(fingerprint)

    expectGolden(
      "primitiveStringFingerprint",
      fingerprint,
      "t9:primitives6:String",
    )
    expectGolden(
      "primitiveStringDigest",
      digest,
      "53d7d849e43c146beacec74e18491a18",
    )
    expectGolden(
      "primitiveStringDecimalDigest",
      StdbTesting.ContractTypeName.decimalDigestSuffix(digest),
      "0604153523701416458716919679988306352664",
    )
  })

  it("keeps exact content-addressed generated names stable", () => {
    const Struct = StdbTesting.ContractType.struct({
      id: StdbTesting.ContractType.string(),
      count: StdbTesting.ContractType.u32(),
    })
    const Sum = StdbTesting.ContractType.sum({
      prose: StdbTesting.ContractType.struct({
        text: StdbTesting.ContractType.string(),
      }),
      untilRemoved: StdbTesting.ContractType.unit(),
    })
    const Literal = StdbTesting.ContractType.literal("joined", "left")
    const NonIdentifierLiteral = StdbTesting.ContractType.literal("edit-action")

    expectGolden(
      "structTypeName",
      builderTypeName(typeBuilder(Struct)),
      "EffectSpacetimeDbStruct1567071152418068970112741907769407762856",
    )
    expectGolden(
      "sumTypeName",
      builderTypeName(typeBuilder(Sum)),
      "EffectSpacetimeDbSum1044084748600119426007865466810697034335",
    )
    expectGolden(
      "literalTypeName",
      builderTypeName(typeBuilder(Literal)),
      "EffectSpacetimeDbEnum0077559484257204371700884911820393236990",
    )
    expectGolden(
      "nonIdentifierLiteralTypeName",
      builderTypeName(typeBuilder(NonIdentifierLiteral)),
      "EffectSpacetimeDbEnum0770607971548929519305528225978679347412",
    )
  })
})
