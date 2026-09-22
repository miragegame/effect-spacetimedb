import * as EffectVitest from "@effect/vitest"
import * as FastCheck from "fast-check"
import * as StdbTesting from "effect-spacetimedb/testing"

const { describe, expect, it } = EffectVitest

const purePropertyParameters = { numRuns: 300, seed: 0xca0a501 }

const {
  camelCaseName,
  canonicalNameForPolicy,
  isCamelCaseCanonical,
  snakeCaseName,
  splitWords,
} = StdbTesting.ContractCanonicalName

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

/**
 * Names that pass the contract's declared-name validation, which requires every
 * table, view, column and function key to be a camelCase canonical fixed point.
 */
const declaredNameArbitrary = nameArbitrary
  .map(camelCaseName)
  .filter(isCamelCaseCanonical)

describe("canonical name laws", () => {
  it("snakeCaseName is idempotent", () => {
    FastCheck.assert(
      FastCheck.property(nameArbitrary, (name) => {
        expect(snakeCaseName(snakeCaseName(name))).toBe(snakeCaseName(name))
      }),
      purePropertyParameters,
    )
  })

  it("snakeCaseName preserves lowercase word sequence", () => {
    FastCheck.assert(
      FastCheck.property(nameArbitrary, (name) => {
        expect(splitWords(snakeCaseName(name))).toEqual(
          splitWords(name).map((word) => word.toLowerCase()),
        )
      }),
      purePropertyParameters,
    )
  })

  it("canonicalNameForPolicy routes to the selected policy", () => {
    FastCheck.assert(
      FastCheck.property(nameArbitrary, (name) => {
        expect(canonicalNameForPolicy("none", name)).toBe(name)
        expect(canonicalNameForPolicy("snake_case", name)).toBe(
          snakeCaseName(name),
        )
        expect(canonicalNameForPolicy(undefined, name)).toBe(
          snakeCaseName(name),
        )
      }),
      purePropertyParameters,
    )
  })

  it("camelCaseName ignores the snake_case detour", () => {
    FastCheck.assert(
      FastCheck.property(nameArbitrary, (name) => {
        expect(camelCaseName(snakeCaseName(name))).toBe(camelCaseName(name))
      }),
      purePropertyParameters,
    )
  })

  // SpacetimeDB's TypeScript generator keys `db`, `tables` and `tablesSchema`
  // by `accessor_name.to_case(Case::Camel)` — the same rule for tables and for
  // views — and a relation's accessor name is the name our compiler exports it
  // under, i.e. its wire name. Declared names are required to be camelCase
  // canonical, so camelCasing the wire name of either policy hands back the
  // contract key: indexing a generated client by contract key never lands on a
  // deprecated alias.
  it("a declared name is its own generated accessor key under every name policy", () => {
    FastCheck.assert(
      FastCheck.property(declaredNameArbitrary, (declared) => {
        expect(camelCaseName(canonicalNameForPolicy("none", declared))).toBe(
          declared,
        )
        expect(
          camelCaseName(canonicalNameForPolicy("snake_case", declared)),
        ).toBe(declared)
        expect(camelCaseName(canonicalNameForPolicy(undefined, declared))).toBe(
          declared,
        )
      }),
      purePropertyParameters,
    )
  })
})
