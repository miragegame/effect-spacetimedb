import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import type * as StdbServer from "effect-spacetimedb/server"

const Status = Stdb.sum({
  Ready: Stdb.unit(),
  Retrying: Stdb.u32(),
})

const Kind = Stdb.enum("Ping", "Chunk")

const progress = Stdb.table("progress", {
  columns: {
    status: Status.primaryKey(),
    kind: Kind.index("btree"),
    seq: Stdb.u32(),
  },
  indexes: [
    Stdb.index({
      name: "byKindSeq",
      columns: ["kind", "seq"],
      algorithm: "btree",
    }),
    Stdb.index({
      name: "byKindHash",
      columns: ["kind"],
      algorithm: "hash",
    }),
  ],
})

const ProgressModule = Stdb.StdbModule.make("sum_column_keys", {}).addTables(
  progress,
)

declare const db: StdbServer.DbService<typeof ProgressModule.spec>

export const readSumKeyedRows = Effect.gen(function* () {
  // A payload-carrying sum is a legal primary key.
  const found = yield* db.progress.status.find({
    tag: "Retrying",
    value: 3,
  })
  void found

  // A plain enum is a legal btree and hash index member, alone and as the
  // leading column of a composite index.
  const byKind = yield* db.progress.kind.filterToArray({ tag: "Ping" })
  void byKind

  const byKindSeq = yield* db.progress.byKindSeq.filterToArray([
    { tag: "Chunk" },
    7,
  ])
  void byKindSeq

  const byKindSeqRange = yield* db.progress.byKindSeq.filterToArray([
    { tag: "Chunk" },
    { from: { tag: "included", value: 1 }, to: { tag: "excluded", value: 9 } },
  ])
  void byKindSeqRange

  const byKindHash = yield* db.progress.byKindHash.filterToArray({
    tag: "Ping",
  })
  void byKindHash
})
