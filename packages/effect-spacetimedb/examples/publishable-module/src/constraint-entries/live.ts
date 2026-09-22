import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { Db, ExampleModule, Tx } from "../module"

export const ConstraintEntryFunctionsLive = Stdb.StdbBuilder.group(
  ExampleModule,
  "ConstraintEntries",
  {
    constraintEntryInsert: Effect.fn(function* (entry) {
      const db = yield* Db
      yield* db.constraintEntry.insert(entry)
    }),
    constraintEntryUpdate: Effect.fn(function* (entry) {
      const db = yield* Db
      yield* db.constraintEntry.id.update(entry)
    }),
    constraintEntryGet: Effect.fn(function* ({ id }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          return (yield* db.constraintEntry.id.find(id)) ?? undefined
        }),
      )
    }),
    constraintEntryConflictThenCommit: Effect.fn(function* (params) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          yield* db.constraintEntry.id
            .update({
              id: params.id,
              slug: params.slug,
              tenantId: params.tenantId,
              email: params.email,
              note: params.note,
            })
            .pipe(
              Effect.catchTag("StdbUniqueAlreadyExistsError", () =>
                db.thing
                  .insert({
                    id: params.markerThingId,
                    label: params.markerLabel,
                    count: params.markerCount,
                  })
                  .pipe(Effect.asVoid),
              ),
            )
        }),
      )
    }),
  },
)
