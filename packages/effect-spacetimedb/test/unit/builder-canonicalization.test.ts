import * as EffectVitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as FastCheck from "effect/testing/FastCheck"
import * as Stdb from "effect-spacetimedb"
import { nativeBytes } from "../helpers/native-serializer"

const { describe, expect, it } = EffectVitest

const propertyOptions = {
  fastCheck: { numRuns: 300, seed: 0xb017de4 },
} as const

const endpointNameList = FastCheck.uniqueArray(
  FastCheck.constantFrom("alpha", "bravo", "charlie", "delta", "echo"),
  { minLength: 2, maxLength: 5 },
)

const columnNameList = FastCheck.uniqueArray(
  FastCheck.constantFrom("alpha", "bravo", "charlie", "delta", "echo"),
  { minLength: 2, maxLength: 5 },
)

const tableNameList = FastCheck.uniqueArray(
  FastCheck.constantFrom(
    "alphaTable",
    "bravoTable",
    "charlieTable",
    "deltaTable",
    "echoTable",
  ),
  { minLength: 2, maxLength: 5 },
)

const StringDomain = Schema.String.pipe(
  Schema.brand("BuilderCanonicalization/StringDomain"),
)
const U64Domain = Schema.BigInt.pipe(
  Schema.brand("BuilderCanonicalization/U64Domain"),
)
const I32Domain = Schema.Finite.pipe(
  Schema.brand("BuilderCanonicalization/I32Domain"),
)

const sortedNames = (names: readonly string[]): ReadonlyArray<string> =>
  [...names].sort((left, right) => left.localeCompare(right))

const reversed = <A>(values: readonly A[]): ReadonlyArray<A> =>
  values.slice().reverse()

const columnTypeForOffset = (offset: number): Stdb.AnyValueType => {
  switch (offset % 4) {
    case 0:
      return Stdb.string(StringDomain)
    case 1:
      return Stdb.u64(U64Domain)
    case 2:
      return Stdb.bool()
    default:
      return Stdb.i32(I32Domain)
  }
}

const columnsFor = (
  names: readonly string[],
): Record<string, Stdb.AnyValueType> =>
  Object.fromEntries(
    names.map((name, offset) => [name, columnTypeForOffset(offset)]),
  )

const u64ColumnsFor = (
  names: readonly string[],
): Record<string, Stdb.AnyValueType> =>
  Object.fromEntries(names.map((name) => [name, Stdb.u64(U64Domain)]))

const tableWithColumns = (tableName: string, columnNames: readonly string[]) =>
  Stdb.table(tableName, {
    columns: columnsFor(columnNames),
  })

const addReducers = (
  names: readonly string[],
): Stdb.StdbGroupType<string, Stdb.AnyCallableDecl> => {
  let group: Stdb.StdbGroupType<string, Stdb.AnyCallableDecl> =
    Stdb.StdbGroup.make("Endpoints")

  for (const name of names) {
    group = group.add(
      Stdb.StdbFn.reducer(name, {
        params: Stdb.struct({}),
      }),
    )
  }

  return group
}

const addProcedures = (
  names: readonly string[],
): Stdb.StdbGroupType<string, Stdb.AnyCallableDecl> => {
  let group: Stdb.StdbGroupType<string, Stdb.AnyCallableDecl> =
    Stdb.StdbGroup.make("Endpoints")

  for (const name of names) {
    group = group.add(
      Stdb.StdbFn.procedure(name, {
        params: Stdb.struct({}),
        returns: Stdb.unit(),
      }),
    )
  }

  return group
}

describe("builder canonicalization", () => {
  it.prop(
    "reducer declaration order is name-canonicalized",
    [endpointNameList],
    ([names]) => {
      const forward = Stdb.StdbModule.make("m", {}).add(addReducers(names)).spec
      const backward = Stdb.StdbModule.make("m", {}).add(
        addReducers(reversed(names)),
      ).spec

      expect(Object.keys(forward.reducers)).toEqual(
        Object.keys(backward.reducers),
      )
      expect(Object.keys(forward.reducers)).toEqual(sortedNames(names))
    },
    propertyOptions,
  )

  it.prop(
    "procedure declaration order is name-canonicalized",
    [endpointNameList],
    ([names]) => {
      const forward = Stdb.StdbModule.make("m", {}).add(
        addProcedures(names),
      ).spec
      const backward = Stdb.StdbModule.make("m", {}).add(
        addProcedures(reversed(names)),
      ).spec

      expect(Object.keys(forward.procedures)).toEqual(
        Object.keys(backward.procedures),
      )
      expect(Object.keys(forward.procedures)).toEqual(sortedNames(names))
    },
    propertyOptions,
  )

  it.prop(
    "table and column declaration order is preserved",
    [columnNameList, tableNameList],
    ([columnNames, tableNames]) => {
      const forwardColumns = tableWithColumns("orderedTable", columnNames)
      const backwardColumns = tableWithColumns(
        "orderedTable",
        reversed(columnNames),
      )

      expect(Object.keys(forwardColumns.columns)).toEqual(columnNames)
      expect(Object.keys(backwardColumns.columns)).toEqual(
        reversed(columnNames),
      )
      expect(Object.keys(forwardColumns.columns)).not.toEqual(
        Object.keys(backwardColumns.columns),
      )

      const tables = tableNames.map((name) => tableWithColumns(name, ["id"]))
      const reversedTables = reversed(tables)
      const forwardModule = Stdb.StdbModule.make("m", {}).addTables(
        ...tables,
      ).spec
      const backwardModule = Stdb.StdbModule.make("m", {}).addTables(
        ...reversedTables,
      ).spec

      expect(Object.keys(forwardModule.tables)).toEqual(tableNames)
      expect(Object.keys(backwardModule.tables)).toEqual(reversed(tableNames))
      expect(Object.keys(forwardModule.tables)).not.toEqual(
        Object.keys(backwardModule.tables),
      )
    },
    propertyOptions,
  )

  it.prop(
    "authored column order reaches positional native bytes",
    [
      FastCheck.uniqueArray(
        FastCheck.constantFrom("alpha", "bravo", "charlie", "delta", "echo"),
        { minLength: 3, maxLength: 3 },
      ),
    ],
    ([columnNames]) => {
      const permutedColumnNames = reversed(columnNames)
      const forwardRow = Stdb.table("orderedTable", {
        columns: u64ColumnsFor(columnNames),
      }).row
      const backwardRow = Stdb.table("orderedTable", {
        columns: u64ColumnsFor(permutedColumnNames),
      }).row
      const values = Object.fromEntries(
        columnNames.map((name, offset) => [name, BigInt(offset + 1)]),
      )

      expect(Array.from(nativeBytes(forwardRow, values))).not.toEqual(
        Array.from(nativeBytes(backwardRow, values)),
      )
    },
    propertyOptions,
  )
})
