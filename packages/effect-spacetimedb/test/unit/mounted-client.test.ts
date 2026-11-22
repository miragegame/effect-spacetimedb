import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { makeModulePlan } from "effect-spacetimedb/testing/internal"
import { orderedNamespaceBindings } from "../../src/codegen/support.ts"
import { generatedArtifactShapeError } from "../../src/client/generated-artifact-shape.ts"
import { targetQuerySource } from "../../src/client/websocket-contract.ts"
import { App } from "../../examples/mounted-module/contract.ts"

const { expect, it } = EffectVitest
const projected = Stdb.project(App)

it("projects frozen accessor namespaces and keeps wire names on their targets", () => {
  const stock = projected.targets.tables.stockRoom
  expect(Object.getPrototypeOf(stock)).toBeNull()
  expect(Object.isFrozen(stock.auditTrail)).toBe(true)
  expect(Object.keys(stock).sort()).toEqual(["auditTrail", "storedItem"])
  expect(stock.auditTrail.entry).toMatchObject({
    key: "stockRoom.auditTrail.entry",
    name: "stock_room.audit_trail.entry",
  })
  expect(projected.targets.tables).not.toHaveProperty("tools")
  const http = projected.client.http.make({
    uri: "http://localhost",
    databaseName: "warehouse",
  })
  expect(Object.keys(http.reducers.stockRoom)).toEqual(["queueItem"])
  expect(Object.keys(http.procedures.stockRoom)).toEqual(["save_item"])
})

it.effect("renders qualified SQL one identifier at a time", () =>
  Effect.gen(function* () {
    expect(
      yield* targetQuerySource(
        projected.targets.tables.stockRoom.auditTrail.entry,
      ),
    ).toBe('SELECT * FROM "stock_room"."audit_trail"."entry"')
    expect(
      yield* targetQuerySource(
        projected.targets.views.stockRoom.matchingItems({ id: 42 }),
      ),
    ).toBe('SELECT * FROM "stock_room"."matching_items"(42)')
  }),
)

it("resolves generated relation and index paths through every namespace", () => {
  const db = Object.assign(Object.create(null), {
    "stockRoom.storedItem": {},
    stockRoom: {
      auditTrail: {
        taggedItem: { count: () => 0, entry_id: { find: () => undefined } },
      },
    },
  })
  const error = generatedArtifactShapeError(makeModulePlan(App.spec), {
    db,
    disconnect: () => {},
    subscriptionBuilder: () => {
      throw new Error("not subscribing")
    },
  })
  expect(error?.missingKeys).toEqual(
    expect.arrayContaining([
      "stockRoom.storedItem",
      "stockRoom.auditTrail.entry",
      "stockRoom.auditTrail.tagged_item.by_bucket.filter",
    ]),
  )
  expect(error?.missingKeys).not.toContain(
    "stockRoom.auditTrail.tagged_item.entry_id.find",
  )
})

it.effect(
  "orders generated namespace siblings without reordering their wire fields",
  () =>
    Effect.gen(function* () {
      const generated = (keys: readonly string[]) =>
        [
          "// Import namespace table schema definitions",
          ...keys.map((key) => `import ${key}Row from "./stock/${key}_table";`),
          "const tablesSchema = __schema({",
          ...keys.map((key) =>
            [
              `  "stock.${key}": __table({`,
              `    name: 'stock.${key}',`,
              "    indexes: [{ columns: ['z', 'a'] }],",
              `  }, ${key}Row),`,
            ].join("\n"),
          ),
          "});",
          "export const tables = {",
          "  stock: {",
          ...keys.map((key) => `    ${key}: __qb["stock.${key}"],`),
          "  },",
          "} as const;",
        ].join("\n")
      const ordered = generated(["receipt", "shipment"])
      expect(
        yield* orderedNamespaceBindings(generated(["shipment", "receipt"])),
      ).toBe(ordered)
    }),
)

it.effect(
  "rejects an unfamiliar generated namespace format before bundling",
  () =>
    Effect.gen(function* () {
      const changed =
        "// Import namespace table schema definitions\nimport { Row } from './stock/items'\n"
      const failure = yield* Effect.flip(orderedNamespaceBindings(changed))
      expect(failure.message).toContain(
        "Unrecognized generated namespace entries",
      )
    }),
)
