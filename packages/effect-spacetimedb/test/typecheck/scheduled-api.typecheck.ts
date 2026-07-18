import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import type * as StdbServer from "effect-spacetimedb/server"

const scheduledJob = Stdb.scheduledTable("scheduledJob", {
  columns: {
    note: Stdb.string(),
  },
})

const user = Stdb.table("user", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})

const Scheduled = Stdb.StdbGroup.make("Scheduled").add(
  Stdb.StdbFn.scheduledReducer("scheduledJobFire", {
    table: scheduledJob,
  }),
)

const ScheduledModule = Stdb.StdbModule.make("scheduled_api", {})
  .addTables(scheduledJob, user)
  .add(Scheduled)

const { Db } = ScheduledModule

const ScheduledLive = Stdb.StdbBuilder.group(ScheduledModule, "Scheduled", {
  scheduledJobFire: Effect.fn(function* ({ data }) {
    const scheduledId: bigint = data.scheduledId
    const note: string = data.note
    void scheduledId
    void note

    const db = yield* Db
    void db
  }),
})

void build(ScheduledModule, [ScheduledLive])

declare const db: StdbServer.DbService<typeof ScheduledModule.spec>
declare const readonlyDb: StdbServer.ReadonlyDbService<
  typeof ScheduledModule.spec
>

void db.scheduledJob.schedule({
  scheduledAt: Stdb.ScheduleAt.interval("1 second"),
  note: "tick",
})
void db.scheduledJob.schedule({
  // @ts-expect-error schedule fills scheduledId with the compiler sentinel
  scheduledId: 1n,
  scheduledAt: Stdb.ScheduleAt.interval("1 second"),
  note: "tick",
})
// @ts-expect-error non-scheduled tables do not expose schedule(...)
void db.user.schedule({
  scheduledAt: Stdb.ScheduleAt.interval("1 second"),
})
// @ts-expect-error readonly table handles do not expose schedule(...)
void readonlyDb.scheduledJob.schedule({
  scheduledAt: Stdb.ScheduleAt.interval("1 second"),
  note: "tick",
})

// @ts-expect-error scheduled targets must reference a scheduled table
void Stdb.StdbFn.scheduledReducer("plainUserFire", { table: user })

const missingTargetTable = Stdb.scheduledTable("missingTarget", {
  columns: {},
})
const MissingTargetModule = Stdb.StdbModule.make(
  "missing_target",
  {},
).addTables(missingTargetTable)
// @ts-expect-error scheduled tables must have a scheduled reducer or procedure
void build(MissingTargetModule, [])

const unregisteredTargetTable = Stdb.scheduledTable("unregisteredTarget", {
  columns: {},
})
const Unregistered = Stdb.StdbGroup.make("Unregistered").add(
  Stdb.StdbFn.scheduledReducer("unregisteredTargetFire", {
    table: unregisteredTargetTable,
  }),
)
const UnregisteredModule = Stdb.StdbModule.make("unregistered_target", {}).add(
  Unregistered,
)
const UnregisteredLive = Stdb.StdbBuilder.group(
  UnregisteredModule,
  "Unregistered",
  {
    unregisteredTargetFire: Effect.fn(function* () {}),
  },
)

// @ts-expect-error scheduled targets must reference a table registered on the module
void build(UnregisteredModule, [UnregisteredLive])
