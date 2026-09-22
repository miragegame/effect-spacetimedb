import * as Stdb from "effect-spacetimedb"
import { constraintEntry, String255, ThingId, U64 } from "../schema"

const ConstraintEntryParams = Stdb.struct({
  id: String255,
  slug: String255,
  tenantId: String255,
  email: String255,
  note: String255,
})

export const ConstraintEntryFunctions = Stdb.StdbGroup.make("ConstraintEntries")
  .add(
    Stdb.StdbFn.reducer("constraintEntryInsert", {
      params: ConstraintEntryParams,
    }),
  )
  .add(
    Stdb.StdbFn.reducer("constraintEntryUpdate", {
      params: ConstraintEntryParams,
    }),
  )
  .add(
    Stdb.StdbFn.procedure("constraintEntryGet", {
      params: Stdb.struct({ id: String255 }),
      returns: Stdb.option(constraintEntry.row),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("constraintEntryConflictThenCommit", {
      params: Stdb.struct({
        id: String255,
        slug: String255,
        tenantId: String255,
        email: String255,
        note: String255,
        markerThingId: Stdb.string(ThingId),
        markerLabel: String255,
        markerCount: U64,
      }),
      returns: Stdb.unit(),
    }),
  )
