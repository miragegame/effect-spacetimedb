import * as Match from "effect/Match"

import { snakeCaseName } from "./canonical-name.ts"

import { StdbDiagnostic } from "./diagnostic.ts"

import { statusOf, tagOf } from "./error.ts"

import { type HttpHandlerSpec, isTypedHttpHandlerSpec } from "./http-handler.ts"

import type { AnyModuleSpec } from "./module.ts"

import type { AnyTableSpec } from "./table.ts"

import { structFields } from "./type.ts"

import {
  pushDiagnostic,
  validateCamelCaseDeclaredName,
  validateCanonicalCollisions,
  validateCanonicalValueTypeNames,
  validateValueType,
} from "./module-validation-common.ts"

import { validateHttpHandlerPath } from "./module-validation-http.ts"

export const httpHandlerRoutesOverlap = (
  left: HttpHandlerSpec,
  right: HttpHandlerSpec,
): boolean =>
  left.path === right.path &&
  (left.method === "any" ||
    right.method === "any" ||
    left.method === right.method)

export const validateHttpHandlerSchemaMode = (
  diagnostics: Array<StdbDiagnostic>,
  key: string,
  spec: HttpHandlerSpec,
): void => {
  const ownsRequest = Object.hasOwn(spec, "request")
  const ownsResponse = Object.hasOwn(spec, "response")
  const hasRequestSchema = spec.request !== undefined
  const hasResponseSchema = spec.response !== undefined
  if (hasRequestSchema && hasResponseSchema && ownsRequest && ownsResponse) {
    return
  }

  if (!ownsRequest && !ownsResponse) {
    return
  }

  pushDiagnostic(
    diagnostics,
    "InvalidHttpHandlerSchemaMode",
    ["httpHandlers", key],
    `HTTP handler ${key} must define both request and response schemas, or neither`,
  )
}

export const validateHttpHandlerErrorStatuses = (
  diagnostics: Array<StdbDiagnostic>,
  key: string,
  spec: HttpHandlerSpec,
): void => {
  if (!isTypedHttpHandlerSpec(spec) || spec.errors === undefined) {
    return
  }

  const missingTags = spec.errors.errors
    .filter((errorClass) => statusOf(errorClass) === undefined)
    .map((errorClass) => tagOf(errorClass))

  if (missingTags.length === 0) {
    return
  }

  pushDiagnostic(
    diagnostics,
    "HttpRouteMissingErrorStatus",
    ["httpHandlers", key, "errors"],
    `Typed HTTP handler ${key} declares errors without HTTP statuses: ${missingTags.join(", ")}`,
  )
}

export const javascriptIdentifierToken = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export const validateHttpGroupClientKeys = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
): void => {
  const seen = new Set<string>()
  for (const [routeName, groupName] of Object.entries(module.httpGroups)) {
    if (seen.has(groupName)) {
      continue
    }
    seen.add(groupName)

    if (javascriptIdentifierToken.test(groupName)) {
      continue
    }

    pushDiagnostic(
      diagnostics,
      "InvalidHttpGroupClientKey",
      ["httpGroups", routeName],
      `HTTP group ${groupName} becomes an HttpApiClient property key but is not a valid JavaScript identifier`,
      "warning",
    )
  }
}

export const validateHttpHandlers = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
): void => {
  const entries = Object.entries(module.httpHandlers)
  for (const [key, spec] of entries) {
    validateHttpHandlerPath(diagnostics, key, spec)
    validateHttpHandlerSchemaMode(diagnostics, key, spec)
    validateHttpHandlerErrorStatuses(diagnostics, key, spec)
  }

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const left = entries[leftIndex]
    if (left == null) {
      continue
    }

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < entries.length;
      rightIndex += 1
    ) {
      const right = entries[rightIndex]
      if (right == null) {
        continue
      }

      if (!httpHandlerRoutesOverlap(left[1], right[1])) {
        continue
      }

      pushDiagnostic(
        diagnostics,
        "DuplicateHttpHandlerRoute",
        ["httpHandlers", right[0]],
        `HTTP handler ${right[0]} route ${right[1].method.toUpperCase()} ${right[1].path} overlaps with ${left[0]} route ${left[1].method.toUpperCase()} ${left[1].path}`,
      )
    }
  }
}

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
) => {
  for (const [key, reducer] of Object.entries(module.reducers)) {
    validateValueType(diagnostics, reducer.params, ["reducers", key, "params"])
  }

  for (const [key, procedure] of Object.entries(module.procedures)) {
    validateValueType(diagnostics, procedure.params, [
      "procedures",
      key,
      "params",
    ])
    validateValueType(diagnostics, procedure.returns, [
      "procedures",
      key,
      "returns",
    ])
  }
}

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
    validateCanonicalValueTypeNames(diagnostics, column, columnPath)
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
  if (module.settings.caseConversionPolicy === "none") {
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

  for (const [tableKey, table] of Object.entries(module.tables)) {
    validateCanonicalTableNames(diagnostics, tableKey, table)
  }

  for (const [viewKey, view] of Object.entries(module.views)) {
    validateCamelCaseDeclaredName(
      diagnostics,
      ["views", viewKey],
      "View",
      viewKey,
    )
    validateCanonicalValueTypeNames(diagnostics, view.returns, [
      "views",
      viewKey,
      "returns",
    ])
  }

  for (const [key, reducer] of Object.entries(module.reducers)) {
    validateCamelCaseDeclaredName(
      diagnostics,
      ["reducers", key],
      "Reducer",
      key,
    )
    validateCanonicalValueTypeNames(diagnostics, reducer.params, [
      "reducers",
      key,
      "params",
    ])
  }

  for (const [key, procedure] of Object.entries(module.procedures)) {
    validateCamelCaseDeclaredName(
      diagnostics,
      ["procedures", key],
      "Procedure",
      key,
    )
    validateCanonicalValueTypeNames(diagnostics, procedure.params, [
      "procedures",
      key,
      "params",
    ])
    validateCanonicalValueTypeNames(diagnostics, procedure.returns, [
      "procedures",
      key,
      "returns",
    ])
  }

  for (const [key, httpHandler] of Object.entries(module.httpHandlers)) {
    validateCamelCaseDeclaredName(
      diagnostics,
      ["httpHandlers", key],
      "HTTP handler",
      key,
    )
    if (httpHandler.request !== undefined) {
      validateCanonicalValueTypeNames(diagnostics, httpHandler.request, [
        "httpHandlers",
        key,
        "request",
      ])
    }
    if (httpHandler.response !== undefined) {
      validateCanonicalValueTypeNames(diagnostics, httpHandler.response, [
        "httpHandlers",
        key,
        "response",
      ])
    }
  }
}
