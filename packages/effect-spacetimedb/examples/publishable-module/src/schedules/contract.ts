import * as Stdb from "effect-spacetimedb"
import { procedureSchedule, reducerSchedule } from "../schema"

export const ScheduleFunctions = Stdb.Group.make("Schedules")
  .add(
    Stdb.Fn.reducer("scheduleReducerNote", {
      params: Stdb.struct({
        note: Stdb.string(),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("scheduleProcedureNote", {
      params: Stdb.struct({
        note: Stdb.string(),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("scheduleIntervalReducerNote", {
      params: Stdb.struct({
        note: Stdb.string(),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("scheduleTooFar", {
      params: Stdb.struct({
        note: Stdb.string(),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("scheduleDeleteCandidate", {
      params: Stdb.struct({
        note: Stdb.string(),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("replaceScheduledReducerNote", {
      params: Stdb.struct({
        existingNote: Stdb.string(),
        replacementNote: Stdb.string(),
      }),
    }),
  )
  .add(
    Stdb.Fn.scheduledReducer("reminderFireReducer", {
      table: reducerSchedule,
    }),
  )
  .add(
    Stdb.Fn.scheduledProcedure("reminderFireProcedure", {
      table: procedureSchedule,
    }),
  )
