import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SpacetimeDB from "spacetimedb"

const { expect } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import { TestLayer } from "../helpers/test-layer"
import { typeBuilder } from "../helpers/type-builder"

const describe = EffectVitest.layer(TestLayer)

type TableDefinition = {
  readonly defaultValues: ReadonlyArray<{
    readonly colId: number
    readonly value: Uint8Array
  }>
}

type TableSchema = {
  readonly tableDef: (context: unknown, accessorName: string) => TableDefinition
}

const normalizeDefaultValues = (definition: TableDefinition) =>
  definition.defaultValues.map((entry) => ({
    colId: entry.colId,
    value: Array.from(entry.value),
  }))

// The native runtime builders expose `.default()` for column defaults, but the
// contract-level builder type intentionally does not model it. Narrow
// structurally instead of casting.
type ColumnDefaultCapable = {
  readonly default: (
    value: unknown,
  ) => SpacetimeDB.TypeBuilder<unknown, SpacetimeDB.AlgebraicType>
}

const hasColumnDefault = (value: unknown): value is ColumnDefaultCapable =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  typeof Reflect.get(value, "default") === "function"

const tableDefContext = {
  moduleDef: {
    explicitNames: {
      entries: [],
    },
  },
  registerTypesRecursively: () => ({
    ref: {
      tag: "Ref",
      value: 0,
    },
  }),
}

const nativeTableDefinition = (name: string, row: unknown): TableDefinition =>
  (SpacetimeDB.table({ name }, row as never) as TableSchema).tableDef(
    tableDefContext,
    name,
  )

describe("native column defaults", (it) => {
  it.effect("serializes falsy column defaults through native tableDef", () =>
    Effect.gen(function* () {
      const row = SpacetimeDB.t.row({
        zero: SpacetimeDB.t.u32().default(0),
        no: SpacetimeDB.t.bool().default(false),
        empty: SpacetimeDB.t.string().default(""),
      })

      expect(
        normalizeDefaultValues(nativeTableDefinition("defaults", row)),
      ).toEqual([
        { colId: 0, value: [0, 0, 0, 0] },
        { colId: 1, value: [0] },
        { colId: 2, value: [0, 0, 0, 0] },
      ])
    }),
  )

  it.effect("serializes struct defaults through native product builders", () =>
    Effect.gen(function* () {
      const product = SpacetimeDB.t.object("Payload", {
        x: SpacetimeDB.t.u32(),
      })
      const row = SpacetimeDB.t.row({
        payload: product.default({ x: 0 }).name("payload_metadata"),
      })

      expect(
        normalizeDefaultValues(nativeTableDefinition("struct_defaults", row)),
      ).toEqual([{ colId: 0, value: [0, 0, 0, 0] }])
    }),
  )

  it.effect(
    "serializes string-literal enum defaults through native variant envelopes",
    () =>
      Effect.gen(function* () {
        const Channel = Stdb.literal("Dm", "Party")

        // Host materialization encodes the decoded default through the column schema.
        expect(yield* Schema.encodeEffect(Channel.schema)("Dm")).toEqual({
          tag: "Dm",
        })
        expect(yield* Schema.encodeEffect(Channel.schema)("Party")).toEqual({
          tag: "Party",
        })

        const channelBuilder: unknown = typeBuilder(Channel)
        expect(hasColumnDefault(channelBuilder)).toBe(true)
        if (!hasColumnDefault(channelBuilder)) {
          return
        }
        const row = SpacetimeDB.t.row({
          channel: channelBuilder.default({ tag: "Dm" }),
        })

        expect(
          normalizeDefaultValues(
            nativeTableDefinition("literal_defaults", row),
          ),
        ).toEqual([{ colId: 0, value: [0] }])
      }),
  )
})
