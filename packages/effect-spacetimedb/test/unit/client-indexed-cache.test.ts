import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { Identity, Timestamp } from "spacetimedb"
import { generatedArtifactShapeError } from "../../src/client/generated-artifact-shape.ts"
import { transform } from "../helpers/schema-transform.ts"

const { describe, expect, it } = EffectVitest

const DomainString = transform(Schema.String, Schema.String, {
  decode: (value) => value.toUpperCase(),
  encode: (value) => value.toLowerCase(),
})

const indexedRow = Stdb.table("indexedRow", {
  public: true,
  columns: {
    id: Stdb.string(DomainString).primaryKey(),
    tenant: Stdb.string(DomainString),
    sequence: Stdb.u64(),
  },
  indexes: [
    Stdb.index("byTenantSequence", ["tenant", "sequence"]),
    Stdb.index("byTenantId", ["tenant", "id"]),
  ],
  constraints: [
    Stdb.unique({ name: "tenantIdUnique", columns: ["tenant", "id"] }),
  ],
})

const IndexedModule =
  Stdb.StdbModule.make("indexed_client").addTables(indexedRow).spec

const nativeValueRow = Stdb.table("nativeValueRow", {
  public: true,
  columns: {
    id: Stdb.string(DomainString).primaryKey(),
    owner: Stdb.identity(),
    happenedAt: Stdb.timestamp(),
    optionalOwner: Stdb.option(Stdb.identity()),
  },
  indexes: [
    Stdb.index("byOwnerTimestamp", ["owner", "happenedAt"]),
    Stdb.index("byIdentityStamp", ["owner", "happenedAt", "optionalOwner"]),
  ],
  constraints: [
    Stdb.unique({
      name: "identityStampUnique",
      columns: ["owner", "happenedAt", "optionalOwner"],
    }),
  ],
})

const NativeValueModule = Stdb.StdbModule.make("native_value_client").addTables(
  nativeValueRow,
).spec

const hashIndexedRow = Stdb.table("hashIndexedRow", {
  public: true,
  columns: {
    id: Stdb.string(DomainString),
  },
  indexes: [Stdb.index("byIdHash", ["id"], { algorithm: "hash" })],
})
const HashIndexedModule = Stdb.StdbModule.make("hash_indexed_client").addTables(
  hashIndexedRow,
).spec

const directIndexedRow = Stdb.table("directIndexedRow", {
  public: true,
  columns: {
    id: Stdb.string(DomainString),
  },
  indexes: [Stdb.index("byIdDirect", ["id"], { algorithm: "direct" })],
})
const DirectIndexedModule = Stdb.StdbModule.make(
  "direct_indexed_client",
).addTables(directIndexedRow).spec

const reorderedUniqueRow = Stdb.table("reorderedUniqueRow", {
  public: true,
  columns: {
    id: Stdb.string(DomainString),
    tenant: Stdb.string(DomainString),
  },
  indexes: [Stdb.index("byIdTenant", ["id", "tenant"])],
  constraints: [
    Stdb.unique({
      name: "tenantIdUnique",
      columns: ["tenant", "id"],
    }),
  ],
})
const ReorderedUniqueModule = Stdb.StdbModule.make(
  "reordered_unique_client",
).addTables(reorderedUniqueRow).spec

type RawRow = StdbTesting.WsTableRow<typeof indexedRow>

class TestRange<T> {
  constructor(
    readonly from:
      | { readonly tag: "included"; readonly value: T }
      | { readonly tag: "excluded"; readonly value: T }
      | { readonly tag: "unbounded" },
    readonly to:
      | { readonly tag: "included"; readonly value: T }
      | { readonly tag: "excluded"; readonly value: T }
      | { readonly tag: "unbounded" },
  ) {}
}

const rows: ReadonlyArray<RawRow> = [
  { id: "row-a", tenant: "tenant-a", sequence: 1n },
  { id: "row-b", tenant: "tenant-a", sequence: 2n },
]

describe("client indexed cache", () => {
  it.effect(
    "uses native count/find/filter accessors and decodes only results",
    () =>
      Effect.gen(function* () {
        const findInputs: Array<unknown> = []
        const filterInputs: Array<unknown> = []
        const relation = {
          onInsert: () => undefined,
          removeOnInsert: () => undefined,
          onDelete: () => undefined,
          removeOnDelete: () => undefined,
          onUpdate: () => undefined,
          removeOnUpdate: () => undefined,
          iter: () => {
            throw new Error("whole-table iteration is forbidden")
          },
          count: () => 2n,
          id: {
            find: (value: unknown) => {
              findInputs.push(value)
              return rows[0]
            },
          },
          byTenantId: {
            find: (value: unknown) => {
              findInputs.push(value)
              return rows[1]
            },
          },
          byTenantSequence: {
            filter: (value: unknown) => {
              filterInputs.push(value)
              return rows.values()
            },
          },
        }
        const connection = {
          isActive: true,
          db: { indexedRow: relation },
          subscriptionBuilder: () => {
            throw new Error("subscription is not used")
          },
        }
        const client = StdbTesting.ClientWs.make({
          module: IndexedModule,
          connection,
        })

        expect(client.isActive()).toBe(true)
        connection.isActive = false
        expect(client.isActive()).toBe(false)
        expect(client.cache.tables.indexedRow.count()).toBe(2n)
        expect(yield* client.cache.tables.indexedRow.id.find("ROW-A")).toEqual({
          id: "ROW-A",
          tenant: "TENANT-A",
          sequence: 1n,
        })
        expect(
          yield* client.cache.tables.indexedRow.byTenantId.find({
            tenant: "TENANT-A",
            id: "ROW-B",
          }),
        ).toEqual({ id: "ROW-B", tenant: "TENANT-A", sequence: 2n })

        const range = new TestRange(
          { tag: "included", value: 1n } as const,
          { tag: "excluded", value: 3n } as const,
        )
        expect(
          yield* client.cache.tables.indexedRow.byTenantSequence.filter([
            "TENANT-A",
            range,
          ]),
        ).toHaveLength(2)
        expect(findInputs).toEqual(["row-a", ["tenant-a", "row-b"]])
        expect(filterInputs[0]).toEqual(["tenant-a", range])
        expect(Array.isArray(filterInputs[0])).toBe(true)
        if (Array.isArray(filterInputs[0])) {
          expect(filterInputs[0][1]).toBeInstanceOf(TestRange)
        }
      }),
  )

  it.effect(
    "encodes identity, timestamp, and option components for unique and ranged lookups",
    () =>
      Effect.gen(function* () {
        const owner = new Identity(11n)
        const optionalOwner = new Identity(12n)
        const happenedAt = new Timestamp(13n)
        const findInputs: Array<unknown> = []
        const filterInputs: Array<unknown> = []
        const rawRow = {
          id: "native-row",
          owner,
          happenedAt,
          optionalOwner,
        }
        const decodedRow = { ...rawRow, id: "NATIVE-ROW" }
        const relation = {
          onInsert: () => undefined,
          removeOnInsert: () => undefined,
          onDelete: () => undefined,
          removeOnDelete: () => undefined,
          onUpdate: () => undefined,
          removeOnUpdate: () => undefined,
          iter: () => [rawRow].values(),
          count: () => 1n,
          id: { find: () => rawRow },
          byIdentityStamp: {
            find: (value: unknown) => {
              findInputs.push(value)
              return rawRow
            },
          },
          byOwnerTimestamp: {
            filter: (value: unknown) => {
              filterInputs.push(value)
              return [rawRow].values()
            },
          },
        }
        const client = StdbTesting.ClientWs.make({
          module: NativeValueModule,
          connection: {
            isActive: true,
            db: { nativeValueRow: relation },
            subscriptionBuilder: () => {
              throw new Error("subscription is not used")
            },
          },
        })

        expect(
          yield* client.cache.tables.nativeValueRow.byIdentityStamp.find({
            owner,
            happenedAt,
            optionalOwner,
          }),
        ).toEqual(decodedRow)
        const range = new TestRange(
          { tag: "included", value: happenedAt } as const,
          { tag: "excluded", value: new Timestamp(20n) } as const,
        )
        expect(
          yield* client.cache.tables.nativeValueRow.byOwnerTimestamp.filter([
            owner,
            range,
          ]),
        ).toEqual([decodedRow])

        expect(findInputs).toEqual([[owner, happenedAt, optionalOwner]])
        expect(filterInputs).toHaveLength(1)
        expect(filterInputs[0]).toEqual([owner, range])
        if (Array.isArray(filterInputs[0])) {
          expect(filterInputs[0][1]).toBeInstanceOf(TestRange)
        }
      }),
  )

  it("reports hash indexes as typed generated-artifact errors", () => {
    const relation = {
      onInsert: () => undefined,
      removeOnInsert: () => undefined,
      onDelete: () => undefined,
      removeOnDelete: () => undefined,
      onUpdate: () => undefined,
      removeOnUpdate: () => undefined,
      iter: () => [].values(),
      count: () => 0n,
    }
    const error = generatedArtifactShapeError(
      StdbTesting.makeModulePlan(HashIndexedModule),
      {
        db: { hashIndexedRow: relation },
        disconnect: () => undefined,
        subscriptionBuilder: () => {
          throw new Error("subscription is not used")
        },
      },
    )

    expect(StdbTesting.GeneratedArtifactShapeError.is(error)).toBe(true)
    expect(error?.unsupportedIndexes).toEqual([
      "hashIndexedRow.byIdHash (hash)",
    ])
    expect(error?.missingKeys).toEqual([])
  })

  it("reports direct indexes before reading lazy generated table getters", () => {
    let relationReads = 0
    const relation = {
      onInsert: () => undefined,
      removeOnInsert: () => undefined,
      onDelete: () => undefined,
      removeOnDelete: () => undefined,
      onUpdate: () => undefined,
      removeOnUpdate: () => undefined,
      iter: () => [].values(),
      count: () => 0n,
    }
    const db = { directIndexedRow: relation }
    Object.defineProperty(db, "directIndexedRow", {
      enumerable: true,
      get: () => {
        relationReads += 1
        throw new Error("native table cache rejected direct index")
      },
    })
    const error = generatedArtifactShapeError(
      StdbTesting.makeModulePlan(DirectIndexedModule),
      {
        db,
        disconnect: () => undefined,
        subscriptionBuilder: () => {
          throw new Error("subscription is not used")
        },
      },
    )

    expect(StdbTesting.GeneratedArtifactShapeError.is(error)).toBe(true)
    expect(error?.unsupportedIndexes).toEqual([
      "directIndexedRow.byIdDirect (direct)",
    ])
    expect(relationReads).toBe(0)
  })

  it.effect(
    "keeps reversed composite indexes ranged like the native cache",
    () =>
      Effect.gen(function* () {
        const inputs: Array<unknown> = []
        const rawRow = { id: "row-a", tenant: "tenant-a" }
        const relation = {
          onInsert: () => undefined,
          removeOnInsert: () => undefined,
          onDelete: () => undefined,
          removeOnDelete: () => undefined,
          onUpdate: () => undefined,
          removeOnUpdate: () => undefined,
          iter: () => [rawRow].values(),
          count: () => 1n,
          byIdTenant: {
            filter: (value: unknown) => {
              inputs.push(value)
              return [rawRow].values()
            },
          },
        }
        const connection = {
          isActive: true,
          db: { reorderedUniqueRow: relation },
          subscriptionBuilder: () => {
            throw new Error("subscription is not used")
          },
        }
        const client = StdbTesting.ClientWs.make({
          module: ReorderedUniqueModule,
          connection,
        })

        expect(
          yield* client.cache.tables.reorderedUniqueRow.byIdTenant.filter([
            "ROW-A",
            "TENANT-A",
          ]),
        ).toEqual([{ id: "ROW-A", tenant: "TENANT-A" }])
        expect(inputs).toEqual([["row-a", "tenant-a"]])
        expect(
          generatedArtifactShapeError(
            StdbTesting.makeModulePlan(ReorderedUniqueModule),
            {
              ...connection,
              disconnect: () => undefined,
            },
          ),
        ).toBeUndefined()
      }),
  )
})
