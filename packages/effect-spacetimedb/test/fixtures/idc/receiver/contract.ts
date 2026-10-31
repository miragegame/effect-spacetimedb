import * as Stdb from "effect-spacetimedb"
import { IdcFixtureInbox } from "../inbox.ts"

const PingLabelsLength: Stdb.ArrayLengthBounds = { minimum: 0, maximum: 16 }

export const pingLog = Stdb.table("pingLog", {
  columns: {
    id: Stdb.u64().primaryKey().autoInc(),
    sender: Stdb.identity(),
    note: Stdb.string(),
    labels: Stdb.array(Stdb.string(), PingLabelsLength),
  },
})

/**
 * The receiving side of the fixtures: it composes only the interface group,
 * so the binding generated from its bundle carries exactly the receivers.
 * `IDC_FIXTURE_TRUSTED_PEER` is the hex identity its guard admits.
 */
export const IdcReceiverModule = Stdb.StdbModule.make("idc_fixture_receiver", {
  environment: {
    IDC_FIXTURE_TRUSTED_PEER: Stdb.Environment.string(),
  },
})
  .addTables(pingLog)
  .add(IdcFixtureInbox)
