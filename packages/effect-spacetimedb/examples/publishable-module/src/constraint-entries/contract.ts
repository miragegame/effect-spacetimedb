import * as Stdb from "effect-spacetimedb"
import { constraintEntry, ThingId, U64 } from "../schema"

const ConstraintEntryParams = Stdb.struct({
  id: Stdb.string(),
  slug: Stdb.string(),
  tenantId: Stdb.string(),
  email: Stdb.string(),
  note: Stdb.string(),
})

export const ConstraintEntryFunctions = Stdb.Group.make("ConstraintEntries")
  .add(
    Stdb.Fn.reducer("constraintEntryInsert", {
      params: ConstraintEntryParams,
    }),
  )
  .add(
    Stdb.Fn.reducer("constraintEntryUpdate", {
      params: ConstraintEntryParams,
    }),
  )
  .add(
    Stdb.Fn.procedure("constraintEntryGet", {
      params: Stdb.struct({ id: Stdb.string() }),
      returns: Stdb.option(constraintEntry.row),
    }),
  )
  .add(
    Stdb.Fn.procedure("constraintEntryConflictThenCommit", {
      params: Stdb.struct({
        id: Stdb.string(),
        slug: Stdb.string(),
        tenantId: Stdb.string(),
        email: Stdb.string(),
        note: Stdb.string(),
        markerThingId: Stdb.string(ThingId),
        markerLabel: Stdb.string(),
        markerCount: U64,
      }),
      returns: Stdb.unit(),
    }),
  )
