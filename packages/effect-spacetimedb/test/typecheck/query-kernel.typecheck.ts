import * as StdbTesting from "effect-spacetimedb/testing"
import * as Stdb from "effect-spacetimedb"
import { FullModule } from "../fixtures/full-module"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const Full = Stdb.project(FullModule)

const session = StdbTesting.ClientWs.make({
  module: FullModule,
  connection: makeFullModuleWsConnection(),
})

void session.subscribe(Full.targets.tables.user)
void session.subscribe(Full.targets.eventTables.presenceEvent)
void session.subscribe(Full.targets.allPublicTables())
void session.streamTarget(Full.targets.tables.user)
void session.streamTarget(Full.targets.eventTables.presenceEvent)
void session.streamTable("user", {
  buffer: { bufferSize: 8, strategy: "dropping" },
})
void session.streamRows("user")
void session.streamTableWithContext("user", {
  buffer: { bufferSize: 8, strategy: "sliding" },
})
void session.streamEventTable("presenceEvent", {
  buffer: { bufferSize: 8 },
})
void session.streamTarget(Full.targets.tables.user, {
  buffer: { bufferSize: 8, strategy: "sliding" },
})
void session.streamTarget(Full.targets.eventTables.presenceEvent, {
  buffer: { bufferSize: 8 },
})

// @ts-expect-error unsafe callback offers do not support suspending backpressure
void session.streamTable("user", { buffer: { strategy: "suspend" } })

void session.streamEventTable("presenceEvent", {
  buffer: {
    // @ts-expect-error event-table streams only accept buffer capacity, not a snapshot overflow strategy
    strategy: "dropping",
  },
})

void session.streamTarget(Full.targets.eventTables.presenceEvent, {
  buffer: {
    // @ts-expect-error event-table targets only accept buffer capacity, not a snapshot overflow strategy
    strategy: "sliding",
  },
})

// @ts-expect-error private tables must not be exposed as projected targets
void Full.targets.tables.reminder

// @ts-expect-error aggregate all-public-table targets are no longer part of the ws stream surface
void session.streamTarget(Full.targets.allPublicTables())

// @ts-expect-error private tables must not be accepted by streamTable
void session.streamTable("reminder")

// @ts-expect-error private tables must not be accepted by streamRows
void session.streamRows("reminder")

// @ts-expect-error event tables do not expose row snapshot streams
void session.streamRows("presenceEvent")

// @ts-expect-error public ws clients no longer expose manual invalidation
void session.invalidate
