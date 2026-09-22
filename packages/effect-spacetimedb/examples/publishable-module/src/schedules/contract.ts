import * as Stdb from "effect-spacetimedb"
import { procedureSchedule, reducerSchedule, String255 } from "../schema"

export const ScheduleFunctions = Stdb.StdbGroup.make("Schedules")
  .add(
    Stdb.StdbFn.reducer("scheduleReducerNote", {
      params: Stdb.struct({
        note: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("scheduleProcedureNote", {
      params: Stdb.struct({
        note: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("scheduleIntervalReducerNote", {
      params: Stdb.struct({
        note: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("scheduleTooFar", {
      params: Stdb.struct({
        note: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("scheduleDeleteCandidate", {
      params: Stdb.struct({
        note: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("replaceScheduledReducerNote", {
      params: Stdb.struct({
        existingNote: String255,
        replacementNote: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.scheduledReducer("reminderFireReducer", {
      table: reducerSchedule,
    }),
  )
  .add(
    Stdb.StdbFn.scheduledProcedure("reminderFireProcedure", {
      table: procedureSchedule,
    }),
  )
