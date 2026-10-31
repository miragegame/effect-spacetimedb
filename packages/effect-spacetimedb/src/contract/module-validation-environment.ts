import * as Predicate from "effect/Predicate"
import type { StdbDiagnostic } from "./diagnostic.ts"
import {
  declarationCountMax,
  keyBytesMax,
  keyPattern,
  schemaBytesMax,
  unionEntryCountMax,
  valueBytesMax,
} from "./environment.ts"
import type { AnyModuleSpec } from "./module.ts"
import { pushDiagnostic } from "./module-validation-common.ts"

const textEncoder = new TextEncoder()

const utf8ByteLength = (value: string): number =>
  textEncoder.encode(value).byteLength

const validateLiteralValues = (
  diagnostics: Array<StdbDiagnostic>,
  path: ReadonlyArray<string | number>,
  key: string,
  values: unknown,
): void => {
  if (!Array.isArray(values) || values.length === 0) {
    pushDiagnostic(
      diagnostics,
      "InvalidEnvironmentLiteral",
      path,
      `Environment key ${key} must declare at least one allowed value`,
    )
    return
  }
  if (values.length > unionEntryCountMax) {
    pushDiagnostic(
      diagnostics,
      "EnvironmentUnionEntriesExceeded",
      path,
      `Environment key ${key} allows ${values.length.toString()} values; the host accepts at most ${unionEntryCountMax.toString()} per key (MAX_ENV_UNION_ENTRIES)`,
    )
  }

  const seen = new Set<string>()
  for (const [index, value] of values.entries()) {
    if (typeof value !== "string") {
      pushDiagnostic(
        diagnostics,
        "InvalidEnvironmentLiteral",
        [...path, index],
        `Environment key ${key} allowed values must be strings`,
      )
      continue
    }
    if (seen.has(value)) {
      pushDiagnostic(
        diagnostics,
        "InvalidEnvironmentLiteral",
        [...path, index],
        `Environment key ${key} lists an allowed value more than once`,
      )
    }
    seen.add(value)
    if (utf8ByteLength(value) > valueBytesMax) {
      pushDiagnostic(
        diagnostics,
        "InvalidEnvironmentLiteral",
        [...path, index],
        `Environment key ${key} has an allowed value longer than ${valueBytesMax.toString()} UTF-8 bytes`,
      )
    }
  }
}

/**
 * The host counts every key and every allowed literal against one schema
 * budget, in declaration order, and names the key at which it overflowed.
 */
const firstKeyOverSchemaBytes = (
  entries: ReadonlyArray<readonly [string, unknown]>,
): string | undefined => {
  let schemaBytes = 0
  for (const [key, declaration] of entries) {
    const literals =
      Predicate.isReadonlyObject(declaration) &&
      declaration.kind === "literal" &&
      Array.isArray(declaration.values)
        ? declaration.values.filter((value) => typeof value === "string")
        : []
    for (const text of [key, ...literals]) {
      schemaBytes += utf8ByteLength(text)
      if (schemaBytes > schemaBytesMax) {
        return key
      }
    }
  }
  return undefined
}

/**
 * Checks the declarations against the host's environment limits when the
 * contract is built, so a module the host would refuse never reaches publish.
 * Messages name keys and limits only; declarations carry no values.
 */
export const validateEnvironment = (
  diagnostics: Array<StdbDiagnostic>,
  module: Pick<AnyModuleSpec, "environment">,
): void => {
  const environment = module.environment ?? {}
  const entries = Object.entries(environment)
  const schemaOverflowKey = firstKeyOverSchemaBytes(entries)
  if (schemaOverflowKey !== undefined) {
    pushDiagnostic(
      diagnostics,
      "EnvironmentSchemaBytesExceeded",
      ["environment", schemaOverflowKey],
      `The environment declarations' keys and allowed values exceed ${schemaBytesMax.toString()} UTF-8 bytes at key ${schemaOverflowKey}; the host refuses a larger schema (MAX_ENV_SCHEMA_BYTES)`,
    )
  }
  if (entries.length > declarationCountMax) {
    pushDiagnostic(
      diagnostics,
      "EnvironmentDeclarationCountExceeded",
      ["environment"],
      `A module may declare at most ${declarationCountMax.toString()} environment keys; this one declares ${entries.length.toString()}`,
    )
  }

  for (const [key, declaration] of entries) {
    const path = ["environment", key]
    if (!keyPattern.test(key)) {
      pushDiagnostic(
        diagnostics,
        "InvalidEnvironmentKey",
        path,
        `Environment key "${key}" must match [A-Za-z_][A-Za-z0-9_]*`,
      )
    } else if (utf8ByteLength(key) > keyBytesMax) {
      pushDiagnostic(
        diagnostics,
        "InvalidEnvironmentKey",
        path,
        `Environment key ${key} is longer than ${keyBytesMax.toString()} UTF-8 bytes`,
      )
    }

    if (
      !Predicate.isReadonlyObject(declaration) ||
      typeof declaration.optional !== "boolean"
    ) {
      pushDiagnostic(
        diagnostics,
        "InvalidEnvironmentDeclaration",
        path,
        `Environment key ${key} must be declared with Environment.string, Environment.secret, Environment.literal or Environment.optional`,
      )
      continue
    }

    switch (declaration.kind) {
      case "string":
      case "secret":
        break
      case "literal":
        validateLiteralValues(
          diagnostics,
          [...path, "values"],
          key,
          declaration.values,
        )
        break
      default:
        pushDiagnostic(
          diagnostics,
          "InvalidEnvironmentDeclaration",
          path,
          `Environment key ${key} has an unknown declaration kind`,
        )
    }
  }
}
