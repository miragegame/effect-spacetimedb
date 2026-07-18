
import * as EffectVitest from "@effect/vitest"
import * as Schema from "effect/Schema"

const { describe, expect, it } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"

const diagnosticCodes = (body: () => unknown): ReadonlyArray<string> => {
  try {
    body()
    return []
  } catch (error) {
    return error instanceof Stdb.StdbValidationError
      ? error.diagnostics.map((diagnostic) => diagnostic.code)
      : []
  }
}

describe("contract robustness", () => {
  it("rejects every nested-option construction form", () => {
    const inner = Stdb.option(Stdb.string())

    expect(() => Stdb.option(inner)).toThrow(/wrap the inner option/u)
    expect(() => Stdb.optional(inner)).toThrow(/wrap the inner option/u)
    expect(() =>
      StdbTesting.ContractType.field(inner, { optional: true }),
    ).toThrow(/wrap the inner option/u)
  })

  it("rejects empty sums and mixed literal kinds at construction", () => {
    expect(() => Stdb.sum({})).toThrow(/at least one variant/u)
    expect(() => Stdb.literal("one", 2)).toThrow(/same primitive kind/u)
  })

  it("keeps decode-ambiguity checks enabled when style checks are disabled", () => {
    expect(
      diagnosticCodes(
        () =>
          Stdb.StdbModule.make("none_policy_collision", {
            settings: { caseConversionPolicy: "none" },
          }).add(
            Stdb.StdbGroup.make("Actions").add(
              Stdb.StdbFn.reducer("run", {
                params: Stdb.struct({
                  value: Stdb.sum({
                    fooBar: Stdb.unit(),
                    FooBar: Stdb.unit(),
                  }),
                }),
              }),
            ),
          ).spec,
      ),
    ).toContain("CanonicalNameCollision")

    expect(
      () =>
        Stdb.StdbModule.make("none_policy_style", {
          settings: { caseConversionPolicy: "none" },
        }).addTables(
          Stdb.table("authored_table", {
            columns: { authored_field: Stdb.string() },
          }),
        ).spec,
    ).not.toThrow()
  })

  it("validates effective native column names and rename collisions", () => {
    const codesFor = (
      columns: Record<string, Stdb.AnyValueType>,
      settings: { readonly caseConversionPolicy?: "none" } = {},
    ) =>
      diagnosticCodes(
        () =>
          Stdb.StdbModule.make("native_column_names", {
            settings,
          }).addTables(Stdb.table("records", { columns })).spec,
      )

    expect(
      codesFor({
        left: Stdb.string().name("same_name"),
        right: Stdb.string().name("same_name"),
      }),
    ).toContain("DuplicateNativeColumnName")
    expect(
      codesFor({
        displayName: Stdb.string(),
        alias: Stdb.string().name("display_name"),
      }),
    ).toContain("DuplicateNativeColumnName")
    expect(
      codesFor({
        value: Stdb.string().name("not-a-native-name"),
      }),
    ).toContain("InvalidNativeColumnName")
    expect(
      codesFor({
        scheduledId: Stdb.string().name("scheduled_id"),
        scheduledAt: Stdb.string().name("scheduled_at"),
      }),
    ).toEqual([])
    expect(
      codesFor(
        {
          fooBar: Stdb.string(),
          foo_bar: Stdb.string(),
        },
        { caseConversionPolicy: "none" },
      ),
    ).not.toContain("DuplicateNativeColumnName")
    expect(
      codesFor(
        {
          "not-valid": Stdb.string(),
        },
        { caseConversionPolicy: "none" },
      ),
    ).toContain("InvalidNativeColumnName")
  })

  it("throws descriptive errors for malformed descriptor metadata", () => {
    const malformed = StdbTesting.ContractType.attachStdbType(
      Schema.String,
      (factories) => factories.string(),
      { kind: "array" },
    )

    expect(() =>
      StdbTesting.ContractTypeDescriptor.describe(malformed),
    ).toThrow("Malformed SpaceTimeDB array type metadata: missing item")

    const undefinedItem = StdbTesting.ContractType.attachStdbType(
      Schema.String,
      (factories) => factories.string(),
      { kind: "array" },
    )
    const info = StdbTesting.ContractType.typeInfo(undefinedItem)
    if (info == null) {
      throw new Error("Expected attached SpaceTimeDB type metadata")
    }
    Object.defineProperty(info, "item", { value: undefined })

    expect(() =>
      StdbTesting.ContractTypeDescriptor.describe(undefinedItem),
    ).toThrow("Malformed SpaceTimeDB array type metadata: missing item")
  })

  it("pins the documented custom-codec wire-shape mismatch", () => {
    const mismatched = Stdb.custom(Schema.Finite, { type: Stdb.string() })

    expect(() =>
      Schema.decodeUnknownSync(mismatched.schema)("wire text"),
    ).toThrow()
    expect(StdbTesting.ContractType.typeInfo(mismatched)?.item).toBeDefined()
  })

  it("renders diagnostic identity and identifier failure reasons", () => {
    const diagnostic = new Stdb.StdbDiagnostic({
      code: "InvalidNativeColumnName",
      path: ["tables", "records", "columns", "value"],
      message: "bad name",
      severity: "error",
    })
    expect(Stdb.formatModuleDiagnostics([diagnostic])).toBe(
      "[InvalidNativeColumnName] tables.records.columns.value: bad name",
    )
    expect(() =>
      StdbTesting.ContractType.validateSatsTypeIdentifier("not-valid"),
    ).toThrow(/valid SATS type identifier/u)
    expect(() =>
      StdbTesting.ContractType.validateSatsTypeIdentifier("class"),
    ).toThrow(/reserved/u)
  })
})
