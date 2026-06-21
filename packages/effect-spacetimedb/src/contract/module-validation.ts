import * as Match from "effect/Match"
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
  StdbValidationError,
} from "./diagnostic.ts"
import { isReservedDeclaredErrorTag, statusOf, tagOf } from "./error.ts"
import { fieldOptions } from "./field.ts"
import {
  type HttpHandlerSpec,
  HttpRouterExportKey,
  isTypedHttpHandlerSpec,
} from "./http-handler.ts"
import { isLifecycleName } from "./lifecycle.ts"
import {
  findInvalidStringLiteralTag,
  findStringLiteralTagCollision,
  invalidStringLiteralTagMessage,
  stringLiteralTagCollisionMessage,
} from "./literal-tags.ts"
import type { AnyModuleSpec } from "./module.ts"
import type { AnyTableSpec } from "./table.ts"
import * as SchemaFallback from "./type/schema-fallback.ts"
import {
  type AnyValueType,
  arrayItem,
  optionItem,
  structFields,
  type TypeKind,
  typeInfo,
} from "./type.ts"
import type { AnyViewSpec } from "./view.ts"

export {
  formatModuleDiagnostics,
  StdbDiagnostic,
  type StdbDiagnosticCode,
  type StdbDiagnosticSeverity,
  StdbValidationError,
} from "./diagnostic.ts"

export type ServerHandlerDefinitions = {
  readonly reducers?: Readonly<Record<string, unknown>>
  readonly procedures?: Readonly<Record<string, unknown>>
  readonly httpHandlers?: Readonly<Record<string, unknown>>
  readonly views?: Readonly<Record<string, unknown>>
  readonly lifecycle?: Readonly<Record<string, unknown>>
}

const hasDuplicates = (values: ReadonlyArray<string>): string | undefined => {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      return value
    }
    seen.add(value)
  }
  return undefined
}

const wireName = (
  names: Readonly<Record<string, string>>,
  key: string,
): string => names[key] ?? key

const emptyWireNames: AnyModuleSpec["wireNames"] = {
  tables: {},
  views: {},
  functions: {},
}

const canonicalColumnSet = (columns: ReadonlyArray<string>): string =>
  columns.slice().sort().join("\u0000")

const diagnostic = (
  code: StdbDiagnosticCode,
  path: ReadonlyArray<string | number>,
  message: string,
  severity: StdbDiagnosticSeverity = "error",
): StdbDiagnostic => makeStdbDiagnostic(code, path, message, severity)

const pushDiagnostic = (
  diagnostics: Array<StdbDiagnostic>,
  code: StdbDiagnosticCode,
  path: ReadonlyArray<string | number>,
  message: string,
  severity?: StdbDiagnosticSeverity,
) => {
  diagnostics.push(diagnostic(code, path, message, severity ?? "error"))
}

const validateCamelCaseDeclaredName = (
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

const validateCanonicalCollisions = (
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

const validateLiteralTagCollisions = (
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

const handlerSectionLabels = {
  reducers: "reducer",
  procedures: "procedure",
  httpHandlers: "HTTP handler",
  views: "view",
  lifecycle: "lifecycle",
} as const satisfies Record<keyof ServerHandlerDefinitions, string>

const validateLifecycle = (
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
        "UnknownEndpoint",
        ["lifecycle", key, "hook"],
        `Lifecycle hook ${key} must be declared with matching spec hook ${key}`,
      )
    }
  }
}

const assertDeclaredHandlersPresent = (
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

const assertValidColumnSelection = (
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

const validateValueType = (
  diagnostics: Array<StdbDiagnostic>,
  value: unknown,
  path: ReadonlyArray<string | number>,
  visited: WeakSet<object> = new WeakSet<object>(),
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

  if (visited.has(value)) {
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
        validateValueType(diagnostics, inner, [...path, "lazy"], visited)
      }
    }

    if (info.fields != null) {
      for (const [fieldName, fieldType] of Object.entries(info.fields)) {
        validateValueType(diagnostics, fieldType, [...path, fieldName], visited)
      }
    }

    if (info.item != null) {
      validateValueType(diagnostics, info.item, [...path, "item"], visited)
    }

    if (info.members != null) {
      for (const [index, member] of info.members.entries()) {
        validateValueType(
          diagnostics,
          member,
          [...path, "members", index],
          visited,
        )
      }
    }
  } finally {
    visited.delete(value)
  }
}

const validateCanonicalValueTypeNames = (
  diagnostics: Array<StdbDiagnostic>,
  value: unknown,
  path: ReadonlyArray<string | number>,
  visited: WeakSet<object> = new WeakSet<object>(),
): void => {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return
  }

  if (visited.has(value)) {
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
        validateCamelCaseDeclaredName(
          diagnostics,
          fieldPath,
          "Struct field",
          fieldName,
        )
        validateCanonicalValueTypeNames(
          diagnostics,
          fieldType,
          fieldPath,
          visited,
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
        validateCamelCaseDeclaredName(
          diagnostics,
          variantPath,
          "Sum variant",
          tag,
        )
        validateCanonicalValueTypeNames(
          diagnostics,
          variantType,
          variantPath,
          visited,
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
      )
    }

    if (info.members != null) {
      for (const [index, member] of info.members.entries()) {
        validateCanonicalValueTypeNames(
          diagnostics,
          member,
          [...path, "members", index],
          visited,
        )
      }
    }
  } finally {
    visited.delete(value)
  }
}

const isColumnTypeKind = (
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

const isScheduleAtColumnType = (value: unknown): boolean =>
  isColumnTypeKind(value, "scheduleAt")

const isU64ColumnType = (value: unknown): boolean =>
  isColumnTypeKind(value, "u64")

const validateTable = (
  diagnostics: Array<StdbDiagnostic>,
  tableKey: string,
  table: AnyTableSpec,
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
  const hasScheduleAtColumn = Object.values(table.columns).some((column) =>
    isScheduleAtColumnType(column),
  )
  for (const [columnName, column] of Object.entries(table.columns)) {
    validateValueType(diagnostics, column, [
      "tables",
      tableKey,
      "columns",
      columnName,
    ])
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

const isStructValueType = (
  value: Parameters<typeof structFields>[0],
): boolean => structFields(value) !== undefined

const validateView = (
  diagnostics: Array<StdbDiagnostic>,
  viewKey: string,
  view: AnyViewSpec,
) => {
  validateValueType(diagnostics, view.returns, ["views", viewKey, "returns"])

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

const validateDeclaredErrorTags = (
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
  const definitions = [
    ...Object.entries(module.reducers).map(([key, reducer]) => ({
      section: "reducers" as const,
      key,
      definition: reducer.errors,
    })),
    ...Object.entries(module.procedures).map(([key, procedure]) => ({
      section: "procedures" as const,
      key,
      definition: procedure.errors,
    })),
    ...Object.entries(module.httpHandlers).map(([key, httpHandler]) => ({
      section: "httpHandlers" as const,
      key,
      definition: httpHandler.errors,
    })),
  ]

  for (const { definition, key, section } of definitions) {
    if (definition == null) {
      continue
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
}

const routePathAllowedCharacter = (char: string): boolean =>
  (char >= "a" && char <= "z") ||
  (char >= "0" && char <= "9") ||
  char === "-" ||
  char === "_" ||
  char === "~" ||
  char === "/"

const validateHttpHandlerPath = (
  diagnostics: Array<StdbDiagnostic>,
  key: string,
  spec: HttpHandlerSpec,
): void => {
  const path = spec.path
  const diagnosticPath = ["httpHandlers", key, "path"]
  if (path.length === 0) {
    pushDiagnostic(
      diagnostics,
      "InvalidHttpHandlerPath",
      diagnosticPath,
      `HTTP handler ${key} path must not be empty`,
    )
    return
  }

  if (!path.startsWith("/")) {
    pushDiagnostic(
      diagnostics,
      "InvalidHttpHandlerPath",
      diagnosticPath,
      `HTTP handler ${key} path must start with /`,
    )
  }

  const invalidCharacter = [...path].find(
    (char) => !routePathAllowedCharacter(char),
  )
  if (invalidCharacter != null) {
    pushDiagnostic(
      diagnostics,
      "InvalidHttpHandlerPath",
      diagnosticPath,
      `HTTP handler ${key} path contains unsupported character ${invalidCharacter}; use lowercase letters, digits, -, _, ~, and /`,
    )
  }

  if (path.length > 1 && path.endsWith("/")) {
    pushDiagnostic(
      diagnostics,
      "InvalidHttpHandlerPath",
      diagnosticPath,
      `HTTP handler ${key} path must not end with / unless it is the root path`,
    )
  }
}

export const httpHandlerRoutesOverlap = (
  left: HttpHandlerSpec,
  right: HttpHandlerSpec,
): boolean =>
  left.path === right.path &&
  (left.method === "any" ||
    right.method === "any" ||
    left.method === right.method)

const validateHttpHandlerSchemaMode = (
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

const validateHttpHandlerErrorStatuses = (
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

const javascriptIdentifierToken = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const validateHttpGroupClientKeys = (
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

const validateHttpHandlers = (
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

const validateScheduledTargets = (
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

const validateCallableTypes = (
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

const isSynthesizedUniqueConstraint = (constraint: {
  readonly name: string
  readonly columns: ReadonlyArray<string>
}): boolean =>
  constraint.columns.length === 1 &&
  constraint.name === `${constraint.columns[0]}_unique`

const validateCanonicalTableNames = (
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

const validateCanonicalModuleNames = (
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
