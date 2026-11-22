import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import * as Server from "effect-spacetimedb/server"
import type { Bound, Range } from "spacetimedb/server"

const indexedUser = Stdb.table("user", {
  columns: {
    id: Stdb.string().primaryKey(),
    tenant: Stdb.string(),
    email: Stdb.string(),
    name: Stdb.string(),
  },
  indexes: [
    Stdb.index({
      name: "email_tenant",
      columns: ["email", "tenant"],
    }),
    Stdb.index({
      name: "email_only",
      columns: ["email"],
    }),
    Stdb.index({
      name: "name_index",
      columns: ["name"],
    }),
    Stdb.index({
      name: "tenant_name",
      columns: ["tenant", "name"],
    }),
  ],
  constraints: [
    Stdb.unique({
      name: "email_tenant_unique",
      columns: ["tenant", "email"],
    }),
  ],
})

const IndexedModule = Stdb.Module.make("indexed_users_typecheck", {}).addTables(
  indexedUser,
).spec

const algorithmIndexedUser = Stdb.table("algorithmUser", {
  columns: {
    id: Stdb.string().primaryKey(),
    tenant: Stdb.string(),
    email: Stdb.string(),
    rank: Stdb.u32(),
    score: Stdb.u32(),
    displayName: Stdb.string(),
    uniqueCode: Stdb.string(),
  },
  indexes: [
    Stdb.index({
      name: "tenantHash",
      columns: ["tenant"],
      algorithm: "hash",
    }),
    Stdb.index({
      name: "tenantEmailHash",
      columns: ["tenant", "email"],
      algorithm: "hash",
    }),
    Stdb.index({
      name: "rankDirect",
      columns: ["rank"],
      algorithm: "direct",
    }),
    Stdb.index({
      name: "displayNameBtree",
      columns: ["displayName"],
      algorithm: "btree",
    }),
    Stdb.index({
      name: "emailHashUnique",
      columns: ["email"],
      algorithm: "hash",
    }),
    Stdb.index({
      name: "scoreDirectUnique",
      columns: ["score"],
      algorithm: "direct",
    }),
    Stdb.index({
      name: "uniqueCodeBtreeUnique",
      columns: ["uniqueCode"],
      algorithm: "btree",
    }),
  ],
  constraints: [
    Stdb.unique({
      name: "emailUnique",
      columns: ["email"],
    }),
    Stdb.unique({
      name: "scoreUnique",
      columns: ["score"],
    }),
    Stdb.unique({
      name: "uniqueCodeUnique",
      columns: ["uniqueCode"],
    }),
  ],
})

const AlgorithmIndexedModule = Stdb.Module.make(
  "algorithm_indexed_users_typecheck",
  {},
).addTables(algorithmIndexedUser).spec

const fieldAlgorithmIndexedUser = Stdb.table("fieldAlgorithmUser", {
  columns: {
    id: Stdb.string().primaryKey(),
    fieldTenant: Stdb.string().index("hash"),
    fieldRank: Stdb.u32().index("direct"),
  },
})

const FieldAlgorithmIndexedModule = Stdb.Module.make(
  "field_algorithm_indexed_users_typecheck",
  {},
).addTables(fieldAlgorithmIndexedUser).spec

declare const db: Server.DbService<typeof IndexedModule>
declare const algorithmDb: Server.DbService<typeof AlgorithmIndexedModule>
declare const fieldAlgorithmDb: Server.DbService<
  typeof FieldAlgorithmIndexedModule
>
declare const readonlyDb: Server.ReadonlyDbService<typeof IndexedModule>
declare const readonlyAlgorithmDb: Server.ReadonlyDbService<
  typeof AlgorithmIndexedModule
>
declare const readonlyFieldAlgorithmDb: Server.ReadonlyDbService<
  typeof FieldAlgorithmIndexedModule
>
declare const reducerCtx: Server.ServerReducerCtx<typeof IndexedModule>
declare const algorithmReducerCtx: Server.ServerReducerCtx<
  typeof AlgorithmIndexedModule
>
declare const fieldAlgorithmReducerCtx: Server.ServerReducerCtx<
  typeof FieldAlgorithmIndexedModule
>
declare const nativeNameRange: Range<string>
declare const nativeScoreRange: Range<number>

const _indexUsageProgram = Effect.gen(function* () {
  const inserted = yield* db.user.insert({
    id: "user-1",
    tenant: "tenant-a",
    email: "ada@example.com",
    name: "Ada",
  })
  const pkDeleted: boolean = yield* db.user.id.delete("user-1")
  const cleared: bigint = yield* db.user.clear()
  const pkUpdated = yield* db.user.id.update(inserted)
  const uniqueRow = yield* db.user.email_tenant.find([
    "ada@example.com",
    "tenant-a",
  ])
  const namedUniqueRow = yield* db.user.email_tenant.find({
    email: "ada@example.com",
    tenant: "tenant-a",
  })
  const uniqueDeleted: boolean = yield* db.user.email_tenant.delete([
    "ada@example.com",
    "tenant-a",
  ])
  const namedUniqueDeleted: boolean = yield* db.user.email_tenant.delete({
    email: "ada@example.com",
    tenant: "tenant-a",
  })
  const emailOnlyRows =
    yield* db.user.email_only.filterToArray("ada@example.com")
  const emailOnlyDeleted: number =
    yield* db.user.email_only.delete("ada@example.com")
  const rangedRows = yield* db.user.name_index.filterToArray("Ada")
  const nameRange: {
    readonly from: Bound<string>
    readonly to: Bound<string>
  } = {
    from: { tag: "included", value: "Ada" },
    to: { tag: "excluded", value: "Bea" },
  }
  const rangeRows = yield* db.user.name_index.filterToArray(nameRange)
  const nativeRangeRows =
    yield* db.user.name_index.filterToArray(nativeNameRange)
  const rangedDeleted: number = yield* db.user.name_index.delete("Ada")
  const rangeDeleted: number = yield* db.user.name_index.delete(nameRange)
  const tenantPrefixRows = yield* db.user.tenant_name.filterToArray([
    "tenant-a",
  ])
  const tenantNamedPrefixRows = yield* db.user.tenant_name.filterToArray({
    tenant: "tenant-a",
  })
  const tenantRangeRows = yield* db.user.tenant_name.filterToArray([nameRange])
  const tenantNamedRangeRows = yield* db.user.tenant_name.filterToArray({
    tenant: nameRange,
  })
  const tenantNameRows = yield* db.user.tenant_name.filterToArray([
    "tenant-a",
    "Ada",
  ])

  const tenantFullWidthRangeRows = yield* db.user.tenant_name.filterToArray([
    "tenant-a",
    nameRange,
  ])
  const tenantNamedRows = yield* db.user.tenant_name.filterToArray({
    tenant: "tenant-a",
    name: "Ada",
  })

  const tenantNamedFullWidthRangeRows =
    yield* db.user.tenant_name.filterToArray({
      tenant: "tenant-a",
      name: nameRange,
    })
  const tenantNameDeleted: number = yield* db.user.tenant_name.delete([
    "tenant-a",
    "Ada",
  ])

  void inserted
  void pkDeleted
  void cleared
  void pkUpdated
  void uniqueRow
  void namedUniqueRow
  void uniqueDeleted
  void namedUniqueDeleted
  void emailOnlyRows
  void emailOnlyDeleted
  void rangedRows
  void rangeRows
  void nativeRangeRows
  void rangedDeleted
  void rangeDeleted
  void tenantPrefixRows
  void tenantNamedPrefixRows
  void tenantRangeRows
  void tenantNamedRangeRows
  void tenantNameRows
  void tenantFullWidthRangeRows
  void tenantNamedRows
  void tenantNamedFullWidthRangeRows
  void tenantNameDeleted

  // @ts-expect-error unique explicit indexes must not expose filterToArray
  void db.user.email_tenant.filterToArray

  // @ts-expect-error unique explicit indexes must not expose update unless they are the primary-key accessor
  void db.user.email_tenant.update

  // @ts-expect-error ranged indexes must not expose find
  void db.user.name_index.find

  // @ts-expect-error ranged indexes must not expose update
  void db.user.name_index.update

  // @ts-expect-error subset indexes of a wider unique constraint must remain ranged
  void db.user.email_only.find

  // @ts-expect-error ranged indexes must not expose update
  void db.user.email_only.update

  // @ts-expect-error composite ranged indexes require tuple prefixes
  yield* db.user.tenant_name.filterToArray("tenant-a")

  // @ts-expect-error named composite point lookups require all fields
  yield* db.user.email_tenant.find({ email: "ada@example.com" })

  // @ts-expect-error named composite range lookups require a prefix starting at the first field
  yield* db.user.tenant_name.filterToArray({ name: "Ada" })
})
void _indexUsageProgram

const _algorithmIndexUsageProgram = Effect.gen(function* () {
  const tenantHashRows =
    yield* algorithmDb.algorithmUser.tenantHash.filterToArray("tenant-a")
  const tenantHashDeleted: number =
    yield* algorithmDb.algorithmUser.tenantHash.delete("tenant-a")
  const tenantEmailHashRows =
    yield* algorithmDb.algorithmUser.tenantEmailHash.filterToArray([
      "tenant-a",
      "ada@example.com",
    ])
  const tenantEmailHashNamedRows =
    yield* algorithmDb.algorithmUser.tenantEmailHash.filterToArray({
      tenant: "tenant-a",
      email: "ada@example.com",
    })
  const rankDirectRows =
    yield* algorithmDb.algorithmUser.rankDirect.filterToArray(1)
  const rankDirectRangeRows =
    yield* algorithmDb.algorithmUser.rankDirect.filterToArray(nativeScoreRange)
  const displayNameBtreeRows =
    yield* algorithmDb.algorithmUser.displayNameBtree.filterToArray("Ada")
  const emailHashUniqueRow =
    yield* algorithmDb.algorithmUser.emailHashUnique.find("ada@example.com")
  const scoreDirectUniqueRow =
    yield* algorithmDb.algorithmUser.scoreDirectUnique.find(1)
  const uniqueCodeBtreeUniqueRow =
    yield* algorithmDb.algorithmUser.uniqueCodeBtreeUnique.find("code-1")

  void tenantHashRows
  void tenantHashDeleted
  void tenantEmailHashRows
  void tenantEmailHashNamedRows
  void rankDirectRows
  void rankDirectRangeRows
  void displayNameBtreeRows
  void emailHashUniqueRow
  void scoreDirectUniqueRow
  void uniqueCodeBtreeUniqueRow

  // @ts-expect-error non-unique hash indexes must not expose single-row find
  void algorithmDb.algorithmUser.tenantHash.find

  // @ts-expect-error hash point filters require exact keys, not ranges
  yield* algorithmDb.algorithmUser.tenantHash.filterToArray(nativeNameRange)

  // @ts-expect-error composite hash point filters require all columns
  yield* algorithmDb.algorithmUser.tenantEmailHash.filterToArray(["tenant-a"])

  // @ts-expect-error direct range indexes must not expose single-row find
  void algorithmDb.algorithmUser.rankDirect.find

  // @ts-expect-error btree range indexes must not expose single-row find
  void algorithmDb.algorithmUser.displayNameBtree.find

  // @ts-expect-error unique hash indexes must not expose range filters
  void algorithmDb.algorithmUser.emailHashUnique.filterToArray

  // @ts-expect-error unique direct indexes must not expose range filters
  void algorithmDb.algorithmUser.scoreDirectUnique.filterToArray
})
void _algorithmIndexUsageProgram

const _fieldAlgorithmIndexUsageProgram = Effect.gen(function* () {
  const fieldHashRows =
    yield* fieldAlgorithmDb.fieldAlgorithmUser.fieldTenant.filterToArray(
      "tenant-a",
    )
  const fieldDirectRows =
    yield* fieldAlgorithmDb.fieldAlgorithmUser.fieldRank.filterToArray(
      nativeScoreRange,
    )
  const fieldHashDeleted: number =
    yield* fieldAlgorithmDb.fieldAlgorithmUser.fieldTenant.delete("tenant-a")
  const fieldDirectDeleted: number =
    yield* fieldAlgorithmDb.fieldAlgorithmUser.fieldRank.delete(
      nativeScoreRange,
    )

  void fieldHashRows
  void fieldDirectRows
  void fieldHashDeleted
  void fieldDirectDeleted

  // @ts-expect-error field-derived hash indexes must not expose single-row find
  void fieldAlgorithmDb.fieldAlgorithmUser.fieldTenant.find

  yield* fieldAlgorithmDb.fieldAlgorithmUser.fieldTenant.filterToArray(
    // @ts-expect-error field-derived hash indexes must not accept ranges
    nativeNameRange,
  )

  // @ts-expect-error field-derived direct indexes remain range indexes, not unique indexes
  void fieldAlgorithmDb.fieldAlgorithmUser.fieldRank.find
})
void _fieldAlgorithmIndexUsageProgram

void readonlyDb.user.id.find
void readonlyDb.user.email_tenant.find
void readonlyDb.user.email_only.filterToArray
void readonlyDb.user.name_index.filterToArray
void readonlyDb.user.tenant_name.filterToArray
void readonlyAlgorithmDb.algorithmUser.tenantHash.filterToArray
void readonlyAlgorithmDb.algorithmUser.rankDirect.filterToArray
void readonlyAlgorithmDb.algorithmUser.emailHashUnique.find
void readonlyFieldAlgorithmDb.fieldAlgorithmUser.fieldTenant.filterToArray
void readonlyFieldAlgorithmDb.fieldAlgorithmUser.fieldRank.filterToArray

// @ts-expect-error readonly db must not expose primary-key deletes
void readonlyDb.user.id.delete

// @ts-expect-error readonly db must not expose table clears
void readonlyDb.user.clear

// @ts-expect-error readonly db must not expose primary-key updates
void readonlyDb.user.id.update

// @ts-expect-error readonly db must not expose unique-index deletes
void readonlyDb.user.email_tenant.delete

// @ts-expect-error readonly db must not expose ranged-index deletes
void readonlyDb.user.email_only.delete

// @ts-expect-error readonly db must not expose hash-index deletes
void readonlyAlgorithmDb.algorithmUser.tenantHash.delete

// @ts-expect-error readonly db must not expose direct-index deletes
void readonlyAlgorithmDb.algorithmUser.rankDirect.delete

// @ts-expect-error readonly db must not expose unique-hash deletes
void readonlyAlgorithmDb.algorithmUser.emailHashUnique.delete

// @ts-expect-error readonly db must not expose field-derived hash-index deletes
void readonlyFieldAlgorithmDb.fieldAlgorithmUser.fieldTenant.delete

// @ts-expect-error readonly db must not expose field-derived direct-index deletes
void readonlyFieldAlgorithmDb.fieldAlgorithmUser.fieldRank.delete

const rawCleared: bigint = reducerCtx.db.user.clear()
const rawUniqueComposite = reducerCtx.db.user.email_tenant.find([
  "ada@example.com",
  "tenant-a",
])
const rawBtreeCompositeRows: Iterable<
  StdbInternal.TableRow<typeof indexedUser>
> = reducerCtx.db.user.tenant_name.filter(["tenant-a"])
const rawUniqueCompositeObject = {
  email: "ada@example.com",
  tenant: "tenant-a",
} as const
const rawBtreeCompositeObject = {
  tenant: "tenant-a",
} as const
void rawCleared
void rawUniqueComposite
void rawBtreeCompositeRows

// @ts-expect-error raw composite unique indexes only accept tuple points
void reducerCtx.db.user.email_tenant.find(rawUniqueCompositeObject)

// @ts-expect-error raw composite range indexes only accept tuple prefixes
void reducerCtx.db.user.tenant_name.filter(rawBtreeCompositeObject)

const rawHashRows: Iterable<
  StdbInternal.TableRow<typeof algorithmIndexedUser>
> = algorithmReducerCtx.db.algorithmUser.tenantHash.filter("tenant-a")
const rawHashDeleted: number =
  algorithmReducerCtx.db.algorithmUser.tenantHash.delete("tenant-a")
const rawCompositeHashRows: Iterable<
  StdbInternal.TableRow<typeof algorithmIndexedUser>
> = algorithmReducerCtx.db.algorithmUser.tenantEmailHash.filter([
  "tenant-a",
  "ada@example.com",
])
const rawDirectRows: Iterable<
  StdbInternal.TableRow<typeof algorithmIndexedUser>
> = algorithmReducerCtx.db.algorithmUser.rankDirect.filter(nativeScoreRange)
const rawBtreeRows: Iterable<
  StdbInternal.TableRow<typeof algorithmIndexedUser>
> = algorithmReducerCtx.db.algorithmUser.displayNameBtree.filter("Ada")
const rawUniqueHash =
  algorithmReducerCtx.db.algorithmUser.emailHashUnique.find("ada@example.com")
const rawUniqueDirect =
  algorithmReducerCtx.db.algorithmUser.scoreDirectUnique.find(1)
const rawUniqueBtree =
  algorithmReducerCtx.db.algorithmUser.uniqueCodeBtreeUnique.find("code-1")

void rawHashRows
void rawHashDeleted
void rawCompositeHashRows
void rawDirectRows
void rawBtreeRows
void rawUniqueHash
void rawUniqueDirect
void rawUniqueBtree

// @ts-expect-error raw non-unique hash indexes must not expose single-row find
void algorithmReducerCtx.db.algorithmUser.tenantHash.find

// @ts-expect-error raw hash point filters require exact keys, not ranges
void algorithmReducerCtx.db.algorithmUser.tenantHash.filter(nativeNameRange)

// @ts-expect-error raw composite hash point filters require all columns
void algorithmReducerCtx.db.algorithmUser.tenantEmailHash.filter(["tenant-a"])

const rawCompositeHashObject = {
  tenant: "tenant-a",
  email: "ada@example.com",
} as const

void algorithmReducerCtx.db.algorithmUser.tenantEmailHash.filter(
  // @ts-expect-error raw composite hash point filters only accept tuple points
  rawCompositeHashObject,
)

const rawFieldHashRows: Iterable<
  StdbInternal.TableRow<typeof fieldAlgorithmIndexedUser>
> =
  fieldAlgorithmReducerCtx.db.fieldAlgorithmUser.fieldTenant.filter("tenant-a")
const rawFieldDirectRows: Iterable<
  StdbInternal.TableRow<typeof fieldAlgorithmIndexedUser>
> =
  fieldAlgorithmReducerCtx.db.fieldAlgorithmUser.fieldRank.filter(
    nativeScoreRange,
  )

void rawFieldHashRows
void rawFieldDirectRows

// @ts-expect-error raw field-derived hash indexes must not expose single-row find
void fieldAlgorithmReducerCtx.db.fieldAlgorithmUser.fieldTenant.find

void fieldAlgorithmReducerCtx.db.fieldAlgorithmUser.fieldTenant.filter(
  // @ts-expect-error raw field-derived hash indexes must not accept ranges
  nativeNameRange,
)

// @ts-expect-error readonly db must not expose ranged-index deletes
void readonlyDb.user.name_index.delete
