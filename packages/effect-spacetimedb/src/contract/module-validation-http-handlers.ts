import { StdbDiagnostic } from "./diagnostic.ts"
import { statusOf, tagOf } from "./error.ts"
import { type HttpHandlerSpec, isTypedHttpHandlerSpec } from "./http-handler.ts"
import type { AnyModuleSpec } from "./module.ts"
import { pushDiagnostic } from "./module-validation-common.ts"

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

export const routePathAllowedCharacter = (char: string): boolean =>
  (char >= "a" && char <= "z") ||
  (char >= "0" && char <= "9") ||
  char === "-" ||
  char === "_" ||
  char === "~" ||
  char === "/"

export const validateHttpHandlerPath = (
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

export const javascriptIdentifierToken = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export const RESERVED_GROUP_CLIENT_KEYS: ReadonlyArray<string> = [
  "reducers",
  "procedures",
  "httpHandlers",
  "moduleName",
  "cache",
  "isInvalidated",
  "observeInvalidation",
  "isActive",
  "subscribe",
  "subscribeTableRef",
  "subscribeRowRef",
  "subscribeTableGroupRef",
  "rowMatchesPrimaryKey",
  "streamEventTable",
  "streamRows",
  "tableGroup",
  "streamTableEvents",
  "streamTable",
  "streamTableWithContext",
  "streamTarget",
  "waitUntil",
  "connection",
  "identity",
  "token",
  "prototype",
  ...Object.getOwnPropertyNames(Object.prototype),
]

export const validateGroupClientKeys = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
): void => {
  const seen = new Set<string>()
  const reserved = new Set(RESERVED_GROUP_CLIENT_KEYS)
  const groupRecord = (
    key: "reducerGroups" | "procedureGroups" | "httpGroups",
  ): Record<string, string> => (Object.hasOwn(module, key) ? module[key] : {})
  const groupRecords = [
    ["reducerGroups", groupRecord("reducerGroups")],
    ["procedureGroups", groupRecord("procedureGroups")],
    ["httpGroups", groupRecord("httpGroups")],
  ] as const

  for (const [section, groups] of groupRecords) {
    for (const [endpointName, groupName] of Object.entries(groups)) {
      if (seen.has(groupName)) {
        continue
      }
      seen.add(groupName)

      if (!javascriptIdentifierToken.test(groupName)) {
        pushDiagnostic(
          diagnostics,
          "InvalidGroupClientKey",
          [section, endpointName],
          `Group ${groupName} becomes a client property key but is not a valid JavaScript identifier`,
        )
        continue
      }

      if (reserved.has(groupName)) {
        pushDiagnostic(
          diagnostics,
          "InvalidGroupClientKey",
          [section, endpointName],
          `Group ${groupName} collides with a reserved client property key`,
        )
      }
    }
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
