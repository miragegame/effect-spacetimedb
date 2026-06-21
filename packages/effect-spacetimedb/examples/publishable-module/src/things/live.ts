import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { Db, ExampleModule, HttpTx, ReadonlyDb, Tx } from "../module"

class ThingPanicDefect extends Data.TaggedError("ThingPanicDefect") {}

export const ThingFunctionsLive = Stdb.StdbBuilder.group(
  ExampleModule,
  "Things",
  {
    thingSet: Effect.fn(function* ({ thingId, label, count }) {
      const db = yield* Db
      const row = {
        id: thingId,
        label,
        count,
      }

      if ((yield* db.thing.id.find(thingId)) === undefined) {
        yield* db.thing.insert(row)
        return
      }

      yield* db.thing.id.update(row)
    }),
    thingDelete: Effect.fn(function* ({ thingId }) {
      const db = yield* Db
      yield* db.thing.id.delete(thingId)
    }),
    thingNoop: Effect.fn(function* () {}),
    thingPanic: Effect.fn(function* () {
      return yield* Effect.die(new ThingPanicDefect())
    }),
    thingGet: Effect.fn(function* ({ thingId }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          return (yield* db.thing.id.find(thingId)) ?? undefined
        }),
      )
    }),
    thingOutcome: Effect.fn(function* ({ thingId }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          const row = yield* db.thing.id.find(thingId)

          return row != null
            ? {
                ok: row,
              }
            : {
                err: "thing missing",
              }
        }),
      )
    }),
    allThings: Effect.fn(function* () {
      const db = yield* ReadonlyDb
      return yield* db.thing.toArray()
    }),
  },
)

export const ThingRoutesLive = Stdb.StdbBuilder.group(
  ExampleModule,
  "ThingHttp",
  {
    thingPing: Effect.fn(function* ({ thingId }) {
      const tx = yield* HttpTx
      return yield* tx.run(
        Effect.succeed({
          thingId,
          status: "ok" as const,
        }),
      )
    }),
  },
)
