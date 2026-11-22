import * as Stdb from "effect-spacetimedb"
import { serialEntry } from "../schema"

export const SerialEntryFunctions = Stdb.Group.make("SerialEntries")
  .add(
    Stdb.Fn.reducer("serialEntryClear", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.Fn.reducer("serialEntryInsert", {
      params: Stdb.struct({
        label: Stdb.string(),
        plainSerial: Stdb.u64(),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("serialEntryRenumber", {
      params: Stdb.struct({ label: Stdb.string() }),
    }),
  )
  .add(
    Stdb.Fn.procedure("serialEntryList", {
      params: Stdb.struct({}),
      returns: Stdb.array(serialEntry.row),
    }),
  )
