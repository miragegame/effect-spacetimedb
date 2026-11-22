import * as Data from "effect/Data"

export class StdbTypeIdentifierDefect extends Data.TaggedError(
  "StdbTypeIdentifierDefect",
)<{
  readonly identifier: string
  readonly reason: "invalid" | "reserved"
}> {
  override readonly message =
    this.reason === "reserved"
      ? `SATS type identifier ${this.identifier} is reserved for generated types`
      : `SATS type identifier ${this.identifier} must be a valid SATS type identifier`
}

export const SatsTypeIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/

export const ReservedSatsTypeIdentifierPattern =
  /^EffectSpacetimeDb(Struct|Sum|Enum)\d+$/

export const GeneratedClientHelperIdentifierPattern = /^__/

const GeneratedTypescriptReservedIdentifiers = new Set([
  "abstract",
  "any",
  "as",
  "asserts",
  "async",
  "await",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "is",
  "keyof",
  "let",
  "module",
  "namespace",
  "never",
  "new",
  "null",
  "number",
  "object",
  "of",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "require",
  "return",
  "set",
  "static",
  "string",
  "super",
  "switch",
  "symbol",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "unique",
  "unknown",
  "var",
  "void",
  "while",
  "with",
  "yield",
])

const GeneratedClientReservedIdentifiers = new Set(["params", "returnType"])

export const validateSatsTypeIdentifier = (identifier: string): void => {
  if (!SatsTypeIdentifierPattern.test(identifier)) {
    throw new StdbTypeIdentifierDefect({ identifier, reason: "invalid" })
  }

  if (
    ReservedSatsTypeIdentifierPattern.test(identifier) ||
    GeneratedTypescriptReservedIdentifiers.has(identifier) ||
    GeneratedClientReservedIdentifiers.has(identifier) ||
    GeneratedClientHelperIdentifierPattern.test(identifier)
  ) {
    throw new StdbTypeIdentifierDefect({ identifier, reason: "reserved" })
  }
}
