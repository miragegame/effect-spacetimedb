import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

// The interface group of the inter-database-call fixtures. It lives apart from
// `binding.ts` because the receiver bundle the binding is generated from must
// not import that binding.

export class FixtureUnknownPeer extends Schema.TaggedError<FixtureUnknownPeer>()(
  "FixtureUnknownPeer",
  {},
) {}

export class FixtureRejected extends Schema.TaggedError<FixtureRejected>()(
  "FixtureRejected",
  { note: Schema.String },
) {}

const DetailLabelsLength: Stdb.ArrayLengthBounds = { minimum: 0, maximum: 16 }

/** A named nested type, so the binding carries an interface-scoped type name. */
export const PingDetails = Stdb.struct({
  labels: Stdb.array(Stdb.string(), DetailLabelsLength),
  state: Stdb.literal("ready", "deferred"),
}).named("PingDetails")

export const IdcFixtureInbox = Stdb.StdbGroup.make("IdcFixtureInbox", {
  errors: Stdb.errors(FixtureUnknownPeer, FixtureRejected),
}).add(
  Stdb.StdbFn.receiver("receivePing", {
    params: Stdb.struct({ note: Stdb.string() }),
  }),
  Stdb.StdbFn.receiver("receiveDetails", {
    params: Stdb.struct({ body: Stdb.string(), details: PingDetails }),
  }),
)

/** The receiver refuses a ping whose note is this text. */
export const refusedNote = "refuse"
