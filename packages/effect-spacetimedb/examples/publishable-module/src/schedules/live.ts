import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { Db, ExampleModule, MutationCtx, Tx } from "../module"

export const ScheduleFunctionsLive = Stdb.StdbBuilder.group(
  ExampleModule,
  "Schedules",
  {
    scheduleReducerNote: Effect.fn(function* ({ note }) {
      const db = yield* Db
      const ctx = yield* MutationCtx
      yield* db.reducerSchedule.schedule({
        scheduledAt: Stdb.ScheduleAt.after(ctx.timestamp, "1 second"),
        note,
      })
    }),
    scheduleProcedureNote: Effect.fn(function* ({ note }) {
      const db = yield* Db
      const ctx = yield* MutationCtx
      yield* db.procedureSchedule.schedule({
        scheduledAt: Stdb.ScheduleAt.after(ctx.timestamp, "1 second"),
        note,
      })
    }),
    scheduleIntervalReducerNote: Effect.fn(function* ({ note }) {
      const db = yield* Db
      yield* db.reducerSchedule.schedule({
        scheduledAt: Stdb.ScheduleAt.interval("1 second"),
        note,
      })
    }),
    scheduleTooFar: Effect.fn(function* ({ note }) {
      const db = yield* Db
      const ctx = yield* MutationCtx
      yield* db.reducerSchedule.schedule({
        scheduledAt: Stdb.ScheduleAt.after(ctx.timestamp, "1000000 days"),
        note,
      })
    }),
    reminderFireReducer: Effect.fn(function* ({ data }) {
      const db = yield* Db
      yield* db.scheduledResult.insert({
        id: 0n,
        target: "reducer",
        note: data.note,
      })
    }),
    reminderFireProcedure: Effect.fn(function* ({ data }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          yield* db.scheduledResult
            .insert({
              id: 0n,
              target: "procedure",
              note: data.note,
            })
            .pipe(Effect.asVoid)

          return undefined
        }),
      )
    }),
  },
)
