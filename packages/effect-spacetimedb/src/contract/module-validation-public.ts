import { StdbDiagnostic, StdbValidationError } from "./diagnostic.ts"

import { HttpRouterExportKey } from "./http-handler.ts"

import type { AnyModuleSpec } from "./module.ts"
import type { ServerHandlerDefinitions } from "./module-validation-common.ts"
import {
  assertDeclaredHandlersPresent,
  emptyWireNames,
  hasDuplicates,
  pushDiagnostic,
  validateLifecycle,
  wireName,
} from "./module-validation-common.ts"

import {
  validateGroupClientKeys,
  validateHttpHandlers,
} from "./module-validation-http-handlers.ts"

import { validateCanonicalModuleNames } from "./module-validation-naming.ts"

import {
  validateCallableTypes,
  validateScheduledTargets,
} from "./module-validation-scheduling.ts"
import {
  validateDeclaredErrorTags,
  validateTable,
  validateView,
} from "./module-validation-tables.ts"
import { isValueType, satsIdentifierOf } from "./type/core.ts"
import { children } from "./type/descriptor.ts"
import { satsTypeFingerprint } from "./type/fingerprint.ts"

const validateDuplicateDeclaredTypeNames = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
): void => {
  const seenNames = new Map<string, string>()
  const visited = new WeakSet<object>()
  const visit = (
    value: unknown,
    path: ReadonlyArray<string | number>,
  ): void => {
    if (!isValueType(value) || visited.has(value)) {
      return
    }
    visited.add(value)

    const identifier = satsIdentifierOf(value, undefined)
    if (identifier !== undefined) {
      try {
        const fingerprint = satsTypeFingerprint(value)
        const previous = seenNames.get(identifier)
        if (previous !== undefined && previous !== fingerprint) {
          pushDiagnostic(
            diagnostics,
            "DuplicateTypeName",
            path,
            `SATS type name ${identifier} is used for multiple different structures`,
          )
        } else if (previous === undefined) {
          seenNames.set(identifier, fingerprint)
        }
      } catch {
        // Structural validation reports malformed descriptors separately.
      }
    }

    try {
      for (const [index, child] of children(value).entries()) {
        visit(child, [...path, "children", index])
      }
    } catch {
      // Structural validation reports malformed descriptors separately.
    }
  }

  for (const [tableKey, table] of Object.entries(module.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      visit(column, ["tables", tableKey, "columns", columnName])
    }
  }
  for (const [key, view] of Object.entries(module.views)) {
    visit(view.returns, ["views", key, "returns"])
  }
  for (const [key, reducer] of Object.entries(module.reducers)) {
    visit(reducer.params, ["reducers", key, "params"])
  }
  for (const [key, procedure] of Object.entries(module.procedures)) {
    visit(procedure.params, ["procedures", key, "params"])
    visit(procedure.returns, ["procedures", key, "returns"])
  }
  for (const [key, httpHandler] of Object.entries(module.httpHandlers)) {
    visit(httpHandler.request, ["httpHandlers", key, "request"])
    visit(httpHandler.response, ["httpHandlers", key, "response"])
  }
}

export const validate = (
  module: AnyModuleSpec,
): ReadonlyArray<StdbDiagnostic> => {
  const diagnostics: Array<StdbDiagnostic> = []
  validateCanonicalModuleNames(diagnostics, module)
  const duplicateRelation = hasDuplicates([
    ...Object.values(module.tables).map((table) => table.name),
    ...Object.keys(module.views),
  ])
  if (duplicateRelation != null) {
    pushDiagnostic(
      diagnostics,
      "DuplicateRelationName",
      ["relations"],
      `Duplicate relation name across tables and views: ${duplicateRelation}`,
    )
  }

  const wireNames =
    (module as { readonly wireNames?: AnyModuleSpec["wireNames"] }).wireNames ??
    emptyWireNames
  const duplicateExport = hasDuplicates([
    ...Object.keys(module.reducers).map((key) =>
      wireName(wireNames.functions, key),
    ),
    ...Object.keys(module.procedures).map((key) =>
      wireName(wireNames.functions, key),
    ),
    ...Object.keys(module.httpHandlers).map((key) =>
      wireName(wireNames.functions, key),
    ),
    ...Object.keys(module.views).map((key) => wireName(wireNames.views, key)),
    ...Object.keys(module.lifecycle),
    HttpRouterExportKey,
  ])
  if (duplicateExport != null) {
    pushDiagnostic(
      diagnostics,
      "DuplicateCallableName",
      ["exports"],
      `Duplicate export name across reducers, procedures, HTTP handlers, views, lifecycle hooks, and reserved exports: ${duplicateExport}`,
    )
  }

  const completedValueTypes = new WeakSet<object>()
  for (const [tableKey, table] of Object.entries(module.tables)) {
    validateTable(
      diagnostics,
      tableKey,
      table,
      module.settings.caseConversionPolicy,
      completedValueTypes,
    )
  }

  for (const [viewKey, view] of Object.entries(module.views)) {
    validateView(diagnostics, viewKey, view, completedValueTypes)
  }

  validateHttpHandlers(diagnostics, module)
  validateLifecycle(diagnostics, module)
  validateGroupClientKeys(diagnostics, module)
  validateCallableTypes(diagnostics, module, completedValueTypes)
  validateScheduledTargets(diagnostics, module)
  validateDeclaredErrorTags(diagnostics, module)
  validateDuplicateDeclaredTypeNames(diagnostics, module)

  return diagnostics
}

export const validateServerHandlers = (
  module: AnyModuleSpec,
  handlers: ServerHandlerDefinitions,
): ReadonlyArray<StdbDiagnostic> => {
  const diagnostics: Array<StdbDiagnostic> = []
  assertDeclaredHandlersPresent(
    diagnostics,
    "reducers",
    Object.keys(module.reducers),
    handlers,
  )
  assertDeclaredHandlersPresent(
    diagnostics,
    "procedures",
    Object.keys(module.procedures),
    handlers,
  )
  assertDeclaredHandlersPresent(
    diagnostics,
    "httpHandlers",
    Object.keys(module.httpHandlers),
    handlers,
  )
  assertDeclaredHandlersPresent(
    diagnostics,
    "views",
    Object.keys(module.views),
    handlers,
  )
  assertDeclaredHandlersPresent(
    diagnostics,
    "lifecycle",
    Object.keys(module.lifecycle),
    handlers,
  )

  return diagnostics
}

export const assertValid = (module: AnyModuleSpec): void => {
  const diagnostics = validate(module).filter(
    (entry) => entry.severity === "error",
  )
  if (diagnostics.length > 0) {
    throw new StdbValidationError({ diagnostics })
  }
}
