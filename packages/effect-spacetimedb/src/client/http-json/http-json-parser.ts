import * as Effect from "effect/Effect"

import * as Schema from "effect/Schema"

import {
  ConnectionId,
  Identity,
  TimeDuration,
  Timestamp,
  Uuid,
} from "spacetimedb"

import * as ParseResult from "../../schema-parse.ts"

import { snakeCaseName } from "../../contract/canonical-name.ts"

export const IntegerTokenKey = "$effectSpacetimeDbInteger"
const IntegerTokenEscapePrefix = "$effectSpacetimeDbEscaped:"
const IntegerTokenBrand: unique symbol = Symbol(
  "effect-spacetimedb/IntegerToken",
)

export type IntegerToken = {
  readonly [IntegerTokenKey]: string
  readonly [IntegerTokenBrand]: true
}

export type ParsedJsonNumber = {
  readonly end: number
  readonly isInteger: boolean
  readonly valid: boolean
}

export type JsonStringifyState = {
  readonly seen: WeakSet<object>
}

export const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= "0" && char <= "9"

export const isJsonRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  value !== null && !Array.isArray(value) && typeof value === "object"

export const isIntegerToken = (value: unknown): value is IntegerToken =>
  isJsonRecord(value) &&
  Object.keys(value).length === 1 &&
  typeof value[IntegerTokenKey] === "string" &&
  Object.getOwnPropertyDescriptor(value, IntegerTokenBrand)?.value === true

export const ownValue = (
  value: Record<string, unknown>,
  key: string,
): unknown =>
  Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined

export const jsonValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => jsonValuesEqual(entry, right[index]))
    )
  }

  if (isJsonRecord(left) && isJsonRecord(right)) {
    const leftEntries = Object.entries(left)
    const rightKeys = new Set(Object.keys(right))
    return (
      leftEntries.length === rightKeys.size &&
      leftEntries.every(
        ([key, value]) =>
          rightKeys.has(key) && jsonValuesEqual(value, right[key]),
      )
    )
  }

  return false
}

export const normalizeDeclaredField = (
  entries: Map<string, unknown>,
  fieldName: string,
  normalize: (value: unknown) => unknown,
): void => {
  const canonicalName = snakeCaseName(fieldName)
  const hasDeclared = entries.has(fieldName)
  const hasCanonical = canonicalName !== fieldName && entries.has(canonicalName)

  if (!hasDeclared && !hasCanonical) {
    return
  }

  if (
    hasDeclared &&
    hasCanonical &&
    !jsonValuesEqual(entries.get(fieldName), entries.get(canonicalName))
  ) {
    throw new Error(
      `Ambiguous JSON field ${fieldName}; both declared and canonical keys are present with different values`,
    )
  }

  const value = hasDeclared
    ? entries.get(fieldName)
    : entries.get(canonicalName)
  if (hasCanonical) {
    entries.delete(canonicalName)
  }
  entries.set(fieldName, normalize(value))
}

export const escapeJsonString = (value: string): string =>
  `"${value.replace(/[\u0000-\u001f"\\]/g, (char) => {
    if (char === '"') {
      return '\\"'
    }
    if (char === "\\") {
      return "\\\\"
    }
    const code = char.charCodeAt(0).toString(16).padStart(4, "0")
    return `\\u${code}`
  })}"`

export const exactRecordValue = (
  value: unknown,
  key: string,
): unknown | undefined =>
  isJsonRecord(value) && Object.keys(value).length === 1
    ? ownValue(value, key)
    : undefined

export const integerToken = (digits: string): string =>
  `{${escapeJsonString(IntegerTokenKey)}:${escapeJsonString(digits)}}`

const escapeIntegerTokenString = (value: string): string =>
  value === IntegerTokenKey || value.startsWith(IntegerTokenEscapePrefix)
    ? `${IntegerTokenEscapePrefix}${value}`
    : value

const unescapeIntegerTokenString = (value: string): string =>
  value.startsWith(IntegerTokenEscapePrefix)
    ? value.slice(IntegerTokenEscapePrefix.length)
    : value

const decodeJsonString = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.String),
)

const restoreMarkedJson = (value: unknown): unknown => {
  if (
    isJsonRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value[IntegerTokenKey] === "string"
  ) {
    Object.defineProperty(value, IntegerTokenBrand, {
      value: true,
      enumerable: false,
    })
    return value
  }
  if (typeof value === "string") {
    return unescapeIntegerTokenString(value)
  }
  if (Array.isArray(value)) {
    return value.map(restoreMarkedJson)
  }
  if (isJsonRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        unescapeIntegerTokenString(key),
        restoreMarkedJson(entry),
      ]),
    )
  }
  return value
}

export const parseJsonNumber = (
  input: string,
  start: number,
): ParsedJsonNumber => {
  let index = start

  if (input[index] === "-") {
    index += 1
  }

  if (!isDigit(input[index])) {
    return { end: index, isInteger: true, valid: false }
  }

  if (input[index] === "0") {
    index += 1
    if (isDigit(input[index])) {
      while (isDigit(input[index])) {
        index += 1
      }
      return { end: index, isInteger: true, valid: false }
    }
  } else {
    while (isDigit(input[index])) {
      index += 1
    }
  }

  let isInteger = true

  if (input[index] === ".") {
    isInteger = false
    index += 1
    const fractionStart = index
    while (isDigit(input[index])) {
      index += 1
    }
    if (index === fractionStart) {
      return { end: index, isInteger, valid: false }
    }
  }

  if (input[index] === "e" || input[index] === "E") {
    isInteger = false
    index += 1
    if (input[index] === "+" || input[index] === "-") {
      index += 1
    }
    const exponentStart = index
    while (isDigit(input[index])) {
      index += 1
    }
    if (index === exponentStart) {
      return { end: index, isInteger, valid: false }
    }
  }

  return { end: index, isInteger, valid: true }
}

export const markIntegerNumbers = (body: string): string => {
  let output = ""
  let index = 0

  while (index < body.length) {
    const char = body[index]

    if (char === '"') {
      const start = index
      index += 1
      while (index < body.length) {
        const current = body[index]
        index += current === "\\" ? 2 : 1
        if (current === '"') {
          break
        }
      }
      const raw = body.slice(start, index)
      try {
        output += escapeJsonString(
          escapeIntegerTokenString(decodeJsonString(raw)),
        )
      } catch {
        output += raw
      }
      continue
    }

    if (char === "-" || isDigit(char)) {
      const parsed = parseJsonNumber(body, index)
      const token = body.slice(index, parsed.end)
      output += parsed.valid && parsed.isInteger ? integerToken(token) : token
      index = parsed.end
      continue
    }

    output += char
    index += 1
  }

  return output
}

/**
 * Deepest array/object nesting accepted in an HTTP JSON response body. The
 * limit protects the recursive walks below (`restoreMarkedJson`, value
 * normalization, schema decode): on Node 24's default V8 stack a recursive
 * `Stdb.lazy` value overflows them between 450 and 520 JSON levels (measured
 * 2026-09-27; Bun's larger stack holds to about 2,000), so 128 keeps a margin
 * of more than three on the smallest engine. It also equals serde_json's
 * default recursion limit, which SpaceTimeDB applies when it deserializes HTTP
 * JSON arguments (`serde_json::Deserializer::from_str` in
 * `crates/core/src/host/mod.rs`), so every value that can be sent back as an
 * argument can be received. The host serializes responses without that limit,
 * so a recursive return value deeper than this (a `Stdb.lazy` tree with more
 * than 64 nodes on one root-to-leaf path: each node is a struct holding an
 * array) fails with a typed parse error instead of decoding. Every SATS
 * container (struct, array, option, sum) costs one level; non-recursive schemas
 * sit an order of magnitude below the limit.
 */
export const jsonNestingDepthMax = 128

/**
 * Whether `body` nests arrays/objects deeper than `depthMax`, counting
 * brackets outside string literals. It runs before parsing so no recursive
 * walk ever sees an over-deep value, and it is linear in the body length.
 * Malformed bodies are left to the parser to reject.
 */
export const jsonNestingExceeds = (body: string, depthMax: number): boolean => {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
    } else if (char === '"') {
      inString = true
    } else if (char === "[" || char === "{") {
      depth += 1
      if (depth > depthMax) {
        return true
      }
    } else if (char === "]" || char === "}") {
      depth -= 1
    }
  }

  return false
}

export const parseJsonPreservingIntegers = (
  body: string,
): Effect.Effect<unknown, ParseResult.ParseError> =>
  jsonNestingExceeds(body, jsonNestingDepthMax)
    ? Effect.fail(
        parseFailure(
          body,
          `JSON nesting exceeds the maximum depth of ${jsonNestingDepthMax}`,
        ),
      )
    : Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
        markIntegerNumbers(body),
      ).pipe(Effect.map(restoreMarkedJson))

export const parseFailure = (
  input: unknown,
  cause: unknown,
): ParseResult.ParseError =>
  ParseResult.parseError(
    new ParseResult.Type(
      input,
      cause instanceof Error ? cause.message : String(cause),
    ),
  )

export const integerToBigInt = (value: unknown): bigint => {
  if (isIntegerToken(value)) {
    return BigInt(value[IntegerTokenKey])
  }
  if (typeof value === "bigint") {
    return value
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value)
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value)
  }
  throw new Error("Expected JSON integer")
}

export const integerToNumber = (value: unknown): number => {
  if (isIntegerToken(value)) {
    return Number(value[IntegerTokenKey])
  }
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "bigint") {
    return Number(value)
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value)
  }
  throw new Error("Expected JSON number")
}

export const identityFromJson = (value: unknown): Identity =>
  typeof value === "string"
    ? new Identity(value)
    : new Identity(integerToBigInt(value))

export const connectionIdFromJson = (value: unknown): ConnectionId =>
  typeof value === "string"
    ? ConnectionId.fromString(value)
    : new ConnectionId(integerToBigInt(value))

export const uuidFromJson = (value: unknown): Uuid =>
  typeof value === "string"
    ? Uuid.parse(value)
    : new Uuid(integerToBigInt(value))

export const normalizeSpecialRecord = (value: unknown): unknown | undefined => {
  const timestamp = exactRecordValue(
    value,
    "__timestamp_micros_since_unix_epoch__",
  )
  if (timestamp !== undefined) {
    return new Timestamp(integerToBigInt(timestamp))
  }

  const duration = exactRecordValue(value, "__time_duration_micros__")
  if (duration !== undefined) {
    return new TimeDuration(integerToBigInt(duration))
  }

  const identity = exactRecordValue(value, "__identity__")
  if (identity !== undefined) {
    return identityFromJson(identity)
  }

  const connectionId = exactRecordValue(value, "__connection_id__")
  if (connectionId !== undefined) {
    return connectionIdFromJson(connectionId)
  }

  const uuid = exactRecordValue(value, "__uuid__")
  if (uuid !== undefined) {
    return uuidFromJson(uuid)
  }

  return undefined
}
