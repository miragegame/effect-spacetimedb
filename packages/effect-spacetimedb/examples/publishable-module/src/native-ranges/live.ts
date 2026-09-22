import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { Db, ExampleModule, Tx } from "../module"

export const NativeRangeFunctionsLive = Stdb.StdbBuilder.group(
  ExampleModule,
  "NativeRanges",
  {
    nativeRangeClear: Effect.fn(function* () {
      const db = yield* Db
      yield* db.nativeRangeEntry.clear()
    }),
    nativeRangeInsert: Effect.fn(function* ({ owner, happenedAt, label }) {
      const db = yield* Db
      yield* db.nativeRangeEntry.insert({
        id: 0n,
        owner,
        happenedAt,
        label,
      })
    }),
    nativeRangeByOwner: Effect.fn(function* ({ lo, hi }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          const rows =
            yield* db.nativeRangeEntry.nativeRangeEntryOwnerIdx.filterToArray({
              from: { tag: "included", value: lo },
              to: { tag: "excluded", value: hi },
            })
          return rows.map((row) => row.label)
        }),
      )
    }),
    nativeRangeByTimestamp: Effect.fn(function* ({ lo, hi }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          const rows =
            yield* db.nativeRangeEntry.nativeRangeEntryHappenedAtIdx.filterToArray(
              {
                from: { tag: "excluded", value: lo },
                to: { tag: "included", value: hi },
              },
            )
          return rows.map((row) => row.label)
        }),
      )
    }),
    optionalRangeClear: Effect.fn(function* () {
      const db = yield* Db
      yield* db.optionalRangeEntry.clear()
    }),
    optionalRangeInsert: Effect.fn(function* ({ rank, label }) {
      const db = yield* Db
      yield* db.optionalRangeEntry.insert({ id: 0n, rank, label })
    }),
    optionalRangeAfterUnset: Effect.fn(function* () {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          const rows =
            yield* db.optionalRangeEntry.optionalRangeEntryRankIdx.filterToArray(
              {
                from: { tag: "excluded", value: undefined },
                to: { tag: "unbounded" },
              },
            )
          return rows.map((row) => row.label)
        }),
      )
    }),
  },
)
