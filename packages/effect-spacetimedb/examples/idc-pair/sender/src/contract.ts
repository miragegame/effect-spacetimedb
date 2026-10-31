import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { PairInboxInterface } from "./interface.ts"

/** Notes waiting to reach the receiver, one call each, in insertion order. */
export const noteOutbox = Stdb.outboxTable("noteOutbox", {
  interface: PairInboxInterface,
  reducer: "receiveNote",
  rowBytesMax: 4 * 1024,
})

/** How the receiver answered each note, written by the settle reducer. */
export const noteDelivery = Stdb.table("noteDelivery", {
  columns: {
    msgId: Stdb.u64().primaryKey(),
    note: Stdb.string(),
    delivered: Stdb.bool(),
    /** The receiver's refusal text; empty when delivered. */
    message: Stdb.string(),
    /** Who ran the settle reducer: the host, as the zero identity. */
    settledBy: Stdb.identity(),
  },
})

/** A note too large for one outbox row, refused to the caller. */
export class IdcPairNoteTooLarge extends Schema.TaggedError<IdcPairNoteTooLarge>()(
  "IdcPairNoteTooLarge",
  { rowBytes: Schema.Int },
) {}

export const IdcPairSends = Stdb.StdbGroup.make("IdcPairSends", {
  errors: Stdb.errors(IdcPairNoteTooLarge),
}).add(
  Stdb.StdbFn.reducer("sendNote", {
    params: Stdb.struct({ note: Stdb.string() }),
  }),
)

export const IdcPairSettles = Stdb.StdbGroup.make("IdcPairSettles").add(
  Stdb.StdbFn.outboxResult("noteSettled", { table: noteOutbox }),
)

/**
 * The sending database. `IDC_PAIR_RECEIVER` is the receiver's hex identity:
 * its peer resolver reads it, never a call argument.
 */
export const IdcPairSenderModule = Stdb.StdbModule.make("idc_pair_sender", {
  environment: {
    IDC_PAIR_RECEIVER: Stdb.Environment.string(),
  },
})
  .addTables(noteOutbox, noteDelivery)
  .add(IdcPairSends)
  .add(IdcPairSettles)
