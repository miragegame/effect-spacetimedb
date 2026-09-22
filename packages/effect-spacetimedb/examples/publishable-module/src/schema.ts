import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

// Generic, non-branded SATS scalars stay reusable value-types: they are only ever
// SpacetimeDB column/field types, never domain types passed around in app code.
export const String255 = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

// Branded domain types are plain Effect schemas — the single source of truth, used
// directly in app code (decode/encode, request bodies). They are wrapped with
// `Stdb.string(...)` inline only at STDB declaration sites (struct fields, reducer/
// procedure params, view/procedure returns, error fields). No separate value-type variable.
export const UserId = Schema.String.pipe(
  Schema.brand("EffectSpacetimeDbExample/UserId"),
  Schema.check(Schema.isMaxLength(255)),
)
export type UserId = typeof UserId.Type

export const UserName = Schema.String.pipe(
  Schema.brand("EffectSpacetimeDbExample/UserName"),
  Schema.check(Schema.isMaxLength(255)),
)
export type UserName = typeof UserName.Type

export const ThingId = Schema.String.pipe(
  Schema.brand("EffectSpacetimeDbExample/ThingId"),
  Schema.check(Schema.isMaxLength(255)),
)
export type ThingId = typeof ThingId.Type

export const U64 = Stdb.u64(
  Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(0n)),
)

export const user = Stdb.table("user", {
  public: true,
  columns: {
    id: Stdb.string(UserId).primaryKey(),
    name: Stdb.string(UserName),
  },
})

export const presenceEvent = Stdb.table("presenceEvent", {
  columns: {
    userId: Stdb.string(UserId),
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
    subject: String255,
  },
})

export const uniqueMembership = Stdb.table("uniqueMembership", {
  columns: {
    tenantId: String255,
    email: String255,
    note: String255,
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
    id: String255.primaryKey(),
    slug: String255,
    tenantId: String255,
    email: String255,
    note: String255,
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
    id: Stdb.string(ThingId).primaryKey(),
    label: String255,
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
    label: String255,
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

export const optionalRangeEntry = Stdb.table("optionalRangeEntry", {
  public: false,
  columns: {
    id: U64.primaryKey().autoInc(),
    rank: Stdb.option(U64),
    label: String255,
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
    note: String255,
    sender: String255,
    identity: String255,
    databaseIdentity: String255,
  },
})

export const reducerSchedule = Stdb.scheduledTable("reducerSchedule", {
  public: true,
  scheduledId: U64,
  columns: {
    note: String255,
  },
})

export const procedureSchedule = Stdb.scheduledTable("procedureSchedule", {
  public: true,
  scheduledId: U64,
  columns: {
    note: String255,
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
  scheduledResult,
  reducerSchedule,
  procedureSchedule,
] as const
