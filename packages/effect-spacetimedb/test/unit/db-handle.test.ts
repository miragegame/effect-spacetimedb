// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - interop tests intentionally exercise raw STDB schema constructors
import {
  testEffectCallbackError,
  unwrapTestEffectCallbackError,
} from "../helpers/effect-errors"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  StdbAutoIncOverflowError,
  StdbDecodeError,
  StdbHostCallError,
  StdbNoSuchRowError,
  StdbScheduleDelayTooLongError,
  StdbUniqueAlreadyExistsError,
} from "effect-spacetimedb/server"
import { hostCause } from "../helpers/server-runtime"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

class DbHandleFindOrFailTestError extends Data.TaggedError(
  "DbHandleFindOrFailTestError",
)<{
  readonly lookup: string
}> {}

type UserRow = {
  readonly id: string
  readonly tenant: string
  readonly email: string
  readonly name: string
}

type AlgorithmUserRow = {
  readonly id: string
  readonly tenant: string
  readonly email: string
  readonly score: number
  readonly displayName: string
}

type ThrowingIterator = Iterator<UserRow> & {
  readonly return: () => IteratorResult<UserRow>
  readonly throw: (error?: unknown) => IteratorResult<UserRow>
}

const indexedUser = Stdb.table("user", {
  columns: {
    id: Stdb.string().primaryKey(),
    tenant: Stdb.string(),
    email: Stdb.string(),
    name: Stdb.string(),
  },
  indexes: [
    Stdb.index({
      name: "emailTenant",
      columns: ["email", "tenant"],
    }),
    Stdb.index({
      name: "emailOnly",
      columns: ["email"],
    }),
    Stdb.index({
      name: "nameIndex",
      columns: ["name"],
    }),
    Stdb.index({
      name: "tenantName",
      columns: ["tenant", "name"],
    }),
  ],
  constraints: [
    Stdb.unique({
      name: "emailTenantUnique",
      columns: ["tenant", "email"],
    }),
  ],
})

const IndexedModule = Stdb.StdbModule.make("indexed_users", {}).addTables(
  indexedUser,
).spec

const algorithmIndexedUser = Stdb.table("algorithmUser", {
  columns: {
    id: Stdb.string().primaryKey(),
    tenant: Stdb.string(),
    email: Stdb.string(),
    score: Stdb.u32(),
    displayName: Stdb.string(),
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
      name: "scoreDirect",
      columns: ["score"],
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
  ],
  constraints: [
    Stdb.unique({
      name: "emailUnique",
      columns: ["email"],
    }),
  ],
})

const AlgorithmIndexedModule = Stdb.StdbModule.make(
  "algorithm_indexed_users",
  {},
).addTables(algorithmIndexedUser).spec

const presenceTable = Stdb.table("presence", {
  columns: {
    id: Stdb.string().primaryKey(),
    kind: Stdb.literal("joined", "left"),
  },
})

const LiteralModule = Stdb.StdbModule.make("literal_rows", {}).addTables(
  presenceTable,
).spec

const eventTable = Stdb.table("event", {
  columns: {
    id: Stdb.string().primaryKey(),
    content: Stdb.sum({
      playerAction: Stdb.struct({
        text: Stdb.string(),
      }),
      dialogue: Stdb.struct({
        speaker: Stdb.string(),
        tone: Stdb.option(Stdb.string()),
        text: Stdb.string(),
      }),
    }),
  },
})

const StructuredEventModule = Stdb.StdbModule.make(
  "structured_events",
  {},
).addTables(eventTable).spec

const scheduledJobTable = Stdb.scheduledTable("scheduledJob", {
  columns: {
    note: Stdb.string(),
  },
})

const scheduledJobCallables = Stdb.StdbGroup.make("ScheduledJob").add(
  Stdb.StdbFn.scheduledProcedure("scheduledJobFire", {
    table: scheduledJobTable,
  }),
)

const ScheduledJobModule = Stdb.StdbModule.make("scheduled_jobs", {})
  .addTables(scheduledJobTable)
  .add(scheduledJobCallables).spec

type LiteralEncodedRow = {
  readonly id: string
  readonly kind:
    | {
        readonly tag: "Joined"
      }
    | {
        readonly tag: "Left"
      }
}

type StructuredEventEncodedRow = {
  readonly id: string
  readonly content:
    | {
        readonly tag: "playerAction"
        readonly value: {
          readonly text: string
        }
      }
    | {
        readonly tag: "dialogue"
        readonly value: {
          readonly speaker: string
          readonly tone?: string
          readonly text: string
        }
      }
}

type ScheduledJobRow = StdbTesting.TableRow<typeof scheduledJobTable>

const makeRawStringIdTableCore = <Row extends { readonly id: string }>(
  rows: Array<Row>,
  label: string,
) => ({
  count: () => BigInt(rows.length),
  iter: () => rows.values(),
  insert: (row: Row) => {
    rows.push(row)
    return row
  },
  delete: (row: Row) => {
    const index = rows.findIndex((candidate) => candidate.id === row.id)
    if (index >= 0) {
      rows.splice(index, 1)
      return true
    }
    return false
  },
  clear: () => {
    const removed = BigInt(rows.length)
    rows.splice(0, rows.length)
    return removed
  },
  id: {
    find: (id: string) => rows.find((row) => row.id === id),
    delete: (id: string) => {
      const index = rows.findIndex((row) => row.id === id)
      if (index >= 0) {
        rows.splice(index, 1)
        return true
      }
      return false
    },
    update: (row: Row) => {
      const index = rows.findIndex((candidate) => candidate.id === row.id)
      if (index < 0) {
        throw new Error(`Cannot update missing ${label} ${row.id}`)
      }

      rows[index] = row
      return row
    },
  },
})

const makeRawDb = (initialRows: ReadonlyArray<UserRow>) => {
  const rows = [...initialRows]

  return {
    user: {
      ...makeRawStringIdTableCore(rows, "user"),
      emailTenant: {
        find: ([email, tenant]: readonly [string, string]) =>
          rows.find((row) => row.email === email && row.tenant === tenant),
        delete: ([email, tenant]: readonly [string, string]) => {
          const index = rows.findIndex(
            (row) => row.email === email && row.tenant === tenant,
          )
          if (index >= 0) {
            rows.splice(index, 1)
            return true
          }
          return false
        },
      },
      emailOnly: {
        filter: (email: string) =>
          rows.filter((row) => row.email === email).values(),
        delete: (email: string) => {
          const removed = rows.filter((row) => row.email === email).length
          for (let index = rows.length - 1; index >= 0; index = index - 1) {
            const row = rows[index]
            if (row?.email === email) {
              rows.splice(index, 1)
            }
          }
          return removed
        },
      },
      nameIndex: {
        filter: (nameOrRange: string) =>
          rows.filter((row) => row.name === nameOrRange).values(),
        delete: (nameOrRange: string) => {
          const removed = rows.filter((row) => row.name === nameOrRange).length
          for (let index = rows.length - 1; index >= 0; index = index - 1) {
            const row = rows[index]
            if (row?.name === nameOrRange) {
              rows.splice(index, 1)
            }
          }
          return removed
        },
      },
      tenantName: {
        filter: ([tenant, name]:
          | readonly [string]
          | readonly [string, string]) =>
          rows
            .filter(
              (row) =>
                row.tenant === tenant &&
                (name === undefined || row.name === name),
            )
            .values(),
        delete: ([tenant, name]:
          | readonly [string]
          | readonly [string, string]) => {
          const removed = rows.filter(
            (row) =>
              row.tenant === tenant &&
              (name === undefined || row.name === name),
          ).length
          for (let index = rows.length - 1; index >= 0; index = index - 1) {
            const row = rows[index]
            if (
              row?.tenant === tenant &&
              (name === undefined || row.name === name)
            ) {
              rows.splice(index, 1)
            }
          }
          return removed
        },
      },
    },
  }
}

const isRangeLike = (
  value: unknown,
): value is {
  readonly from: { readonly tag: string; readonly value?: number }
  readonly to: { readonly tag: string; readonly value?: number }
} =>
  typeof value === "object" &&
  value !== null &&
  "from" in value &&
  "to" in value

const isIncludedByBound = (
  value: number,
  bound: { readonly tag: string; readonly value?: number },
  side: "from" | "to",
): boolean => {
  if (bound.tag === "unbounded") {
    return true
  }
  if (bound.value === undefined) {
    return true
  }
  if (side === "from") {
    return bound.tag === "excluded" ? value > bound.value : value >= bound.value
  }
  return bound.tag === "excluded" ? value < bound.value : value <= bound.value
}

const scoreMatches = (score: number, value: unknown): boolean =>
  isRangeLike(value)
    ? isIncludedByBound(score, value.from, "from") &&
      isIncludedByBound(score, value.to, "to")
    : score === value

const makeRawAlgorithmDb = (initialRows: ReadonlyArray<AlgorithmUserRow>) => {
  const rows = [...initialRows]

  return {
    algorithmUser: {
      ...makeRawStringIdTableCore(rows, "algorithm user"),
      tenantHash: {
        filter: (tenant: string) =>
          rows.filter((row) => row.tenant === tenant).values(),
        delete: (tenant: string) => {
          const removed = rows.filter((row) => row.tenant === tenant).length
          for (let index = rows.length - 1; index >= 0; index = index - 1) {
            if (rows[index]?.tenant === tenant) {
              rows.splice(index, 1)
            }
          }
          return removed
        },
      },
      tenantEmailHash: {
        filter: ([tenant, email]: readonly [string, string]) =>
          rows
            .filter((row) => row.tenant === tenant && row.email === email)
            .values(),
        delete: ([tenant, email]: readonly [string, string]) => {
          const removed = rows.filter(
            (row) => row.tenant === tenant && row.email === email,
          ).length
          for (let index = rows.length - 1; index >= 0; index = index - 1) {
            const row = rows[index]
            if (row?.tenant === tenant && row.email === email) {
              rows.splice(index, 1)
            }
          }
          return removed
        },
      },
      scoreDirect: {
        filter: (scoreOrRange: unknown) =>
          rows.filter((row) => scoreMatches(row.score, scoreOrRange)).values(),
        delete: (scoreOrRange: unknown) => {
          const removed = rows.filter((row) =>
            scoreMatches(row.score, scoreOrRange),
          ).length
          for (let index = rows.length - 1; index >= 0; index = index - 1) {
            const row = rows[index]
            if (row !== undefined && scoreMatches(row.score, scoreOrRange)) {
              rows.splice(index, 1)
            }
          }
          return removed
        },
      },
      displayNameBtree: {
        filter: (displayName: string) =>
          rows.filter((row) => row.displayName === displayName).values(),
        delete: (displayName: string) => {
          const removed = rows.filter(
            (row) => row.displayName === displayName,
          ).length
          for (let index = rows.length - 1; index >= 0; index = index - 1) {
            if (rows[index]?.displayName === displayName) {
              rows.splice(index, 1)
            }
          }
          return removed
        },
      },
      emailHashUnique: {
        find: (email: string) => rows.find((row) => row.email === email),
        delete: (email: string) => {
          const index = rows.findIndex((row) => row.email === email)
          if (index >= 0) {
            rows.splice(index, 1)
            return true
          }
          return false
        },
      },
    },
  }
}

const makeRawScheduledJobDb = () => {
  const rows: Array<ScheduledJobRow> = []

  return {
    scheduledJob: {
      count: () => BigInt(rows.length),
      iter: () => rows.values(),
      insert: (row: ScheduledJobRow) => {
        rows.push(row)
        return row
      },
      delete: (row: ScheduledJobRow) => {
        const index = rows.findIndex(
          (candidate) => candidate.scheduledId === row.scheduledId,
        )
        if (index >= 0) {
          rows.splice(index, 1)
          return true
        }
        return false
      },
      clear: () => {
        const removed = BigInt(rows.length)
        rows.splice(0, rows.length)
        return removed
      },
      scheduledId: {
        find: (scheduledId: bigint) =>
          rows.find((row) => row.scheduledId === scheduledId),
        delete: (scheduledId: bigint) => {
          const index = rows.findIndex((row) => row.scheduledId === scheduledId)
          if (index >= 0) {
            rows.splice(index, 1)
            return true
          }
          return false
        },
        update: (row: ScheduledJobRow) => {
          const index = rows.findIndex(
            (candidate) => candidate.scheduledId === row.scheduledId,
          )
          if (index >= 0) {
            rows[index] = row
          }
          return row
        },
        upsert: (row: ScheduledJobRow) => {
          const index = rows.findIndex(
            (candidate) => candidate.scheduledId === row.scheduledId,
          )
          if (index >= 0) {
            rows[index] = row
          } else {
            rows.push(row)
          }
          return row
        },
      },
      rows,
    },
  }
}

const adaRow = {
  id: "user-1",
  tenant: "tenant-a",
  email: "ada@example.com",
  name: "Ada",
} satisfies UserRow

const beaRow = {
  id: "user-1",
  tenant: "tenant-a",
  email: "bea@example.com",
  name: "Bea",
} satisfies UserRow

const bobRow = {
  id: "user-2",
  tenant: "tenant-b",
  email: "bob@example.com",
  name: "Ada",
} satisfies UserRow

const annRow = {
  id: "user-3",
  tenant: "tenant-c",
  email: "ann@example.com",
  name: "Ada",
} satisfies UserRow

const algorithmAdaRow = {
  id: "algorithm-user-1",
  tenant: "tenant-a",
  email: "ada@example.com",
  score: 10,
  displayName: "Ada",
} satisfies AlgorithmUserRow

const algorithmBeaRow = {
  id: "algorithm-user-2",
  tenant: "tenant-a",
  email: "bea@example.com",
  score: 20,
  displayName: "Bea",
} satisfies AlgorithmUserRow

const algorithmBobRow = {
  id: "algorithm-user-3",
  tenant: "tenant-b",
  email: "bob@example.com",
  score: 30,
  displayName: "Bob",
} satisfies AlgorithmUserRow

const failureFromExit = (exit: Exit.Exit<unknown, unknown>): unknown => {
  expect(Exit.isFailure(exit)).toBe(true)

  if (!Exit.isFailure(exit)) {
    throw new Error("Expected effect failure")
  }

  const failure = Cause.findErrorOption(exit.cause)
  expect(Option.isSome(failure)).toBe(true)

  if (!Option.isSome(failure)) {
    throw new Error("Expected failure cause")
  }

  return unwrapTestEffectCallbackError(failure.value)
}

describe("db handle factory", (it) => {
  it.effect(
    "builds read-write and read-only handles from module metadata",
    () =>
      Effect.gen(function* () {
        const factory = StdbTesting.makeDbHandleFactory(IndexedModule)
        const rawDb = makeRawDb([adaRow, bobRow, annRow])

        const db = factory.readwrite(rawDb as never)
        const readonlyDb = factory.readonly(rawDb as never)

        expect(yield* db.user.count()).toBe(3n)
        expect(yield* db.user.toArray()).toEqual([adaRow, bobRow, annRow])
        expect(yield* db.user.stream().pipe(Stream.runCollect)).toEqual([
          adaRow,
          bobRow,
          annRow,
        ])
        expect(yield* db.user.id.find("user-1")).toEqual(adaRow)

        expect(
          yield* db.user.emailTenant.find(["ada@example.com", "tenant-a"]),
        ).toEqual(adaRow)
        expect(
          yield* db.user.emailTenant.find({
            email: "ada@example.com",
            tenant: "tenant-a",
          }),
        ).toEqual(adaRow)
        expect(
          yield* db.user.emailOnly.filterToArray("ada@example.com"),
        ).toEqual([adaRow])
        expect(yield* db.user.nameIndex.filterToArray("Ada")).toEqual([
          adaRow,
          bobRow,
          annRow,
        ])
        expect(yield* db.user.tenantName.filterToArray(["tenant-a"])).toEqual([
          adaRow,
        ])
        expect(
          yield* db.user.tenantName.filterToArray({ tenant: "tenant-a" }),
        ).toEqual([adaRow])
        expect(
          yield* db.user.tenantName.filterToArray(["tenant-a", "Ada"]),
        ).toEqual([adaRow])
        expect(
          yield* db.user.tenantName.filterToArray({
            tenant: "tenant-a",
            name: "Ada",
          }),
        ).toEqual([adaRow])
        const invalidLookupExit = yield* Effect.exit(
          db.user.emailTenant.find({
            email: "ada@example.com",
          } as never),
        )
        expect(failureFromExit(invalidLookupExit)).toBeInstanceOf(
          StdbDecodeError,
        )
        const inheritedLookup = Object.create({
          email: "ada@example.com",
          tenant: "tenant-a",
        })
        const inheritedLookupExit = yield* Effect.exit(
          db.user.emailTenant.find(inheritedLookup as never),
        )
        expect(failureFromExit(inheritedLookupExit)).toBeInstanceOf(
          StdbDecodeError,
        )
        expect(
          yield* db.user.nameIndex.filterStream("Ada").pipe(Stream.runCollect),
        ).toEqual([adaRow, bobRow, annRow])
        expect(
          yield* db.user.tenantName
            .filterStream(["tenant-a", "Ada"])
            .pipe(Stream.runCollect),
        ).toEqual([adaRow])

        expect(yield* db.user.first()).toEqual(adaRow)
        yield* db.user.id.update(beaRow)

        expect(yield* db.user.id.find("user-1")).toEqual(beaRow)
        expect(yield* db.user.id.replace(beaRow)).toEqual(beaRow)
        expect(
          failureFromExit(
            yield* Effect.exit(
              db.user.id.replace({
                id: "missing",
                tenant: "tenant-a",
                email: "missing@example.com",
                name: "Missing",
              }),
            ),
          ),
        ).toBeInstanceOf(StdbHostCallError)
        expect(yield* db.user.id.exists("user-1")).toBe(true)
        expect(yield* db.user.id.exists("missing")).toBe(false)
        expect(
          yield* db.user.id.findOrFail(
            "user-1",
            () => new DbHandleFindOrFailTestError({ lookup: "not found" }),
          ),
        ).toEqual(beaRow)
        const missing = new DbHandleFindOrFailTestError({ lookup: "missing" })
        let capturedLookup: string | undefined
        const missingExit = yield* Effect.exit(
          db.user.id.findOrFail("missing", (lookup) => {
            capturedLookup = lookup
            return missing
          }),
        )
        expect(capturedLookup).toBe("missing")
        expect(Exit.isFailure(missingExit)).toBe(true)
        if (Exit.isFailure(missingExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(missingExit.cause)),
          ).toBe(missing)
        }

        expect(
          yield* db.user.emailTenant.delete(["bea@example.com", "tenant-a"]),
        ).toBe(true)
        expect(yield* db.user.id.find("user-1")).toBeUndefined()
        expect(yield* db.user.emailOnly.delete("bob@example.com")).toBe(1)
        expect(
          yield* db.user.emailOnly.filterToArray("bob@example.com"),
        ).toEqual([])
        expect(yield* db.user.nameIndex.delete("Ada")).toBe(1)
        expect(yield* db.user.nameIndex.filterToArray("Ada")).toEqual([])

        expect(yield* readonlyDb.user.count()).toBe(0n)
        expect(yield* readonlyDb.user.first()).toBeUndefined()
        expect(yield* readonlyDb.user.toArray()).toEqual([])

        expect(yield* db.user.insertAll([adaRow, bobRow])).toEqual([
          adaRow,
          bobRow,
        ])
        expect(yield* db.user.toArray()).toEqual([adaRow, bobRow])
        expect(yield* db.user.emailOnly.deleteAll("bob@example.com")).toBe(1)
        expect(yield* db.user.toArray()).toEqual([adaRow])
        expect(yield* db.user.clear()).toBe(1n)
        expect(yield* db.user.toArray()).toEqual([])

        expect("insert" in (readonlyDb.user as Record<string, unknown>)).toBe(
          false,
        )
        expect("clear" in (readonlyDb.user as Record<string, unknown>)).toBe(
          false,
        )
        expect(
          "delete" in
            ((readonlyDb.user as Record<string, unknown>).id as Record<
              string,
              unknown
            >),
        ).toBe(false)
        expect(
          "update" in
            ((readonlyDb.user as Record<string, unknown>).id as Record<
              string,
              unknown
            >),
        ).toBe(false)
        expect(
          "find" in
            ((readonlyDb.user as Record<string, unknown>).emailTenant as Record<
              string,
              unknown
            >),
        ).toBe(true)
        expect(
          "delete" in
            ((readonlyDb.user as Record<string, unknown>).emailTenant as Record<
              string,
              unknown
            >),
        ).toBe(false)
        expect(
          "filterToArray" in
            ((readonlyDb.user as Record<string, unknown>).emailOnly as Record<
              string,
              unknown
            >),
        ).toBe(true)
        expect(
          "delete" in
            ((readonlyDb.user as Record<string, unknown>).emailOnly as Record<
              string,
              unknown
            >),
        ).toBe(false)
        expect(
          "filterToArray" in
            ((readonlyDb.user as Record<string, unknown>).nameIndex as Record<
              string,
              unknown
            >),
        ).toBe(true)
        expect(
          "delete" in
            ((readonlyDb.user as Record<string, unknown>).nameIndex as Record<
              string,
              unknown
            >),
        ).toBe(false)
      }),
  )

  it.effect(
    "maps hash indexes to point filters and direct indexes to range filters",
    () =>
      Effect.gen(function* () {
        const factory = StdbTesting.makeDbHandleFactory(AlgorithmIndexedModule)
        const rawDb = makeRawAlgorithmDb([
          algorithmAdaRow,
          algorithmBeaRow,
          algorithmBobRow,
        ])
        const db = factory.readwrite(rawDb as never)
        const readonlyDb = factory.readonly(rawDb as never)

        expect(
          yield* db.algorithmUser.tenantHash.filterToArray("tenant-a"),
        ).toEqual([algorithmAdaRow, algorithmBeaRow])
        expect(
          yield* db.algorithmUser.tenantHash
            .filterStream("tenant-a")
            .pipe(Stream.runCollect),
        ).toEqual([algorithmAdaRow, algorithmBeaRow])
        expect([
          ...(yield* db.algorithmUser.tenantHash.unsafe.filter("tenant-a")),
        ]).toEqual([algorithmAdaRow, algorithmBeaRow])
        expect(
          yield* db.algorithmUser.tenantEmailHash.filterToArray({
            tenant: "tenant-a",
            email: "ada@example.com",
          }),
        ).toEqual([algorithmAdaRow])

        const partialHashExit = yield* Effect.exit(
          db.algorithmUser.tenantEmailHash.filterToArray({
            tenant: "tenant-a",
          } as never),
        )
        expect(failureFromExit(partialHashExit)).toBeInstanceOf(StdbDecodeError)

        const hashLookup = db.algorithmUser.tenantHash as Record<
          string,
          unknown
        >
        expect("find" in hashLookup).toBe(false)
        expect("deleteAll" in hashLookup).toBe(false)

        const scoreRange = {
          from: { tag: "included" as const, value: 10 },
          to: { tag: "excluded" as const, value: 30 },
        }
        expect(
          yield* db.algorithmUser.scoreDirect.filterToArray(scoreRange),
        ).toEqual([algorithmAdaRow, algorithmBeaRow])
        expect(
          yield* db.algorithmUser.displayNameBtree.filterToArray("Ada"),
        ).toEqual([algorithmAdaRow])

        expect(
          yield* db.algorithmUser.emailHashUnique.find("ada@example.com"),
        ).toEqual(algorithmAdaRow)
        expect(
          "filterToArray" in
            (db.algorithmUser.emailHashUnique as Record<string, unknown>),
        ).toBe(false)
        expect(
          "delete" in
            (readonlyDb.algorithmUser.tenantHash as Record<string, unknown>),
        ).toBe(false)

        expect(yield* db.algorithmUser.tenantHash.delete("tenant-b")).toBe(1)
        expect(
          yield* db.algorithmUser.tenantHash.filterToArray("tenant-b"),
        ).toEqual([])
      }),
  )

  it.effect(
    "schedules rows with the autoInc sentinel on scheduled tables",
    () =>
      Effect.gen(function* () {
        const factory = StdbTesting.makeDbHandleFactory(ScheduledJobModule)
        const rawDb = makeRawScheduledJobDb()
        const db = factory.readwrite(rawDb as never)
        const readonlyDb = factory.readonly(rawDb as never)
        const scheduledAt = Stdb.ScheduleAt.interval("1 second")

        const row = yield* db.scheduledJob.schedule({
          scheduledAt,
          note: "tick",
        })

        expect(row).toEqual({
          scheduledId: 0n,
          scheduledAt,
          note: "tick",
        })
        expect(rawDb.scheduledJob.rows).toEqual([row])
        expect("schedule" in readonlyDb.scheduledJob).toBe(false)
      }),
  )

  it.effect(
    "encodes authored literal rows on writes and decodes them on reads",
    () =>
      Effect.gen(function* () {
        const factory = StdbTesting.makeDbHandleFactory(LiteralModule)
        const rawRows: Array<LiteralEncodedRow> = []
        const db = factory.readwrite({
          presence: {
            count: () => BigInt(rawRows.length),
            iter: () => rawRows.values(),
            insert: (row: LiteralEncodedRow) => {
              rawRows.push(row)
              return row
            },
            delete: (row: LiteralEncodedRow) => {
              const index = rawRows.findIndex(
                (candidate) => candidate.id === row.id,
              )
              if (index >= 0) {
                rawRows.splice(index, 1)
                return true
              }
              return false
            },
            id: {
              find: (id: string) => rawRows.find((row) => row.id === id),
              delete: (id: string) => {
                const index = rawRows.findIndex((row) => row.id === id)
                if (index >= 0) {
                  rawRows.splice(index, 1)
                  return true
                }
                return false
              },
              update: (row: LiteralEncodedRow) => {
                const index = rawRows.findIndex(
                  (candidate) => candidate.id === row.id,
                )
                if (index >= 0) {
                  rawRows[index] = row
                } else {
                  rawRows.push(row)
                }
                return row
              },
            },
          },
        } as never)

        expect(
          yield* db.presence.insert({
            id: "event-1",
            kind: "joined",
          }),
        ).toEqual({
          id: "event-1",
          kind: "joined",
        })
        expect(rawRows).toEqual([
          {
            id: "event-1",
            kind: {
              tag: "joined",
            },
          },
        ])
        expect(yield* db.presence.id.find("event-1")).toEqual({
          id: "event-1",
          kind: "joined",
        })
        expect(yield* db.presence.toArray()).toEqual([
          {
            id: "event-1",
            kind: "joined",
          },
        ])

        rawRows.push({
          id: "event-2",
          kind: {
            tag: "Invalid",
          } as never,
        })

        const streamFailure = failureFromExit(
          yield* Effect.exit(db.presence.stream().pipe(Stream.runCollect)),
        )
        expect(streamFailure).toBeInstanceOf(StdbDecodeError)
      }),
  )

  it.effect(
    "encodes structured sum rows to the server host shape on writes",
    () =>
      Effect.gen(function* () {
        const factory = StdbTesting.makeDbHandleFactory(StructuredEventModule)
        const rawRows: Array<StructuredEventEncodedRow> = []
        const db = factory.readwrite({
          event: {
            count: () => BigInt(rawRows.length),
            iter: () => rawRows.values(),
            insert: (row: StructuredEventEncodedRow) => {
              rawRows.push(row)
              return row
            },
            delete: (row: StructuredEventEncodedRow) => {
              const index = rawRows.findIndex(
                (candidate) => candidate.id === row.id,
              )
              if (index >= 0) {
                rawRows.splice(index, 1)
                return true
              }
              return false
            },
            id: {
              find: (id: string) => rawRows.find((row) => row.id === id),
              delete: (id: string) => {
                const index = rawRows.findIndex((row) => row.id === id)
                if (index >= 0) {
                  rawRows.splice(index, 1)
                  return true
                }
                return false
              },
              update: (row: StructuredEventEncodedRow) => {
                const index = rawRows.findIndex(
                  (candidate) => candidate.id === row.id,
                )
                if (index >= 0) {
                  rawRows[index] = row
                } else {
                  rawRows.push(row)
                }
                return row
              },
            },
          },
        } as never)

        expect(
          yield* db.event.insert({
            id: "event-1",
            content: {
              tag: "playerAction",
              value: {
                text: "open the door",
              },
            },
          }),
        ).toEqual({
          id: "event-1",
          content: {
            tag: "playerAction",
            value: {
              text: "open the door",
            },
          },
        })
        expect(rawRows).toEqual([
          {
            id: "event-1",
            content: {
              tag: "playerAction",
              value: {
                text: "open the door",
              },
            },
          },
        ])

        rawRows.push({
          id: "event-2",
          content: {
            tag: "dialogue",
            value: {
              speaker: "guide",
              text: "quietly now",
            },
          },
        })
        expect(yield* db.event.id.find("event-2")).toEqual({
          id: "event-2",
          content: {
            tag: "dialogue",
            value: {
              speaker: "guide",
              tone: undefined,
              text: "quietly now",
            },
          },
        })
      }),
  )

  it.effect(
    "maps host method failures to labeled StdbHostCallError values",
    () =>
      Effect.gen(function* () {
        const factory = StdbTesting.makeDbHandleFactory(IndexedModule)
        const db = factory.readwrite({
          user: {
            count: () => {
              throw new Error("count failed")
            },
            iter: () => ([] as Array<UserRow>).values(),
            insert: (_row: UserRow) => {
              throw new Error("insert failed")
            },
            delete: (_row: UserRow) => false,
            id: {
              find: (_id: string) => {
                throw new Error("lookup failed")
              },
              delete: (_id: string) => false,
              update: (row: UserRow) => row,
            },
            emailTenant: {
              find: (_key: readonly [string, string]) => undefined,
              delete: (_key: readonly [string, string]) => false,
            },
            emailOnly: {
              filter: (_email: string) => [].values(),
              delete: (_email: string) => 0,
            },
            nameIndex: {
              filter: (_nameOrRange: string) => {
                throw new Error("filter failed")
              },
              delete: (_nameOrRange: string) => 0,
            },
          },
        } as never)

        const countFailure = failureFromExit(
          yield* Effect.exit(db.user.count()),
        )
        expect(countFailure).toBeInstanceOf(StdbHostCallError)
        expect((countFailure as StdbHostCallError).op).toBe("db.user.count")

        const lookupFailure = failureFromExit(
          yield* Effect.exit(db.user.id.find("user-1")),
        )
        expect(lookupFailure).toBeInstanceOf(StdbHostCallError)
        expect((lookupFailure as StdbHostCallError).op).toBe("db.user.id.find")

        const filterFailure = failureFromExit(
          yield* Effect.exit(db.user.nameIndex.filterToArray("Ada")),
        )
        expect(filterFailure).toBeInstanceOf(StdbHostCallError)
        expect((filterFailure as StdbHostCallError).op).toBe(
          "db.user.nameIndex.filter",
        )
      }),
  )

  it.effect(
    "maps discriminated host write failures to labeled tagged errors",
    () =>
      Effect.gen(function* () {
        const factory = StdbTesting.makeDbHandleFactory(IndexedModule)

        const uniqueCause = hostCause("UniqueAlreadyExists")
        const uniqueDb = factory.readwrite({
          ...makeRawDb([]),
          user: {
            ...makeRawDb([]).user,
            insert: () => {
              throw uniqueCause
            },
          },
        } as never)
        const uniqueFailure = failureFromExit(
          yield* Effect.exit(uniqueDb.user.insert(adaRow)),
        )
        expect(uniqueFailure).toBeInstanceOf(StdbUniqueAlreadyExistsError)
        expect((uniqueFailure as StdbUniqueAlreadyExistsError).op).toBe(
          "db.user.insert",
        )
        expect((uniqueFailure as StdbUniqueAlreadyExistsError).cause).toBe(
          uniqueCause,
        )

        const overflowCause = hostCause("AutoIncOverflow")
        const overflowDb = factory.readwrite({
          ...makeRawDb([]),
          user: {
            ...makeRawDb([]).user,
            insert: () => {
              throw overflowCause
            },
          },
        } as never)
        const overflowFailure = failureFromExit(
          yield* Effect.exit(overflowDb.user.insert(adaRow)),
        )
        expect(overflowFailure).toBeInstanceOf(StdbAutoIncOverflowError)
        expect((overflowFailure as StdbAutoIncOverflowError).op).toBe(
          "db.user.insert",
        )
        expect((overflowFailure as StdbAutoIncOverflowError).cause).toBe(
          overflowCause,
        )

        const noSuchRowCause = hostCause("NoSuchRow")
        const noSuchRowDb = factory.readwrite({
          ...makeRawDb([]),
          user: {
            ...makeRawDb([]).user,
            id: {
              ...makeRawDb([]).user.id,
              update: () => {
                throw noSuchRowCause
              },
            },
          },
        } as never)
        const noSuchRowFailure = failureFromExit(
          yield* Effect.exit(noSuchRowDb.user.id.update(adaRow)),
        )
        expect(noSuchRowFailure).toBeInstanceOf(StdbNoSuchRowError)
        expect((noSuchRowFailure as StdbNoSuchRowError).op).toBe(
          "db.user.id.update",
        )
        expect((noSuchRowFailure as StdbNoSuchRowError).cause).toBe(
          noSuchRowCause,
        )

        const delayCause = hostCause("ScheduleAtDelayTooLong")
        const scheduledFactory =
          StdbTesting.makeDbHandleFactory(ScheduledJobModule)
        const rawScheduledDb = makeRawScheduledJobDb()
        const delayDb = scheduledFactory.readwrite({
          ...rawScheduledDb,
          scheduledJob: {
            ...rawScheduledDb.scheduledJob,
            insert: () => {
              throw delayCause
            },
          },
        } as never)
        const delayFailure = failureFromExit(
          yield* Effect.exit(
            delayDb.scheduledJob.schedule({
              scheduledAt: Stdb.ScheduleAt.interval("1 second"),
              note: "too long",
            }),
          ),
        )
        expect(delayFailure).toBeInstanceOf(StdbScheduleDelayTooLongError)
        expect((delayFailure as StdbScheduleDelayTooLongError).op).toBe(
          "db.scheduledJob.insert",
        )
        expect((delayFailure as StdbScheduleDelayTooLongError).cause).toBe(
          delayCause,
        )
      }),
  )

  it.effect(
    "encodes named composite range objects with a deepest range bound",
    () =>
      Effect.gen(function* () {
        const factory = StdbTesting.makeDbHandleFactory(IndexedModule)
        const rawDb = makeRawDb([adaRow])
        let receivedRange: unknown
        ;(
          rawDb.user.tenantName as {
            filter: (range: unknown) => Iterable<UserRow>
          }
        ).filter = (range: unknown) => {
          receivedRange = range
          return [].values()
        }

        const db = factory.readwrite(rawDb as never)
        const nameRange = {
          from: {
            tag: "included" as const,
            value: "Ada",
          },
          to: {
            tag: "excluded" as const,
            value: "Bea",
          },
        }

        expect(
          yield* db.user.tenantName.filterToArray({
            tenant: "tenant-a",
            name: nameRange,
          } as never),
        ).toEqual([])
        expect(receivedRange).toEqual(["tenant-a", nameRange])
      }),
  )

  it.effect("wraps iterator next, return, and throw failures with labels", () =>
    Effect.gen(function* () {
      const factory = StdbTesting.makeDbHandleFactory(IndexedModule)
      const throwingIterator = () => ({
        next: () => {
          throw new Error("next failed")
        },
        return: () => {
          throw new Error("return failed")
        },
        throw: () => {
          throw new Error("throw failed")
        },
        [Symbol.iterator]() {
          return this
        },
      })
      const db = factory.readwrite({
        user: {
          count: () => 0n,
          iter: throwingIterator,
          insert: (row: UserRow) => row,
          delete: (_row: UserRow) => false,
          id: {
            find: (_id: string) => undefined,
            delete: (_id: string) => false,
            update: (row: UserRow) => row,
          },
          emailTenant: {
            find: (_key: readonly [string, string]) => undefined,
            delete: (_key: readonly [string, string]) => false,
          },
          emailOnly: {
            filter: (_email: string) => [].values(),
            delete: (_email: string) => 0,
          },
          nameIndex: {
            filter: throwingIterator,
            delete: (_nameOrRange: string) => 0,
          },
        },
      } as never)
      const iterator =
        (yield* db.user.unsafe.iter()) as unknown as ThrowingIterator

      const streamFailure = failureFromExit(
        yield* Effect.exit(db.user.stream().pipe(Stream.runCollect)),
      )
      expect(streamFailure).toBeInstanceOf(StdbHostCallError)
      expect((streamFailure as StdbHostCallError).op).toBe("db.user.iter.next")

      const rangeStreamFailure = failureFromExit(
        yield* Effect.exit(
          db.user.nameIndex.filterStream("Ada").pipe(Stream.runCollect),
        ),
      )
      expect(rangeStreamFailure).toBeInstanceOf(StdbHostCallError)
      expect((rangeStreamFailure as StdbHostCallError).op).toBe(
        "db.user.nameIndex.filter.next",
      )

      const nextFailure = failureFromExit(
        yield* Effect.exit(
          Effect.try({
            try: () => iterator.next(),
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/unit/db-handle",
            ),
          }),
        ),
      )
      expect(nextFailure).toBeInstanceOf(StdbHostCallError)
      expect((nextFailure as StdbHostCallError).op).toBe("db.user.iter.next")

      const returnFailure = failureFromExit(
        yield* Effect.exit(
          Effect.try({
            try: () => iterator.return?.(),
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/unit/db-handle",
            ),
          }),
        ),
      )
      expect(returnFailure).toBeInstanceOf(StdbHostCallError)
      expect((returnFailure as StdbHostCallError).op).toBe(
        "db.user.iter.return",
      )

      const throwFailure = failureFromExit(
        yield* Effect.exit(
          Effect.try({
            try: () => iterator.throw?.(new Error("boom")),
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/unit/db-handle",
            ),
          }),
        ),
      )
      expect(throwFailure).toBeInstanceOf(StdbHostCallError)
      expect((throwFailure as StdbHostCallError).op).toBe("db.user.iter.throw")
    }),
  )

  it.effect("closes safe stream iterators when consumers stop early", () =>
    Effect.gen(function* () {
      const factory = StdbTesting.makeDbHandleFactory(IndexedModule)
      let index = 0
      let returnCount = 0
      const iterator = {
        next: () =>
          index < 2
            ? {
                done: false,
                value: [adaRow, bobRow][index++],
              }
            : {
                done: true,
                value: undefined,
              },
        return: () => {
          returnCount = returnCount + 1
          return {
            done: true,
            value: undefined,
          }
        },
        [Symbol.iterator]() {
          return this
        },
      }
      const db = factory.readwrite({
        user: {
          count: () => 2n,
          iter: () => iterator,
          insert: (row: UserRow) => row,
          delete: (_row: UserRow) => false,
          id: {
            find: (_id: string) => undefined,
            delete: (_id: string) => false,
            update: (row: UserRow) => row,
          },
          emailTenant: {
            find: (_key: readonly [string, string]) => undefined,
            delete: (_key: readonly [string, string]) => false,
          },
          emailOnly: {
            filter: (_email: string) => [].values(),
            delete: (_email: string) => 0,
          },
          nameIndex: {
            filter: (_nameOrRange: string) => [].values(),
            delete: (_nameOrRange: string) => 0,
          },
        },
      } as never)

      expect(
        yield* db.user.stream().pipe(Stream.take(1), Stream.runCollect),
      ).toEqual([adaRow])
      expect(returnCount).toBe(1)
    }),
  )
})
