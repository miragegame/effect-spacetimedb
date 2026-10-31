import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

// The interface the receiver exposes to other databases: one group of
// receivers. The receiver implements it; the sender declares an outbox against
// it through the binding generated from the receiver's bundle. It lives apart
// from that binding, which the receiver's own bundle must not import.

/** The calling database is not the one this receiver trusts. */
export class IdcPairUnknownSender extends Schema.TaggedError<IdcPairUnknownSender>()(
  "IdcPairUnknownSender",
  {},
) {}

/** The receiver refuses a note with nothing in it. */
export class IdcPairBlankNote extends Schema.TaggedError<IdcPairBlankNote>()(
  "IdcPairBlankNote",
  {},
) {}

export const IdcPairInbox = Stdb.StdbGroup.make("IdcPairInbox", {
  errors: Stdb.errors(IdcPairUnknownSender, IdcPairBlankNote),
}).add(
  // Called as `receive_note`. Parameter names are single lowercase words so
  // the call's signature does not depend on either module's case policy.
  Stdb.StdbFn.receiver("receiveNote", {
    params: Stdb.struct({ note: Stdb.string() }),
  }),
)
