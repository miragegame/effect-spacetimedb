import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { IdcFixtureInboxInterface } from "../interface.ts"

/** Bound to a small size so a test can overflow it with one long note. */
export const pingOutboxRowBytesMax = 512

export const pingOutbox = Stdb.outboxTable("pingOutbox", {
  interface: IdcFixtureInboxInterface,
  reducer: "receivePing",
  rowBytesMax: pingOutboxRowBytesMax,
  // Local only: never sent, read back by the settle reducer.
  columns: { requestId: Stdb.string() },
})

export const detailsOutbox = Stdb.outboxTable("detailsOutbox", {
  interface: IdcFixtureInboxInterface,
  reducer: "receiveDetails",
})

/** What each settle reducer saw, one row per settled outbox row. */
export const settlement = Stdb.table("settlement", {
  columns: {
    id: Stdb.u64().primaryKey().autoInc(),
    outbox: Stdb.string(),
    msgId: Stdb.u64(),
    requestId: Stdb.string(),
    outcome: Stdb.string(),
  },
})

/** A ping too large for its outbox, refused to the caller of `sendPing`. */
export class FixturePingTooLarge extends Schema.TaggedError<FixturePingTooLarge>()(
  "FixturePingTooLarge",
  { rowBytes: Schema.Int },
) {}

export const IdcSenderSends = Stdb.StdbGroup.make("IdcSenderSends", {
  errors: Stdb.errors(FixturePingTooLarge),
}).add(
  Stdb.StdbFn.reducer("sendPing", {
    params: Stdb.struct({ note: Stdb.string(), requestId: Stdb.string() }),
  }),
  Stdb.StdbFn.reducer("sendDetails", {
    params: Stdb.struct({
      body: Stdb.string(),
      labels: Stdb.array(Stdb.string(), { minimum: 0, maximum: 16 }),
    }),
  }),
)

export const IdcSenderSettles = Stdb.StdbGroup.make("IdcSenderSettles").add(
  Stdb.StdbFn.outboxResult("pingSettled", { table: pingOutbox }),
  Stdb.StdbFn.outboxResult("detailsSettled", { table: detailsOutbox }),
)

/**
 * The sending side of the fixtures. `IDC_FIXTURE_PEER` is the hex identity of
 * the receiving database: its peer resolver reads it, never a call argument.
 */
export const IdcSenderModule = Stdb.StdbModule.make("idc_fixture_sender", {
  environment: {
    IDC_FIXTURE_PEER: Stdb.Environment.string(),
  },
})
  .addTables(pingOutbox, detailsOutbox, settlement)
  .add(IdcSenderSends)
  .add(IdcSenderSettles)
