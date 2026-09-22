import * as EffectVitest from "@effect/vitest"
import { withHostDatastoreModule } from "./fixtures/host-module-bundle"

const { describe, expect, it } = EffectVitest

type Pair = readonly [string, string]

type CompositeScanProbe = {
  readonly fullWidthRange: ReadonlyArray<Pair>
  readonly prefixArray: ReadonlyArray<Pair>
  readonly prefixScalar: ReadonlyArray<Pair>
  readonly unboundedTail: ReadonlyArray<Pair>
  readonly deletedByRange: number
  readonly remaining: ReadonlyArray<Pair>
}

const moduleSource = [
  `import { Range, schema, t, table } from "spacetimedb/server"`,
  `import { configure, moduleHooks, reset } from "spacetime:sys@2.0"`,
  `const affinity = table({`,
  `  name: "affinity",`,
  `  indexes: [`,
  `    { accessor: "byPoolStamp", algorithm: "btree", columns: ["pool", "stamp"] },`,
  `  ],`,
  `}, t.row({ pool: t.u64(), stamp: t.u64() }))`,
  `const testSchema = schema({ affinity })`,
  `let observed = {}`,
  `const toPairs = (rows) =>`,
  `  Array.from(rows, (row) => [String(row.pool), String(row.stamp)])`,
  `const stampRange = () =>`,
  `  new Range({ tag: "included", value: 20n }, { tag: "excluded", value: 40n })`,
  `const scanIndexes = testSchema.reducer({}, (ctx) => {`,
  `  for (const [pool, stamp] of [`,
  `    [1n, 10n], [1n, 20n], [1n, 30n], [1n, 40n], [2n, 20n], [2n, 30n],`,
  `  ]) {`,
  `    ctx.db.affinity.insert({ pool, stamp })`,
  `  }`,
  `  const fullWidthRange = toPairs(`,
  `    ctx.db.affinity.byPoolStamp.filter([1n, stampRange()]),`,
  `  )`,
  `  const prefixArray = toPairs(ctx.db.affinity.byPoolStamp.filter([1n]))`,
  `  const prefixScalar = toPairs(ctx.db.affinity.byPoolStamp.filter(2n))`,
  `  const unboundedTail = toPairs(`,
  `    ctx.db.affinity.byPoolStamp.filter([`,
  `      2n,`,
  `      new Range({ tag: "included", value: 25n }, null),`,
  `    ]),`,
  `  )`,
  `  const deletedByRange = ctx.db.affinity.byPoolStamp.delete([1n, stampRange()])`,
  `  const remaining = toPairs(ctx.db.affinity.iter())`,
  `  observed = {`,
  `    fullWidthRange,`,
  `    prefixArray,`,
  `    prefixScalar,`,
  `    unboundedTail,`,
  `    deletedByRange,`,
  `    remaining,`,
  `  }`,
  `})`,
  `export const probe = () => {`,
  `  reset()`,
  `  configure({`,
  `    indexes: {`,
  `      affinity_pool_stamp_idx_btree: {`,
  `        table: "affinity",`,
  `        keyOffset: 0,`,
  `        termKind: "u64",`,
  `      },`,
  `    },`,
  `  })`,
  `  const hooks = testSchema[moduleHooks]({ scanIndexes })`,
  `  hooks.__call_reducer__(0, 0n, 0n, 0n, new DataView(new ArrayBuffer(0)))`,
  `  return observed`,
  `}`,
]

describe("composite btree index scans", () => {
  it("returns exactly the rows a prefix or trailing range selects", async () => {
    const observed = await withHostDatastoreModule(
      "composite-index-ranges",
      moduleSource,
      (loaded) => (loaded.probe as () => CompositeScanProbe)(),
    )

    // A full-width key whose final column is a `Range` is a range scan over
    // that column with equality on the preceding prefix, not a point lookup.
    expect(observed.fullWidthRange).toEqual([
      ["1", "20"],
      ["1", "30"],
    ])

    // A one-column prefix of a two-column index scans the whole prefix, whether
    // it is supplied as a single-element array or as a bare scalar.
    expect(observed.prefixArray).toEqual([
      ["1", "10"],
      ["1", "20"],
      ["1", "30"],
      ["1", "40"],
    ])
    expect(observed.prefixScalar).toEqual([
      ["2", "20"],
      ["2", "30"],
    ])

    expect(observed.unboundedTail).toEqual([["2", "30"]])

    expect(observed.deletedByRange).toBe(2)
    expect(observed.remaining).toEqual([
      ["1", "10"],
      ["1", "40"],
      ["2", "20"],
      ["2", "30"],
    ])
  })
})
