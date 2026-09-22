import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"
import { typeBuilder } from "../helpers/type-builder"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const { annotateValueTypeSchema, applyFieldOptions, tableFieldOptions } =
  StdbTesting.ContractType

/**
 * The exact global key and payload published `effect-spacetimedb@0.6.0` writes
 * for table field options — `package/src/contract/type/core.ts:833-843` and
 * `package/src/contract/schema-annotations.ts:10-12` in the npm tarball. Note
 * `defaultValue`, which this version spells `valueDefault`.
 */
const LegacyAnnotationKey = Symbol.for("effect-spacetimedb/StdbFieldOptions")

const legacyPayload = {
  primaryKey: true,
  autoInc: false,
  unique: true,
  index: "btree",
  optional: false,
  hasDefault: true,
  defaultValue: "published-0.6.0-default",
  name: "legacy_column_name",
} as const

/** The key this version writes; a payload under it carries its own `version`. */
const VersionedAnnotationKey = Symbol.for(
  "effect-spacetimedb/StdbFieldOptions/versioned",
)

const legacyAnnotatedValue = () =>
  annotateValueTypeSchema(Stdb.string(), LegacyAnnotationKey, legacyPayload)

const futureAnnotatedValue = () =>
  annotateValueTypeSchema(Stdb.string(), VersionedAnnotationKey, {
    ...legacyPayload,
    version: 99,
    valueDefault: "from-the-future",
  })

class FieldOptionsContractReadFailure extends Data.TaggedError(
  "FieldOptionsContractReadFailure",
)<{
  readonly cause: unknown
}> {}

/**
 * Runs a synchronous contract read and yields whatever it threw; a read that
 * does not throw yields `undefined`, which fails the caller's assertion loudly.
 */
const failureOf = (read: () => void): Effect.Effect<unknown> =>
  Effect.try({
    try: read,
    catch: (cause) => new FieldOptionsContractReadFailure({ cause }),
  }).pipe(
    Effect.match({
      onFailure: (failure) => failure.cause,
      onSuccess: () => undefined,
    }),
  )

const messageOf = (failure: unknown): string =>
  failure instanceof Error
    ? failure.message
    : `<not an Error: ${String(failure)}>`

describe("field options annotation version boundary", (it) => {
  it.effect(
    "rejects a table field annotated by published effect-spacetimedb 0.6.0",
    () =>
      Effect.gen(function* () {
        const failure = yield* failureOf(() =>
          tableFieldOptions(legacyAnnotatedValue()),
        )

        expect(failure).toBeInstanceOf(Stdb.StdbFieldOptionsVersionError)
        expect(
          Predicate.isTagged("StdbFieldOptionsVersionError")(failure),
        ).toBe(true)
        const message = messageOf(failure)
        expect(message).toContain("annotation payload version 1")
        expect(message).toContain("0.6.x")
        expect(message).toContain("annotation payload version 2")
        expect(message).toContain(
          "deduplicate effect-spacetimedb to one version",
        )
      }),
  )

  it.effect("rejects a 0.6.0 annotation from struct field reads", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(() =>
        StdbTesting.ContractType.structFieldOptions(legacyAnnotatedValue()),
      )

      expect(failure).toBeInstanceOf(Stdb.StdbFieldOptionsVersionError)
    }),
  )

  it.effect("rejects a 0.6.0 annotation from table construction", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(() =>
        Stdb.table("legacyAnnotationTable", {
          columns: { id: legacyAnnotatedValue() },
        }),
      )

      expect(failure).toBeInstanceOf(Stdb.StdbFieldOptionsVersionError)
      expect(messageOf(failure)).toContain("annotation payload version 1")
    }),
  )

  it.effect(
    "surfaces the version boundary when a struct lowers a 0.6.0 field to SATS",
    () =>
      Effect.gen(function* () {
        // Lowering wraps authoring throws in StdbTypeLoweringError, which
        // interpolates the cause's message; the boundary stays visible.
        const failure = yield* failureOf(() => {
          typeBuilder(Stdb.struct({ legacy: legacyAnnotatedValue() }))
        })

        expect(failure).toBeInstanceOf(Error)
        expect(messageOf(failure)).toContain(
          "deduplicate effect-spacetimedb to one version",
        )
      }),
  )

  it.effect("rejects an unknown future annotation payload version", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(() =>
        tableFieldOptions(futureAnnotatedValue()),
      )

      expect(failure).toBeInstanceOf(Stdb.StdbFieldOptionsVersionError)
      const message = messageOf(failure)
      expect(message).toContain("annotation payload version 99")
      expect(message).toContain("annotation payload version 2")
      expect(message).toContain("deduplicate effect-spacetimedb to one version")
    }),
  )

  it.effect("rejects a payload under our key that carries no version", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(() =>
        tableFieldOptions(
          annotateValueTypeSchema(Stdb.string(), VersionedAnnotationKey, {
            primaryKey: false,
          }),
        ),
      )

      expect(failure).toBeInstanceOf(Stdb.StdbFieldOptionsVersionError)
      expect(messageOf(failure)).toContain("annotation payload version unknown")
    }),
  )

  it.effect("reads an unannotated value as the default options", () =>
    Effect.gen(function* () {
      expect(tableFieldOptions(Stdb.string())).toStrictEqual({
        primaryKey: false,
        autoInc: false,
        unique: false,
        index: undefined,
        optional: false,
        hasDefault: false,
        valueDefault: undefined,
        name: undefined,
      })
    }),
  )

  it.effect("round-trips every table field option at the current version", () =>
    Effect.gen(function* () {
      expect(
        tableFieldOptions(
          applyFieldOptions(Stdb.u64(), { primaryKey: true, autoInc: true }),
        ),
      ).toStrictEqual({
        primaryKey: true,
        autoInc: true,
        unique: false,
        index: undefined,
        optional: false,
        hasDefault: false,
        valueDefault: undefined,
        name: undefined,
      })

      expect(
        tableFieldOptions(
          applyFieldOptions(Stdb.string(), {
            unique: true,
            index: "btree",
            optional: true,
            default: "roundtrip",
            name: "custom_column_name",
          }),
        ),
      ).toStrictEqual({
        primaryKey: false,
        autoInc: false,
        unique: true,
        index: "btree",
        optional: true,
        hasDefault: true,
        valueDefault: "roundtrip",
        name: "custom_column_name",
      })
    }),
  )

  it.effect("round-trips every index algorithm at the current version", () =>
    Effect.gen(function* () {
      expect(
        (["btree", "hash", "direct"] as const).map(
          (algorithm) =>
            tableFieldOptions(
              applyFieldOptions(Stdb.u32(), { index: algorithm }),
            ).index,
        ),
      ).toStrictEqual(["btree", "hash", "direct"])
    }),
  )

  it.effect("round-trips struct field optionality at the current version", () =>
    Effect.gen(function* () {
      expect(
        StdbTesting.ContractType.structFieldOptions(
          Stdb.optional(Stdb.string()),
        ),
      ).toStrictEqual({ optional: true })
      expect(
        StdbTesting.ContractType.structFieldOptions(Stdb.string()),
      ).toStrictEqual({ optional: false })
    }),
  )

  it.effect("never leaks the payload version into normalized options", () =>
    Effect.gen(function* () {
      expect(
        Object.keys(
          tableFieldOptions(applyFieldOptions(Stdb.string(), { unique: true })),
        ),
      ).not.toContain("version")
    }),
  )
})
