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
    scheduleDeleteCandidate: Effect.fn(function* ({ note }) {
      const db = yield* Db
      const ctx = yield* MutationCtx
      yield* db.reducerSchedule.schedule({
        scheduledAt: Stdb.ScheduleAt.after(ctx.timestamp, "30 seconds"),
        note,
      })
    }),
    replaceScheduledReducerNote: Effect.fn(function* ({
      existingNote,
      replacementNote,
    }) {
      const db = yield* Db
      const ctx = yield* MutationCtx
      const schedules = yield* db.reducerSchedule.toArray()
      yield* Effect.forEach(
        schedules.filter((row) => row.note === existingNote),
        (row) => db.reducerSchedule.scheduledId.delete(row.scheduledId),
        { discard: true },
      )
      yield* db.reducerSchedule.schedule({
        scheduledAt: Stdb.ScheduleAt.after(ctx.timestamp, "2 seconds"),
        note: replacementNote,
      })
    }),
    reminderFireReducer: Effect.fn(function* ({ data }) {
      const db = yield* Db
      const ctx = yield* MutationCtx
      yield* db.scheduledResult.insert({
        id: 0n,
        target: "reducer",
        note: data.note,
        sender: ctx.sender.toHexString(),
        identity: ctx.identity.toHexString(),
        databaseIdentity: ctx.databaseIdentity.toHexString(),
      })
    }),
    reminderFireProcedure: Effect.fn(function* ({ data }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          const ctx = yield* MutationCtx
          yield* db.scheduledResult
            .insert({
              id: 0n,
              target: "procedure",
              note: data.note,
              sender: ctx.sender.toHexString(),
              identity: ctx.identity.toHexString(),
              databaseIdentity: ctx.databaseIdentity.toHexString(),
            })
            .pipe(Effect.asVoid)

          return undefined
        }),
      )
    }),
  },
)
