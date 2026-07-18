import * as Match from "effect/Match"

import { StdbDiagnostic } from "./diagnostic.ts"

import type { AnyModuleSpec } from "./module.ts"
import {
  pushDiagnostic,
  validateValueType,
} from "./module-validation-common.ts"
import type { AnyTableSpec } from "./table.ts"
import { structFields } from "./type.ts"

export const validateScheduledTargets = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
): void => {
  const scheduledTargetsByTable = new Map<
    AnyTableSpec,
    {
      readonly key: string
      readonly section: "reducers" | "procedures"
    }
  >()
  const registeredTables = new Map<AnyTableSpec, string>()
  for (const [tableKey, table] of Object.entries(module.tables)) {
    registeredTables.set(table, tableKey)
  }

  const validateTarget = (
    section: "reducers" | "procedures",
    key: string,
    spec: { readonly params?: unknown; readonly scheduled?: unknown },
  ): void => {
    const scheduled = spec.scheduled
    if (scheduled === undefined) {
      return
    }

    if (
      typeof scheduled !== "object" ||
      scheduled === null ||
      !("table" in scheduled)
    ) {
      const targetKind = Match.value(section).pipe(
        Match.when("reducers", () => "reducer" as const),
        Match.when("procedures", () => "procedure" as const),
        Match.exhaustive,
      )
      pushDiagnostic(
        diagnostics,
        "InvalidScheduleTarget",
        [section, key, "scheduled"],
        `Scheduled ${targetKind} ${key} must reference a table object.`,
      )
      return
    }

    const table = (scheduled as { readonly table: unknown }).table
    const tableKey = registeredTables.get(table as AnyTableSpec)
    if (tableKey === undefined) {
      const candidates = [...registeredTables.values()]
      pushDiagnostic(
        diagnostics,
        "InvalidScheduleTarget",
        [section, key, "scheduled", "table"],
        candidates.length === 0
          ? `Scheduled target ${key} references an unregistered table, but this module does not declare tables.`
          : `Scheduled target ${key} references an unregistered table; expected one of ${candidates.join(", ")}.`,
      )
      return
    }

    const registeredTable = table as AnyTableSpec
    if (!registeredTable.scheduled) {
      pushDiagnostic(
        diagnostics,
        "InvalidScheduleTarget",
        [section, key, "scheduled", "table"],
        `Scheduled target ${key} references table ${tableKey}, but the table was not declared with Stdb.scheduledTable(...).`,
      )
    }

    const fields = structFields(
      spec.params as Parameters<typeof structFields>[0],
    )
    if (
      fields === undefined ||
      Object.keys(fields).length !== 1 ||
      fields.data !== registeredTable.row
    ) {
      pushDiagnostic(
        diagnostics,
        "InvalidScheduledTargetParams",
        [section, key, "params"],
        `Scheduled target ${key} params must be exactly Stdb.struct({ data: ${tableKey}.row }).`,
      )
    }

    const previous = scheduledTargetsByTable.get(registeredTable)
    if (previous !== undefined) {
      pushDiagnostic(
        diagnostics,
        "DuplicateScheduleTarget",
        [section, key, "scheduled", "table"],
        `Scheduled table ${tableKey} is already targeted by ${previous.section}.${previous.key}; each scheduled table may have only one target.`,
      )
      return
    }

    scheduledTargetsByTable.set(registeredTable, { key, section })
  }

  for (const [key, reducer] of Object.entries(module.reducers)) {
    validateTarget("reducers", key, reducer)
  }

  for (const [key, procedure] of Object.entries(module.procedures)) {
    validateTarget("procedures", key, procedure)
  }

  for (const [tableKey, table] of Object.entries(module.tables)) {
    if (!table.scheduled || scheduledTargetsByTable.has(table)) {
      continue
    }

    pushDiagnostic(
      diagnostics,
      "ScheduledTableWithoutTarget",
      ["tables", tableKey, "scheduled"],
      `Scheduled table ${tableKey} must be targeted by StdbFn.scheduledReducer(...) or StdbFn.scheduledProcedure(...).`,
    )
  }
}

export const validateCallableTypes = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
  completed: WeakSet<object>,
) => {
  for (const [key, reducer] of Object.entries(module.reducers)) {
    validateValueType(
      diagnostics,
      reducer.params,
      ["reducers", key, "params"],
      new WeakSet<object>(),
      completed,
    )
  }

  for (const [key, procedure] of Object.entries(module.procedures)) {
    validateValueType(
      diagnostics,
      procedure.params,
      ["procedures", key, "params"],
      new WeakSet<object>(),
      completed,
    )
    validateValueType(
      diagnostics,
      procedure.returns,
      ["procedures", key, "returns"],
      new WeakSet<object>(),
      completed,
    )
  }
}
