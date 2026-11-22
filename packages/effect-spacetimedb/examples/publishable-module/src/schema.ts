import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

export const UserId = Schema.String
export type UserId = string
export const UserName = Schema.String
export type UserName = string
export const ThingId = Schema.String
export type ThingId = string

export const U64 = Stdb.u64()

export const user = Stdb.table("user", {
  public: true,
  columns: {
    id: Stdb.string().primaryKey(),
    name: Stdb.string(),
  },
})

export const presenceEvent = Stdb.table("presenceEvent", {
  columns: {
    userId: Stdb.string(),
    kind: Stdb.literal("joined", "left"),
  },
  public: true,
  event: true,
})

export const auditLog = Stdb.table("auditLog", {
  public: true,
  columns: {
    id: U64.primaryKey().autoInc(),
    kind: Stdb.literal("init", "connected", "disconnected"),
    subject: Stdb.string(),
  },
})

export const uniqueMembership = Stdb.table("uniqueMembership", {
  columns: {
    tenantId: Stdb.string(),
    email: Stdb.string(),
    note: Stdb.string(),
  },
  public: false,
  indexes: (columns) => [
    Stdb.index("uniqueMembershipEmailTenantIdx", [
      columns.email,
      columns.tenantId,
    ]),
    Stdb.index(
      "uniqueMembershipTenantEmailNoteIdx",
      [columns.tenantId, columns.email, columns.note],
      { algorithm: "btree" },
    ),
  ],
  constraints: (columns) => [
    Stdb.unique("uniqueMembershipTenantEmailUnique", [
      columns.tenantId,
      columns.email,
    ]),
  ],
})

export const constraintEntry = Stdb.table("constraintEntry", {
  public: false,
  columns: {
    id: Stdb.string().primaryKey(),
    slug: Stdb.string(),
    tenantId: Stdb.string(),
    email: Stdb.string(),
    note: Stdb.string(),
  },
  indexes: (columns) => [
    Stdb.index("constraintEntrySlugIdx", [columns.slug]),
    Stdb.index("constraintEntryTenantEmailIdx", [
      columns.tenantId,
      columns.email,
    ]),
  ],
  constraints: (columns) => [
    Stdb.unique("constraintEntrySlugUnique", [columns.slug]),
    Stdb.unique("constraintEntryTenantEmailUnique", [
      columns.tenantId,
      columns.email,
    ]),
  ],
})

export const thing = Stdb.table("thing", {
  public: true,
  columns: {
    id: Stdb.string().primaryKey(),
    label: Stdb.string(),
    count: U64,
  },
  indexes: (columns) => [
    Stdb.index("thingCountIdx", [columns.count], { algorithm: "btree" }),
  ],
})

export const nativeRangeEntry = Stdb.table("nativeRangeEntry", {
  public: true,
  columns: {
    id: U64.primaryKey().autoInc(),
    owner: Stdb.identity(),
    happenedAt: Stdb.timestamp(),
    label: Stdb.string(),
  },
  indexes: (columns) => [
    Stdb.index("nativeRangeEntryOwnerIdx", [columns.owner], {
      algorithm: "btree",
    }),
    Stdb.index("nativeRangeEntryHappenedAtIdx", [columns.happenedAt], {
      algorithm: "btree",
    }),
  ],
})

// A sequence needs an integer column, not a key: `label` is the key here, and
// each serial sits on a different kind of column.
export const serialEntry = Stdb.table("serialEntry", {
  public: true,
  columns: {
    label: Stdb.string().primaryKey(),
    plainSerial: Stdb.u64().autoInc(),
    uniqueSerial: Stdb.u32().unique().autoInc(),
    indexedSerial: Stdb.i64().index().autoInc(),
  },
})

export const optionalRangeEntry = Stdb.table("optionalRangeEntry", {
  public: false,
  columns: {
    id: U64.primaryKey().autoInc(),
    rank: Stdb.option(U64),
    label: Stdb.string(),
  },
  indexes: (columns) => [
    Stdb.index("optionalRangeEntryRankIdx", [columns.rank], {
      algorithm: "btree",
    }),
  ],
})

export const scheduledResult = Stdb.table("scheduledResult", {
  public: true,
  columns: {
    id: U64.primaryKey().autoInc(),
    target: Stdb.literal("reducer", "procedure"),
    note: Stdb.string(),
    sender: Stdb.string(),
    identity: Stdb.string(),
    databaseIdentity: Stdb.string(),
  },
})

export const reducerSchedule = Stdb.scheduledTable("reducerSchedule", {
  public: true,
  scheduledId: U64,
  columns: {
    note: Stdb.string(),
  },
})

export const procedureSchedule = Stdb.scheduledTable("procedureSchedule", {
  public: true,
  scheduledId: U64,
  columns: {
    note: Stdb.string(),
  },
})

export const exampleTables = [
  user,
  presenceEvent,
  auditLog,
  uniqueMembership,
  constraintEntry,
  thing,
  nativeRangeEntry,
  optionalRangeEntry,
  serialEntry,
  scheduledResult,
  reducerSchedule,
  procedureSchedule,
] as const
