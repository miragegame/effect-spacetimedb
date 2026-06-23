import { StdbDiagnostic, StdbValidationError } from "./diagnostic.ts"

import { HttpRouterExportKey } from "./http-handler.ts"

import type { AnyModuleSpec } from "./module.ts"

import {
  assertDeclaredHandlersPresent,
  emptyWireNames,
  hasDuplicates,
  pushDiagnostic,
  validateLifecycle,
  wireName,
} from "./module-validation-common.ts"

import {
  validateDeclaredErrorTags,
  validateTable,
  validateView,
} from "./module-validation-http.ts"

import {
  validateCallableTypes,
  validateCanonicalModuleNames,
  validateHttpGroupClientKeys,
  validateHttpHandlers,
  validateScheduledTargets,
} from "./module-validation-schedule.ts"

import type { ServerHandlerDefinitions } from "./module-validation-common.ts"

export const validateModule = (
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

  for (const [tableKey, table] of Object.entries(module.tables)) {
    validateTable(diagnostics, tableKey, table)
  }

  for (const [viewKey, view] of Object.entries(module.views)) {
    validateView(diagnostics, viewKey, view)
  }

  validateHttpHandlers(diagnostics, module)
  validateLifecycle(diagnostics, module)
  validateHttpGroupClientKeys(diagnostics, module)
  validateCallableTypes(diagnostics, module)
  validateScheduledTargets(diagnostics, module)
  validateDeclaredErrorTags(diagnostics, module)

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

export const assertValidModule = (module: AnyModuleSpec): void => {
  const diagnostics = validateModule(module).filter(
    (entry) => entry.severity === "error",
  )
  if (diagnostics.length > 0) {
    throw new StdbValidationError({ diagnostics })
  }
}
