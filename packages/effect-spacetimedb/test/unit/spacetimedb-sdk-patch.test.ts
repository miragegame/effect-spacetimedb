import * as EffectVitest from "@effect/vitest"
import {
  ClientCache as RootClientCache,
  schema,
  table,
  TimeDuration,
  Timestamp,
  t,
  Uuid,
} from "spacetimedb"
import { ClientCache as SdkClientCache } from "spacetimedb/sdk"

const { describe, expect, it } = EffectVitest

const nativeRangeTable = table(
  {
    name: "nativeRange",
    indexes: [
      {
        accessor: "byBytes",
        name: "native_range_bytes_idx_btree",
        algorithm: "btree",
        columns: ["bytes"],
      },
      {
        accessor: "byDuration",
        name: "native_range_duration_idx_btree",
        algorithm: "btree",
        columns: ["duration"],
      },
      {
        accessor: "byTimestamp",
        name: "native_range_timestamp_idx_btree",
        algorithm: "btree",
        columns: ["timestamp"],
      },
      {
        accessor: "byUuid",
        name: "native_range_uuid_idx_btree",
        algorithm: "btree",
        columns: ["uuid"],
      },
    ],
  },
  t.row({
    id: t.u64().primaryKey(),
    bytes: t.byteArray(),
    duration: t.timeDuration(),
    timestamp: t.timestamp(),
    uuid: t.uuid(),
  }),
)
const nativeRangeSchema = schema({
  nativeRange: nativeRangeTable,
})
const nativeRangeTableDef = nativeRangeSchema.schemaType.tables.nativeRange

const included = <Value>(value: Value) => ({ tag: "included", value }) as const

const equalRange = <Value>(value: Value) => ({
  from: included(value),
  to: included(value),
})

const exerciseNativeRanges = (
  Cache: typeof RootClientCache | typeof SdkClientCache,
): ReadonlyArray<number> => {
  const cache = new Cache()
  // The published SDK's generated TableToSchema type is not assignable to its
  // own exact-optional UntypedTableDef constraint; this is a runtime patch probe.
  const relation = cache.getOrCreateTable(nativeRangeTableDef as never)
  relation.insert(undefined as never, {
    type: "insert",
    rowId: 1n,
    row: {
      id: 1n,
      bytes: new Uint8Array([0x01, 0x10]),
      duration: new TimeDuration(2_000_000n),
      timestamp: new Timestamp(3_000n),
      uuid: new Uuid(4n),
    },
  })

  return [
    Array.from(
      relation.byBytes!.filter(equalRange(new Uint8Array([0x01, 0x10]))),
    ).length,
    Array.from(
      relation.byDuration!.filter(equalRange(new TimeDuration(2_000_000n))),
    ).length,
    Array.from(relation.byTimestamp!.filter(equalRange(new Timestamp(3_000n))))
      .length,
    Array.from(relation.byUuid!.filter(equalRange(new Uuid(4n)))).length,
  ]
}

describe("SpaceTimeDB 2.6.1 cache patch", () => {
  it("keeps native scalar ranges working through root and sdk exports", () => {
    expect(exerciseNativeRanges(RootClientCache)).toEqual([1, 1, 1, 1])
    expect(exerciseNativeRanges(SdkClientCache)).toEqual([1, 1, 1, 1])
  })
})
