import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, UserId } from "../fixtures/full-module"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const Full = Stdb.project(FullModule)
const userId = Schema.decodeUnknownSync(UserId)("user-1")
const FilterString = Schema.String.pipe(Schema.check(Schema.isMaxLength(100)))

const filterShape = Stdb.table("filterShape", {
  public: true,
  columns: {
    id: Stdb.string(UserId),
    labels: FilterString.pipe(Stdb.string, Stdb.array),
    nickname: FilterString.pipe(Stdb.string, Stdb.option),
  },
})
const FilterShapeModule = Stdb.StdbModule.make("filter_shape", {}).addTables(
  filterShape,
).spec
const FilterShape = Stdb.project(FilterShapeModule)

const session = StdbTesting.ClientWs.make({
  module: FullModule,
  connection: makeFullModuleWsConnection(),
})

void session.subscribe(Full.targets.tables.user)
void session.subscribe(Full.targets.eventTables.presenceEvent)
void session.subscribe(Full.targets.allPublicTables())
void session.subscribe(
  Full.targets.tables.user.where((row) => row.id.eq(userId)),
)
void session.subscribe(
  Full.targets.eventTables.presenceEvent.where((row) => row.userId.eq(userId)),
)

const userQuery = Full.targets.tables.user.where((row) => row.id.eq(userId))

// @ts-expect-error query target keys and predicates must describe the same table
const mismatchedQuery: Parameters<typeof session.subscribe>[0] = {
  ...userQuery,
  key: Full.targets.eventTables.presenceEvent.key,
  name: Full.targets.eventTables.presenceEvent.name,
}

void mismatchedQuery
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

// @ts-expect-error non-scalar columns cannot be used in native where predicates
void FilterShape.targets.tables.filterShape.where((row) => row.labels.eq([]))

void FilterShape.targets.tables.filterShape.where(
  // @ts-expect-error optional columns remain excluded until runtime support is proven
  (row) => row.nickname.eq("Ada"),
)

// @ts-expect-error predicate comparands must match the column type
void Full.targets.tables.user.where((row) => row.id.eq(123))

// @ts-expect-error filtered query callbacks must return a native predicate
void Full.targets.tables.user.where(() => ({}))

void session.streamTarget(
  // @ts-expect-error filtered query targets do not participate in streamTarget
  Full.targets.tables.user.where((row) => row.id.eq(userId)),
)

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
