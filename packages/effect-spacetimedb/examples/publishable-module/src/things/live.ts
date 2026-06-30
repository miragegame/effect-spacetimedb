import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { Range } from "spacetimedb/server"
import { ThingAbortError } from "../errors"
import { Db, ExampleModule, HttpTx, ReadonlyDb, Tx } from "../module"
import type { ThingId } from "../schema"

class ThingPanicDefect extends Data.TaggedError("ThingPanicDefect") {}

const insertThing = Effect.fn(function* (args: {
  readonly thingId: ThingId
  readonly label: string
  readonly count: bigint
}) {
  const db = yield* Db
  yield* db.thing.insert({
    id: args.thingId,
    label: args.label,
    count: args.count,
  })
})

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
    thingClear: Effect.fn(function* () {
      const db = yield* Db
      yield* db.thing.clear()
    }),
    thingForceUpdate: Effect.fn(function* ({ thingId, label, count }) {
      const db = yield* Db
      yield* db.thing.id.update({
        id: thingId,
        label,
        count,
      })
    }),
    thingInsertThenAbort: Effect.fn(function* ({ thingId, label, count }) {
      yield* insertThing({ thingId, label, count })
      return yield* Effect.fail(ThingAbortError.make({ thingId }))
    }),
    thingInsertTwiceAtomic: Effect.fn(function* (args) {
      yield* insertThing({
        thingId: args.firstThingId,
        label: args.firstLabel,
        count: args.firstCount,
      })
      yield* insertThing({
        thingId: args.secondThingId,
        label: args.secondLabel,
        count: args.secondCount,
      })
    }),
    thingInsertTwiceThenAbort: Effect.fn(function* (args) {
      yield* insertThing({
        thingId: args.firstThingId,
        label: args.firstLabel,
        count: args.firstCount,
      })
      yield* insertThing({
        thingId: args.secondThingId,
        label: args.secondLabel,
        count: args.secondCount,
      })
      return yield* Effect.fail(
        ThingAbortError.make({ thingId: args.firstThingId }),
      )
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
    thingCount: Effect.fn(function* () {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* db.thing.count()
        }),
      )
    }),
    thingList: Effect.fn(function* () {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* db.thing.toArray()
        }),
      )
    }),
    thingByCountExact: Effect.fn(function* ({ count }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* db.thing.thingCountIdx.filterToArray(count)
        }),
      )
    }),
    thingByCountRange: Effect.fn(function* ({ lo, hi }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* db.thing.thingCountIdx.filterToArray(
            new Range(
              { tag: "included", value: lo },
              { tag: "included", value: hi },
            ),
          )
        }),
      )
    }),
    thingInsertTwiceInTx: Effect.fn(function* (args) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          yield* insertThing({
            thingId: args.firstThingId,
            label: args.firstLabel,
            count: args.firstCount,
          })
          yield* insertThing({
            thingId: args.secondThingId,
            label: args.secondLabel,
            count: args.secondCount,
          })
        }),
      )
    }),
    thingInsertInTxThenAbort: Effect.fn(function* ({ thingId, label, count }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          yield* insertThing({ thingId, label, count })
          return yield* Effect.fail(ThingAbortError.make({ thingId }))
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
