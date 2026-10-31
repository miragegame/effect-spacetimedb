import * as Stdb from "effect-spacetimedb"
import { IdcPairInbox } from "./inbox.ts"

/** Every note the receiver accepted, in arrival order. */
export const receivedNote = Stdb.table("receivedNote", {
  columns: {
    id: Stdb.u64().primaryKey().autoInc(),
    sender: Stdb.identity(),
    note: Stdb.string(),
  },
})

/**
 * The receiving database. It composes only its interface group, so its bundle
 * is also the interface fixture the sender's binding is generated from.
 * `IDC_PAIR_TRUSTED_SENDER` is the hex identity of the one database it admits;
 * until it is set, it admits none.
 */
export const IdcPairReceiverModule = Stdb.StdbModule.make("idc_pair_receiver", {
  environment: {
    IDC_PAIR_TRUSTED_SENDER: Stdb.Environment.optional(
      Stdb.Environment.string(),
    ),
  },
})
  .addTables(receivedNote)
  .add(IdcPairInbox)
