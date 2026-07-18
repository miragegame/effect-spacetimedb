import {
  camelCaseName,
  isCamelCaseCanonical,
  snakeCaseName,
} from "./canonical-name.ts"

import {
  makeStdbDiagnostic,
  StdbDiagnostic,
  type StdbDiagnosticCode,
  type StdbDiagnosticSeverity,
} from "./diagnostic.ts"

import { isLifecycleName } from "./lifecycle.ts"

import {
  findInvalidStringLiteralTag,
  findStringLiteralTagCollision,
  invalidStringLiteralTagMessage,
  stringLiteralTagCollisionMessage,
} from "./literal-tags.ts"

import type { AnyModuleSpec } from "./module.ts"

import * as SchemaFallback from "./type/schema-fallback.ts"

import { type AnyValueType, typeInfo } from "./type.ts"

export type ServerHandlerDefinitions = {
  readonly reducers?: Readonly<Record<string, unknown>>
  readonly procedures?: Readonly<Record<string, unknown>>
  readonly httpHandlers?: Readonly<Record<string, unknown>>
  readonly views?: Readonly<Record<string, unknown>>
  readonly lifecycle?: Readonly<Record<string, unknown>>
}

export const hasDuplicates = (
  values: ReadonlyArray<string>,
): string | undefined => {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      return value
    }
    seen.add(value)
  }
  return undefined
}

export const wireName = (
  names: Readonly<Record<string, string>>,
  key: string,
): string => names[key] ?? key

export const emptyWireNames: AnyModuleSpec["wireNames"] = {
  tables: {},
  views: {},
  functions: {},
}

export const canonicalColumnSet = (columns: ReadonlyArray<string>): string =>
  columns.slice().sort().join("\u0000")

export const diagnostic = (
  code: StdbDiagnosticCode,
  path: ReadonlyArray<string | number>,
  message: string,
  severity: StdbDiagnosticSeverity = "error",
): StdbDiagnostic => makeStdbDiagnostic(code, path, message, severity)

export const pushDiagnostic = (
  diagnostics: Array<StdbDiagnostic>,
  code: StdbDiagnosticCode,
  path: ReadonlyArray<string | number>,
  message: string,
  severity?: StdbDiagnosticSeverity,
) => {
  diagnostics.push(diagnostic(code, path, message, severity ?? "error"))
}

export const validateCamelCaseDeclaredName = (
  diagnostics: Array<StdbDiagnostic>,
  path: ReadonlyArray<string | number>,
  label: string,
  name: string,
): void => {
  if (isCamelCaseCanonical(name)) {
    return
  }

  pushDiagnostic(
    diagnostics,
    "NonCanonicalDeclaredName",
    path,
    `${label} ${name} must be a camelCase canonical fixed point; use ${camelCaseName(name)}`,
  )
}

export const validateCanonicalCollisions = (
  diagnostics: Array<StdbDiagnostic>,
  path: ReadonlyArray<string | number>,
  label: string,
  names: ReadonlyArray<string>,
  canonicalize: (name: string) => string,
): void => {
  const seen = new Map<string, string>()

  for (const name of names) {
    const canonical = canonicalize(name)
    const previous = seen.get(canonical)
    if (previous !== undefined && previous !== name) {
      pushDiagnostic(
        diagnostics,
        "CanonicalNameCollision",
        path,
        `${label} ${previous} and ${name} both canonicalize to ${canonical}`,
      )
    }

    if (previous === undefined) {
      seen.set(canonical, name)
    }
  }
}

export const validateLiteralTagCollisions = (
  diagnostics: Array<StdbDiagnostic>,
  path: ReadonlyArray<string | number>,
  values: ReadonlyArray<string | number | boolean>,
): void => {
  const stringValues = values.filter(
    (value): value is string => typeof value === "string",
  )
  const invalid = findInvalidStringLiteralTag(stringValues)
  if (invalid !== undefined) {
    pushDiagnostic(
      diagnostics,
      "InvalidLiteralTag",
      path,
      invalidStringLiteralTagMessage(invalid),
    )
  }

  const collision = findStringLiteralTagCollision(stringValues)
  if (collision !== undefined) {
    pushDiagnostic(
      diagnostics,
      "LiteralTagCollision",
      path,
      stringLiteralTagCollisionMessage(collision),
    )
  }
}

export const handlerSectionLabels = {
  reducers: "reducer",
  procedures: "procedure",
  httpHandlers: "HTTP handler",
  views: "view",
  lifecycle: "lifecycle",
} as const satisfies Record<keyof ServerHandlerDefinitions, string>

export const validateLifecycle = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
): void => {
  for (const [key, spec] of Object.entries(module.lifecycle)) {
    if (!isLifecycleName(key)) {
      pushDiagnostic(
        diagnostics,
        "UnknownEndpoint",
        ["lifecycle", key],
        `Unknown lifecycle hook ${key}`,
      )
      continue
    }

    if (spec.hook !== key) {
      pushDiagnostic(
        diagnostics,
        "LifecycleHookMismatch",
        ["lifecycle", key, "hook"],
        `Lifecycle hook key ${key} must match declared hook ${spec.hook}`,
      )
    }
  }
}

export const assertDeclaredHandlersPresent = (
  diagnostics: Array<StdbDiagnostic>,
  section: keyof ServerHandlerDefinitions,
  expected: ReadonlyArray<string>,
  handlers: ServerHandlerDefinitions,
) => {
  const actual = handlers[section] ?? {}
  for (const key of expected) {
    if (Object.hasOwn(actual, key)) {
      continue
    }

    pushDiagnostic(
      diagnostics,
      "MissingServerHandler",
      ["handlers", section, key],
      `Missing server ${handlerSectionLabels[section]} handler for ${key}`,
    )
  }
}

export const assertValidColumnSelection = (
  diagnostics: Array<StdbDiagnostic>,
  kind: "Index" | "Constraint",
  tableKey: string,
  name: string,
  columns: ReadonlyArray<string>,
  path: ReadonlyArray<string | number>,
) => {
  if (columns.length === 0) {
    pushDiagnostic(
      diagnostics,
      "EmptyColumnSelection",
      path,
      `${kind} ${name} on table ${tableKey} must reference at least one column`,
    )
  }

  const duplicateColumn = hasDuplicates(columns)
  if (duplicateColumn != null) {
    pushDiagnostic(
      diagnostics,
      "DuplicateSelectedColumn",
      path,
      `${kind} ${name} on table ${tableKey} references duplicate column ${duplicateColumn}`,
    )
  }
}

export const validateValueType = (
  diagnostics: Array<StdbDiagnostic>,
  value: unknown,
  path: ReadonlyArray<string | number>,
  visited: WeakSet<object> = new WeakSet<object>(),
  completed: WeakSet<object> = new WeakSet<object>(),
) => {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    pushDiagnostic(
      diagnostics,
      "UnsupportedTypeDescriptor",
      path,
      SchemaFallback.unsupportedTypeMessage(path),
    )
    return
  }

  // Shared invalid subtypes are reported at the first deterministic traversal
  // path. This avoids exponential DAG walks while retaining cycle detection.
  if (completed.has(value) || visited.has(value)) {
    return
  }
  visited.add(value)

  try {
    const info = typeInfo(value as AnyValueType)
    if (info == null) {
      pushDiagnostic(
        diagnostics,
        "UnsupportedTypeDescriptor",
        path,
        SchemaFallback.unsupportedTypeMessage(path),
      )
      return
    }

    if (info.lazy != null) {
      let inner: unknown
      let didResolveInner = false
      try {
        inner = info.lazy()
        didResolveInner = true
      } catch {
        pushDiagnostic(
          diagnostics,
          "UnsupportedTypeDescriptor",
          [...path, "lazy"],
          `Unsupported lazy SpaceTimeDB type at ${[...path, "lazy"].join(".")}`,
        )
      }

      if (didResolveInner) {
        validateValueType(
          diagnostics,
          inner,
          [...path, "lazy"],
          visited,
          completed,
        )
      }
    }

    if (info.fields != null) {
      for (const [fieldName, fieldType] of Object.entries(info.fields)) {
        validateValueType(
          diagnostics,
          fieldType,
          [...path, fieldName],
          visited,
          completed,
        )
      }
    }

    if (info.item != null) {
      validateValueType(
        diagnostics,
        info.item,
        [...path, "item"],
        visited,
        completed,
      )
    }

    if (info.members != null) {
      for (const [index, member] of info.members.entries()) {
        validateValueType(
          diagnostics,
          member,
          [...path, "members", index],
          visited,
          completed,
        )
      }
    }
  } finally {
    visited.delete(value)
    completed.add(value)
  }
}

export const validateCanonicalValueTypeNames = (
  diagnostics: Array<StdbDiagnostic>,
  value: unknown,
  path: ReadonlyArray<string | number>,
  visited: WeakSet<object> = new WeakSet<object>(),
  includeStyle = true,
  completed: WeakSet<object> = new WeakSet<object>(),
): void => {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return
  }

  // See validateValueType: diagnostics for shared nodes use first-path wins.
  if (completed.has(value) || visited.has(value)) {
    return
  }
  visited.add(value)

  try {
    const info = typeInfo(value as AnyValueType)
    if (info == null) {
      return
    }

    if (info.kind === "struct") {
      const fields = info.fields ?? {}
      const fieldNames = Object.keys(fields)
      validateCanonicalCollisions(
        diagnostics,
        path,
        "Struct fields",
        fieldNames,
        snakeCaseName,
      )
      for (const [fieldName, fieldType] of Object.entries(fields)) {
        const fieldPath = [...path, fieldName]
        if (includeStyle) {
          validateCamelCaseDeclaredName(
            diagnostics,
            fieldPath,
            "Struct field",
            fieldName,
          )
        }
        validateCanonicalValueTypeNames(
          diagnostics,
          fieldType,
          fieldPath,
          visited,
          includeStyle,
          completed,
        )
      }
      return
    }

    if (info.kind === "sum") {
      const variants = info.variants ?? {}
      const tags = Object.keys(variants)
      validateCanonicalCollisions(
        diagnostics,
        path,
        "Sum variants",
        tags,
        camelCaseName,
      )
      for (const [tag, variantType] of Object.entries(variants)) {
        const variantPath = [...path, tag]
        if (includeStyle) {
          validateCamelCaseDeclaredName(
            diagnostics,
            variantPath,
            "Sum variant",
            tag,
          )
        }
        validateCanonicalValueTypeNames(
          diagnostics,
          variantType,
          variantPath,
          visited,
          includeStyle,
          completed,
        )
      }
      return
    }

    if (info.kind === "literal" && info.values != null) {
      validateLiteralTagCollisions(diagnostics, path, info.values)
      return
    }

    if (info.lazy != null) {
      try {
        validateCanonicalValueTypeNames(
          diagnostics,
          info.lazy(),
          [...path, "lazy"],
          visited,
          includeStyle,
          completed,
        )
      } catch {
        return
      }
    }

    if (info.item != null) {
      validateCanonicalValueTypeNames(
        diagnostics,
        info.item,
        [...path, "item"],
        visited,
        includeStyle,
        completed,
      )
    }

    if (info.members != null) {
      for (const [index, member] of info.members.entries()) {
        validateCanonicalValueTypeNames(
          diagnostics,
          member,
          [...path, "members", index],
          visited,
          includeStyle,
          completed,
        )
      }
    }
  } finally {
    visited.delete(value)
    completed.add(value)
  }
}
