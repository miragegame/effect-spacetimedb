import * as Match from "effect/Match"

import { canonicalNameForPolicy } from "./canonical-name.ts"

import { StdbDiagnostic } from "./diagnostic.ts"

import {
  type AnyErrorDefinition,
  isReservedDeclaredErrorTag,
  tagOf,
} from "./error.ts"
import { reflect } from "../reflect.ts"

import { fieldOptions } from "./field.ts"

import type { AnyModuleSpec } from "./module.ts"
import {
  assertValidColumnSelection,
  canonicalColumnSet,
  pushDiagnostic,
  validateValueType,
} from "./module-validation-common.ts"
import type { AnyTableSpec } from "./table.ts"
import type { ModuleSettings } from "./settings.ts"
import {
  type AnyValueType,
  arrayItem,
  optionItem,
  structFields,
  type TypeKind,
  typeInfo,
} from "./type.ts"
import type { AnyViewSpec } from "./view.ts"

export const isColumnTypeKind = (
  value: unknown,
  kind: TypeKind,
  visited: WeakSet<object> = new WeakSet<object>(),
): boolean => {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return false
  }

  if (visited.has(value)) {
    return false
  }
  visited.add(value)

  const info = typeInfo(value as AnyValueType)
  if (info === undefined) {
    return false
  }

  if (info.kind === kind) {
    return true
  }

  return Match.value(info.kind).pipe(
    Match.when("custom", () =>
      info.item != null ? isColumnTypeKind(info.item, kind, visited) : false,
    ),
    Match.when("lazy", () => {
      try {
        return info.lazy != null
          ? isColumnTypeKind(info.lazy(), kind, visited)
          : false
      } catch {
        return false
      }
    }),
    Match.whenOr(
      "array",
      "bigint",
      "bool",
      "bytes",
      "connectionId",
      "f32",
      "f64",
      "identity",
      "i8",
      "i16",
      "i32",
      "i64",
      "i128",
      "i256",
      "literal",
      "option",
      "result",
      "scheduleAt",
      "string",
      "struct",
      "sum",
      "timeDuration",
      "timestamp",
      "u8",
      "u16",
      "u32",
      "u64",
      "u128",
      "u256",
      "unit",
      "uuid",
      () => false,
    ),
    Match.exhaustive,
  )
}

export const isScheduleAtColumnType = (value: unknown): boolean =>
  isColumnTypeKind(value, "scheduleAt")

export const isU64ColumnType = (value: unknown): boolean =>
  isColumnTypeKind(value, "u64")

export const validateTable = (
  diagnostics: Array<StdbDiagnostic>,
  tableKey: string,
  table: AnyTableSpec,
  caseConversionPolicy: ModuleSettings["caseConversionPolicy"],
  completed: WeakSet<object>,
) => {
  if (table.event && table.scheduled) {
    pushDiagnostic(
      diagnostics,
      "EventScheduledTable",
      ["tables", tableKey],
      `Table ${tableKey} cannot be both an event table and a scheduled table`,
    )
  }

  const columnNames = Object.keys(table.columns)
  const nativeColumnNames = new Map<string, string>()
  const hasScheduleAtColumn = Object.values(table.columns).some((column) =>
    isScheduleAtColumnType(column),
  )
  for (const [columnName, column] of Object.entries(table.columns)) {
    const nativeName =
      fieldOptions(column).name ??
      canonicalNameForPolicy(caseConversionPolicy, columnName)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nativeName)) {
      pushDiagnostic(
        diagnostics,
        "InvalidNativeColumnName",
        ["tables", tableKey, "columns", columnName, "name"],
        `Native column name ${nativeName} must be a valid identifier`,
      )
    }
    const previous = nativeColumnNames.get(nativeName)
    if (previous !== undefined) {
      pushDiagnostic(
        diagnostics,
        "DuplicateNativeColumnName",
        ["tables", tableKey, "columns", columnName, "name"],
        `Columns ${previous} and ${columnName} both use native column name ${nativeName}`,
      )
    } else {
      nativeColumnNames.set(nativeName, columnName)
    }
    validateValueType(
      diagnostics,
      column,
      ["tables", tableKey, "columns", columnName],
      new WeakSet<object>(),
      completed,
    )
  }

  if (hasScheduleAtColumn && !table.scheduled) {
    pushDiagnostic(
      diagnostics,
      "ScheduleAtColumnOnTable",
      ["tables", tableKey, "columns"],
      `Table ${tableKey} has a scheduleAt() column; use Stdb.scheduledTable(...) so scheduledId and scheduler metadata are validated locally.`,
    )
  }

  if (table.scheduled) {
    const scheduledId = table.columns.scheduledId
    if (scheduledId === undefined) {
      pushDiagnostic(
        diagnostics,
        "ScheduledTableMissingScheduledIdColumn",
        ["tables", tableKey, "columns", "scheduledId"],
        `Scheduled table ${tableKey} must have a scheduledId u64 primary key autoInc column.`,
      )
    } else {
      const options = fieldOptions(scheduledId)
      if (
        !isU64ColumnType(scheduledId) ||
        !options.primaryKey ||
        !options.autoInc
      ) {
        pushDiagnostic(
          diagnostics,
          "ScheduledTableInvalidScheduledIdColumn",
          ["tables", tableKey, "columns", "scheduledId"],
          `Scheduled table ${tableKey} scheduledId column must be u64().primaryKey().autoInc().`,
        )
      }
    }
  }

  if (table.scheduled && !hasScheduleAtColumn) {
    pushDiagnostic(
      diagnostics,
      "ScheduledTableMissingScheduleAtColumn",
      ["tables", tableKey, "columns"],
      `Scheduled table ${tableKey} must have a scheduleAt() column.`,
    )
  }

  const primaryKeys = columnNames.filter(
    (columnName) => fieldOptions(table.columns[columnName]!).primaryKey,
  )

  if (primaryKeys.length > 1) {
    pushDiagnostic(
      diagnostics,
      "MultiplePrimaryKeys",
      ["tables", tableKey, "columns"],
      `Table ${tableKey} has multiple primary keys`,
    )
  }

  for (const [indexOffset, index] of table.indexes.entries()) {
    const indexPath = ["tables", tableKey, "indexes", indexOffset]
    assertValidColumnSelection(
      diagnostics,
      "Index",
      tableKey,
      index.name,
      index.columns,
      indexPath,
    )

    if (index.algorithm === "direct" && index.columns.length !== 1) {
      pushDiagnostic(
        diagnostics,
        "DirectIndexMultiColumn",
        indexPath,
        `Direct index ${index.name} on table ${tableKey} must reference exactly one column`,
      )
    }

    for (const column of index.columns) {
      if (!(column in table.columns)) {
        pushDiagnostic(
          diagnostics,
          "MissingSelectedColumn",
          indexPath,
          `Index ${index.name} on table ${tableKey} references missing column ${column}`,
        )
      }
    }
  }

  const effectiveIndexColumnSets = new Set<string>([
    ...table.indexes.map((index) => canonicalColumnSet(index.columns)),
  ])

  if (primaryKeys.length === 1) {
    effectiveIndexColumnSets.add(canonicalColumnSet(primaryKeys))
  }

  for (const [constraintOffset, constraint] of table.constraints.entries()) {
    const constraintPath = ["tables", tableKey, "constraints", constraintOffset]
    assertValidColumnSelection(
      diagnostics,
      "Constraint",
      tableKey,
      constraint.name,
      constraint.columns,
      constraintPath,
    )

    for (const column of constraint.columns) {
      if (!(column in table.columns)) {
        pushDiagnostic(
          diagnostics,
          "MissingSelectedColumn",
          constraintPath,
          `Constraint ${constraint.name} on table ${tableKey} references missing column ${column}`,
        )
      }
    }

    if (
      constraint.kind === "unique" &&
      !effectiveIndexColumnSets.has(canonicalColumnSet(constraint.columns))
    ) {
      pushDiagnostic(
        diagnostics,
        "UniqueConstraintMissingBackingIndex",
        constraintPath,
        `Unique constraint ${constraint.name} on table ${tableKey} must be backed by a matching index or primary key`,
      )
    }
  }
}

export const isStructValueType = (
  value: Parameters<typeof structFields>[0],
): boolean => structFields(value) !== undefined

export const validateView = (
  diagnostics: Array<StdbDiagnostic>,
  viewKey: string,
  view: AnyViewSpec,
  completed: WeakSet<object>,
) => {
  validateValueType(
    diagnostics,
    view.returns,
    ["views", viewKey, "returns"],
    new WeakSet<object>(),
    completed,
  )

  const arrayReturn = arrayItem(view.returns)
  if (arrayReturn != null && isStructValueType(arrayReturn)) {
    return
  }

  const optionReturn = optionItem(view.returns)
  if (optionReturn != null && isStructValueType(optionReturn)) {
    return
  }

  pushDiagnostic(
    diagnostics,
    "UnsupportedViewReturn",
    ["views", viewKey, "returns"],
    `View ${viewKey} must return Type.array(Type.struct(...)) or Type.option(Type.struct(...))`,
  )
}

export const validateDeclaredErrorTags = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
): void => {
  const declaredTags = new Map<
    string,
    {
      readonly errorClass: unknown
      readonly path: ReadonlyArray<string | number>
    }
  >()
  const visitDefinition = (
    section: "reducers" | "procedures" | "httpHandlers",
    key: string,
    definition: AnyErrorDefinition | undefined,
  ): void => {
    if (definition == null) {
      return
    }

    for (const errorClass of definition.errors) {
      const tag = tagOf(errorClass)
      const path = [section, key, "errors", tag]
      if (isReservedDeclaredErrorTag(tag)) {
        pushDiagnostic(
          diagnostics,
          "ReservedDeclaredErrorTag",
          path,
          `Declared error tag ${tag} is reserved by effect-spacetimedb`,
        )
      }

      const existing = declaredTags.get(tag)
      if (existing != null && existing.errorClass !== errorClass) {
        pushDiagnostic(
          diagnostics,
          "DuplicateDeclaredErrorTag",
          path,
          `Declared error tag ${tag} is mapped to different error classes in module ${module.name}; first declared at ${existing.path.join(".")}`,
        )
      }

      if (existing == null) {
        declaredTags.set(tag, {
          errorClass,
          path,
        })
      }
    }
  }

  reflect(module, {
    onReducer: ({ name, spec }) =>
      visitDefinition("reducers", name, spec.errors),
    onProcedure: ({ name, spec }) =>
      visitDefinition("procedures", name, spec.errors),
    onHttpHandler: ({ name, spec }) =>
      visitDefinition("httpHandlers", name, spec.errors),
  })
}
