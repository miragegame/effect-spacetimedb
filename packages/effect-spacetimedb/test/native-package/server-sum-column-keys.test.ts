import * as EffectVitest from "@effect/vitest"
import { withHostDatastoreModule } from "./fixtures/host-module-bundle"

const { describe, expect, it } = EffectVitest

type SumValue = { readonly tag: string; readonly value?: unknown }

type SumKeyProbe = {
  readonly primaryKeyMethods: ReadonlyArray<string>
  readonly indexMethods: ReadonlyArray<string>
  readonly foundUnitVariant: SumValue | null
  readonly foundPayloadVariant: SumValue | null
  readonly missingVariant: SumValue | null
  readonly filteredPayloadVariant: ReadonlyArray<number>
  readonly filteredUnitVariant: ReadonlyArray<number>
  readonly deletedByPrimaryKey: boolean
  readonly remainingProgress: ReadonlyArray<SumValue>
}

const moduleSource = [
  `import { schema, t, table } from "spacetimedb/server"`,
  `import { configure, moduleHooks, reset } from "spacetime:sys@2.0"`,
  `const progress = table({}, t.row({`,
  `  status: t.enum("Status", { Ready: t.unit(), Retrying: t.u32() }).primaryKey(),`,
  `  note: t.u32(),`,
  `}))`,
  `const marker = table({}, t.row({`,
  `  kind: t.enum("Kind", { Ping: t.unit(), Chunk: t.u32() }).index("btree"),`,
  `  seq: t.u32(),`,
  `}))`,
  `const testSchema = schema({ progress, marker })`,
  `let observed = {}`,
  `const useSumKeys = testSchema.reducer({}, (ctx) => {`,
  `  ctx.db.progress.insert({ status: { tag: "Ready" }, note: 1 })`,
  `  ctx.db.progress.insert({ status: { tag: "Retrying", value: 7 }, note: 2 })`,
  `  ctx.db.progress.insert({ status: { tag: "Retrying", value: 9 }, note: 3 })`,
  `  ctx.db.marker.insert({ kind: { tag: "Ping" }, seq: 10 })`,
  `  ctx.db.marker.insert({ kind: { tag: "Chunk", value: 4 }, seq: 11 })`,
  `  ctx.db.marker.insert({ kind: { tag: "Chunk", value: 4 }, seq: 12 })`,
  `  ctx.db.marker.insert({ kind: { tag: "Chunk", value: 5 }, seq: 13 })`,
  `  const primaryKeyMethods = Object.keys(ctx.db.progress.status)`,
  `  const indexMethods = Object.keys(ctx.db.marker.kind)`,
  `  const foundUnitVariant = ctx.db.progress.status.find({ tag: "Ready" })`,
  `  const foundPayloadVariant = ctx.db.progress.status.find({`,
  `    tag: "Retrying",`,
  `    value: 9,`,
  `  })`,
  `  const missingVariant = ctx.db.progress.status.find({`,
  `    tag: "Retrying",`,
  `    value: 8,`,
  `  })`,
  `  const filteredPayloadVariant = Array.from(`,
  `    ctx.db.marker.kind.filter({ tag: "Chunk", value: 4 }),`,
  `    (row) => row.seq,`,
  `  )`,
  `  const filteredUnitVariant = Array.from(`,
  `    ctx.db.marker.kind.filter({ tag: "Ping" }),`,
  `    (row) => row.seq,`,
  `  )`,
  `  const deletedByPrimaryKey = ctx.db.progress.status.delete({`,
  `    tag: "Retrying",`,
  `    value: 7,`,
  `  })`,
  `  observed = {`,
  `    primaryKeyMethods,`,
  `    indexMethods,`,
  `    foundUnitVariant: foundUnitVariant?.status ?? null,`,
  `    foundPayloadVariant: foundPayloadVariant?.status ?? null,`,
  `    missingVariant: missingVariant?.status ?? null,`,
  `    filteredPayloadVariant,`,
  `    filteredUnitVariant,`,
  `    deletedByPrimaryKey,`,
  `    remainingProgress: Array.from(ctx.db.progress.iter(), (row) => row.status),`,
  `  }`,
  `})`,
  `export const probe = () => {`,
  `  reset()`,
  `  configure({`,
  `    indexes: {`,
  `      progress_status_idx_btree: { table: "progress" },`,
  `      marker_kind_idx_btree: { table: "marker" },`,
  `    },`,
  `  })`,
  `  const hooks = testSchema[moduleHooks]({ useSumKeys })`,
  `  hooks.__call_reducer__(0, 0n, 0n, 0n, new DataView(new ArrayBuffer(0)))`,
  `  return observed`,
  `}`,
]

describe("sum-typed column keys", () => {
  it("keys a primary key and a btree index by a payload-carrying sum", async () => {
    const observed = await withHostDatastoreModule(
      "sum-column-keys",
      moduleSource,
      (loaded) => (loaded.probe as () => SumKeyProbe)(),
    )

    expect(observed.primaryKeyMethods).toContain("find")
    expect(observed.primaryKeyMethods).not.toContain("filter")
    expect(observed.indexMethods).toContain("filter")
    expect(observed.indexMethods).not.toContain("find")

    // A unit variant round-trips with its empty product payload.
    expect(observed.foundUnitVariant).toEqual({ tag: "Ready", value: {} })
    expect(observed.foundPayloadVariant).toEqual({ tag: "Retrying", value: 9 })
    // A different payload under the same variant tag is a different key.
    expect(observed.missingVariant).toBeNull()

    expect(observed.filteredPayloadVariant).toEqual([11, 12])
    expect(observed.filteredUnitVariant).toEqual([10])

    expect(observed.deletedByPrimaryKey).toBe(true)
    expect(observed.remainingProgress).toEqual([
      { tag: "Ready", value: {} },
      { tag: "Retrying", value: 9 },
    ])
  })
})
