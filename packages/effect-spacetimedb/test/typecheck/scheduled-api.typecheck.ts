import type * as StdbServer from "effect-spacetimedb/server"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

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

const Scheduled = Stdb.Group.make("Scheduled").add(
  Stdb.Fn.scheduledReducer("scheduledJobFire", {
    table: scheduledJob,
  }),
)

const ScheduledModule = Stdb.Module.make("scheduled_api", {})
  .addTables(scheduledJob, user)
  .add(Scheduled)

const { Db } = ScheduledModule

const ScheduledLive = Stdb.Builder.group(ScheduledModule, "Scheduled", {
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
void Stdb.Fn.scheduledReducer("plainUserFire", { table: user })

const missingTargetTable = Stdb.scheduledTable("missingTarget", {
  columns: {},
})
const MissingTargetModule = Stdb.Module.make("missing_target", {}).addTables(
  missingTargetTable,
)
// @ts-expect-error scheduled tables must have a scheduled reducer or procedure
void build(MissingTargetModule, [])

const unregisteredTargetTable = Stdb.scheduledTable("unregisteredTarget", {
  columns: {},
})
const Unregistered = Stdb.Group.make("Unregistered").add(
  Stdb.Fn.scheduledReducer("unregisteredTargetFire", {
    table: unregisteredTargetTable,
  }),
)
const UnregisteredModule = Stdb.Module.make("unregistered_target", {}).add(
  Unregistered,
)
const UnregisteredLive = Stdb.Builder.group(
  UnregisteredModule,
  "Unregistered",
  {
    unregisteredTargetFire: Effect.fn(function* () {}),
  },
)

// @ts-expect-error scheduled targets must reference a table registered on the module
void build(UnregisteredModule, [UnregisteredLive])
