import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { Db, ExampleModule, Tx } from "../module"

export const SerialEntryFunctionsLive = Stdb.Builder.group(
  ExampleModule,
  "SerialEntries",
  {
    serialEntryClear: Effect.fn(function* () {
      const db = yield* Db
      yield* db.serialEntry.clear()
    }),
    // A zero asks the host for the column's next value; any other value stays.
    serialEntryInsert: Effect.fn(function* ({ label, plainSerial }) {
      const db = yield* Db
      yield* db.serialEntry.insert({
        label,
        plainSerial,
        uniqueSerial: 0,
        indexedSerial: 0n,
      })
    }),
    // An update generates too, so a row can take a fresh serial in place.
    serialEntryRenumber: Effect.fn(function* ({ label }) {
      const db = yield* Db
      const row = yield* db.serialEntry.label.find(label)
      if (row !== undefined) {
        yield* db.serialEntry.label.update({ ...row, plainSerial: 0n })
      }
    }),
    serialEntryList: Effect.fn(function* () {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* db.serialEntry.toArray()
        }),
      )
    }),
  },
)
