import { snakeCaseName } from "./canonical-name.ts"
import { StdbDiagnostic } from "./diagnostic.ts"
import type { AnyModuleSpec } from "./module.ts"
import {
  validateCamelCaseDeclaredName,
  validateCanonicalCollisions,
  validateCanonicalValueTypeNames,
} from "./module-validation-common.ts"
import type { AnyTableSpec } from "./table.ts"
import { reflect } from "../reflect.ts"

export const isSynthesizedUniqueConstraint = (constraint: {
  readonly name: string
  readonly columns: ReadonlyArray<string>
}): boolean =>
  constraint.columns.length === 1 &&
  constraint.name === `${constraint.columns[0]}_unique`

export const validateCanonicalTableNames = (
  diagnostics: Array<StdbDiagnostic>,
  tableKey: string,
  table: AnyTableSpec,
  completed: WeakSet<object>,
): void => {
  validateCamelCaseDeclaredName(
    diagnostics,
    ["tables", tableKey, "name"],
    "Table",
    table.name,
  )

  const columnNames = Object.keys(table.columns)
  validateCanonicalCollisions(
    diagnostics,
    ["tables", tableKey, "columns"],
    "Table columns",
    columnNames,
    snakeCaseName,
  )
  for (const [columnName, column] of Object.entries(table.columns)) {
    const columnPath = ["tables", tableKey, "columns", columnName]
    validateCamelCaseDeclaredName(diagnostics, columnPath, "Column", columnName)
    validateCanonicalValueTypeNames(
      diagnostics,
      column,
      columnPath,
      new WeakSet<object>(),
      true,
      completed,
    )
  }

  validateCanonicalCollisions(
    diagnostics,
    ["tables", tableKey, "indexes"],
    "Index accessors",
    table.indexes.map((index) => index.name),
    snakeCaseName,
  )
  for (const [indexOffset, index] of table.indexes.entries()) {
    validateCamelCaseDeclaredName(
      diagnostics,
      ["tables", tableKey, "indexes", indexOffset, "name"],
      "Index accessor",
      index.name,
    )
  }

  const authoredConstraints = table.constraints.filter(
    (constraint) => !isSynthesizedUniqueConstraint(constraint),
  )
  validateCanonicalCollisions(
    diagnostics,
    ["tables", tableKey, "constraints"],
    "Constraint labels",
    authoredConstraints.map((constraint) => constraint.name),
    snakeCaseName,
  )
  for (const [constraintOffset, constraint] of table.constraints.entries()) {
    if (isSynthesizedUniqueConstraint(constraint)) {
      continue
    }

    validateCamelCaseDeclaredName(
      diagnostics,
      ["tables", tableKey, "constraints", constraintOffset, "name"],
      "Constraint label",
      constraint.name,
    )
  }
}

export const validateCanonicalModuleNames = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
): void => {
  const completed = new WeakSet<object>()
  if (module.settings.caseConversionPolicy === "none") {
    reflect(module, {
      onTable: ({ name, spec }) => {
        for (const [columnName, column] of Object.entries(spec.columns)) {
          validateCanonicalValueTypeNames(
            diagnostics,
            column,
            ["tables", name, "columns", columnName],
            new WeakSet<object>(),
            false,
            completed,
          )
        }
      },
      onView: ({ name, spec }) =>
        validateCanonicalValueTypeNames(
          diagnostics,
          spec.returns,
          ["views", name, "returns"],
          new WeakSet<object>(),
          false,
          completed,
        ),
      onReducer: ({ name, spec }) =>
        validateCanonicalValueTypeNames(
          diagnostics,
          spec.params,
          ["reducers", name, "params"],
          new WeakSet<object>(),
          false,
          completed,
        ),
      onProcedure: ({ name, spec }) => {
        validateCanonicalValueTypeNames(
          diagnostics,
          spec.params,
          ["procedures", name, "params"],
          new WeakSet<object>(),
          false,
          completed,
        )
        validateCanonicalValueTypeNames(
          diagnostics,
          spec.returns,
          ["procedures", name, "returns"],
          new WeakSet<object>(),
          false,
          completed,
        )
      },
      onHttpHandler: ({ name, spec }) => {
        if (spec.request !== undefined) {
          validateCanonicalValueTypeNames(
            diagnostics,
            spec.request,
            ["httpHandlers", name, "request"],
            new WeakSet<object>(),
            false,
            completed,
          )
        }
        if (spec.response !== undefined) {
          validateCanonicalValueTypeNames(
            diagnostics,
            spec.response,
            ["httpHandlers", name, "response"],
            new WeakSet<object>(),
            false,
            completed,
          )
        }
      },
    })
    return
  }

  validateCanonicalCollisions(
    diagnostics,
    ["relations"],
    "Relations",
    [
      ...Object.values(module.tables).map((table) => table.name),
      ...Object.keys(module.views),
    ],
    snakeCaseName,
  )
  validateCanonicalCollisions(
    diagnostics,
    ["functions"],
    "Functions",
    [
      ...Object.keys(module.reducers),
      ...Object.keys(module.procedures),
      ...Object.keys(module.views),
      ...Object.keys(module.httpHandlers),
    ],
    snakeCaseName,
  )

  reflect(module, {
    onTable: ({ name, spec }) =>
      validateCanonicalTableNames(diagnostics, name, spec, completed),
    onView: ({ name, spec }) => {
      validateCamelCaseDeclaredName(diagnostics, ["views", name], "View", name)
      validateCanonicalValueTypeNames(
        diagnostics,
        spec.returns,
        ["views", name, "returns"],
        new WeakSet<object>(),
        true,
        completed,
      )
    },
    onReducer: ({ name, spec }) => {
      validateCamelCaseDeclaredName(
        diagnostics,
        ["reducers", name],
        "Reducer",
        name,
      )
      validateCanonicalValueTypeNames(
        diagnostics,
        spec.params,
        ["reducers", name, "params"],
        new WeakSet<object>(),
        true,
        completed,
      )
    },
    onProcedure: ({ name, spec }) => {
      validateCamelCaseDeclaredName(
        diagnostics,
        ["procedures", name],
        "Procedure",
        name,
      )
      validateCanonicalValueTypeNames(
        diagnostics,
        spec.params,
        ["procedures", name, "params"],
        new WeakSet<object>(),
        true,
        completed,
      )
      validateCanonicalValueTypeNames(
        diagnostics,
        spec.returns,
        ["procedures", name, "returns"],
        new WeakSet<object>(),
        true,
        completed,
      )
    },
    onHttpHandler: ({ name, spec }) => {
      validateCamelCaseDeclaredName(
        diagnostics,
        ["httpHandlers", name],
        "HTTP handler",
        name,
      )
      if (spec.request !== undefined) {
        validateCanonicalValueTypeNames(
          diagnostics,
          spec.request,
          ["httpHandlers", name, "request"],
          new WeakSet<object>(),
          true,
          completed,
        )
      }
      if (spec.response !== undefined) {
        validateCanonicalValueTypeNames(
          diagnostics,
          spec.response,
          ["httpHandlers", name, "response"],
          new WeakSet<object>(),
          true,
          completed,
        )
      }
    },
  })
}
