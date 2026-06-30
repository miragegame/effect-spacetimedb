import * as EffectVitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as FastCheck from "effect/testing/FastCheck"
import * as Stdb from "effect-spacetimedb"

const { describe, expect, it } = EffectVitest

const propertyOptions = {
  fastCheck: { numRuns: 300, seed: 0x51dbda7 },
} as const

const emptyWireNames: Stdb.AnyModuleSpec["wireNames"] = {
  tables: {},
  views: {},
  functions: {},
}

const withWireNames = (
  module: Omit<Stdb.AnyModuleSpec, "wireNames">,
  wireNames: Stdb.AnyModuleSpec["wireNames"] = emptyWireNames,
): Stdb.AnyModuleSpec => ({
  ...module,
  wireNames,
})

const moduleWithTables = (
  tables: Record<string, Stdb.AnyTableSpec>,
): Stdb.AnyModuleSpec =>
  withWireNames({
    kind: "module",
    name: "validationProperties",
    settings: {},
    tables,
    views: {},
    reducers: {},
    procedures: {},
    httpHandlers: {},
    httpGroups: {},
    lifecycle: {},
  })

const StringDomain = Schema.String.pipe(
  Schema.brand("ValidationProperties/StringDomain"),
)
const U64Domain = Schema.BigInt.pipe(
  Schema.brand("ValidationProperties/U64Domain"),
)

const idColumn = () => Stdb.u64(U64Domain).primaryKey()

const textColumn = () => Stdb.string(StringDomain)

const expectOnlyDiagnostic = (
  diagnostics: ReadonlyArray<Stdb.StdbDiagnostic>,
  code: Stdb.StdbDiagnosticCode,
  path: ReadonlyArray<string | number>,
) => {
  expect(diagnostics).toEqual([
    expect.objectContaining({
      code,
      path,
      severity: "error",
    }),
  ])
}

const validTableNames = FastCheck.uniqueArray(
  FastCheck.constantFrom("alphaTable", "bravoTable", "charlieTable"),
  { minLength: 1, maxLength: 2 },
)

const validEndpointNames = FastCheck.uniqueArray(
  FastCheck.constantFrom(
    "alphaReducer",
    "bravoReducer",
    "charlieReducer",
    "alphaProcedure",
    "bravoProcedure",
    "charlieProcedure",
  ),
  { minLength: 0, maxLength: 3 },
)

const validInput = FastCheck.record({
  tableNames: validTableNames,
  endpointNames: validEndpointNames,
})

const validTable = (name: string): Stdb.AnyTableSpec =>
  Stdb.table(name, {
    columns: {
      id: idColumn(),
      label: textColumn(),
      enabled: Stdb.bool(),
    },
    indexes: [Stdb.index("labelIndex", ["label"])],
    constraints: [Stdb.unique("labelUnique", ["label"])],
  })

const validEndpointGroup = (options: {
  readonly reducers: readonly string[]
  readonly procedures: readonly string[]
}): Stdb.StdbGroupType<string, Stdb.AnyCallableDecl> => {
  let group: Stdb.StdbGroupType<string, Stdb.AnyCallableDecl> =
    Stdb.StdbGroup.make("ValidEndpoints")

  for (const name of options.reducers) {
    group = group.add(
      Stdb.StdbFn.reducer(name, {
        params: Stdb.struct({}),
      }),
    )
  }

  for (const name of options.procedures) {
    group = group.add(
      Stdb.StdbFn.procedure(name, {
        params: Stdb.struct({}),
        returns: Stdb.unit(),
      }),
    )
  }

  return group
}

describe("module validation properties", () => {
  it.prop(
    "generated valid modules produce no diagnostics",
    [validInput],
    ([input]) => {
      const tables = input.tableNames.map(validTable)
      const reducerNames = input.endpointNames.filter((name) =>
        name.endsWith("Reducer"),
      )
      const procedureNames = input.endpointNames.filter((name) =>
        name.endsWith("Procedure"),
      )
      const spec = Stdb.StdbModule.make("validGenerated", {})
        .addTables(...tables)
        .add(
          validEndpointGroup({
            reducers: reducerNames,
            procedures: procedureNames,
          }),
        ).spec

      expect(Stdb.validate(spec)).toEqual([])
    },
    propertyOptions,
  )

  it("reports exactly DuplicateRelationName for duplicate table names", () => {
    const diagnostics = Stdb.validate(
      moduleWithTables({
        first: Stdb.table("sharedTable", {
          columns: {
            id: idColumn(),
          },
        }),
        second: Stdb.table("sharedTable", {
          columns: {
            id: idColumn(),
          },
        }),
      }),
    )

    expectOnlyDiagnostic(diagnostics, "DuplicateRelationName", ["relations"])
  })

  it("reports exactly MultiplePrimaryKeys for two primary key columns", () => {
    const diagnostics = Stdb.validate(
      moduleWithTables({
        users: Stdb.table("users", {
          columns: {
            id: idColumn(),
            otherId: idColumn(),
          },
        }),
      }),
    )

    expectOnlyDiagnostic(diagnostics, "MultiplePrimaryKeys", [
      "tables",
      "users",
      "columns",
    ])
  })

  it("reports exactly EmptyColumnSelection for an empty index", () => {
    const diagnostics = Stdb.validate(
      moduleWithTables({
        users: Stdb.table("users", {
          columns: {
            id: idColumn(),
          },
          indexes: [Stdb.index("emptyIndex", [])],
        }),
      }),
    )

    expectOnlyDiagnostic(diagnostics, "EmptyColumnSelection", [
      "tables",
      "users",
      "indexes",
      0,
    ])
  })

  it("reports exactly DuplicateSelectedColumn for repeated index columns", () => {
    const diagnostics = Stdb.validate(
      moduleWithTables({
        users: Stdb.table("users", {
          columns: {
            id: idColumn(),
          },
          indexes: [Stdb.index("duplicateIndex", ["id", "id"])],
        }),
      }),
    )

    expectOnlyDiagnostic(diagnostics, "DuplicateSelectedColumn", [
      "tables",
      "users",
      "indexes",
      0,
    ])
  })

  it("reports exactly MissingSelectedColumn for a missing index column", () => {
    const diagnostics = Stdb.validate(
      moduleWithTables({
        users: Stdb.table("users", {
          columns: {
            id: idColumn(),
          },
          indexes: [Stdb.index("missingIndex", ["missing"])],
        }),
      }),
    )

    expectOnlyDiagnostic(diagnostics, "MissingSelectedColumn", [
      "tables",
      "users",
      "indexes",
      0,
    ])
  })

  it("reports exactly DirectIndexMultiColumn for a multi-column direct index", () => {
    const diagnostics = Stdb.validate(
      moduleWithTables({
        users: Stdb.table("users", {
          columns: {
            id: idColumn(),
            label: textColumn(),
          },
          indexes: [
            Stdb.index("labelDirect", ["id", "label"], {
              algorithm: "direct",
            }),
          ],
        }),
      }),
    )

    expectOnlyDiagnostic(diagnostics, "DirectIndexMultiColumn", [
      "tables",
      "users",
      "indexes",
      0,
    ])
  })

  it("reports exactly UniqueConstraintMissingBackingIndex for an unbacked unique constraint", () => {
    const diagnostics = Stdb.validate(
      moduleWithTables({
        users: Stdb.table("users", {
          columns: {
            id: idColumn(),
            label: textColumn(),
          },
          constraints: [Stdb.unique("labelUnique", ["label"])],
        }),
      }),
    )

    expectOnlyDiagnostic(diagnostics, "UniqueConstraintMissingBackingIndex", [
      "tables",
      "users",
      "constraints",
      0,
    ])
  })
})
