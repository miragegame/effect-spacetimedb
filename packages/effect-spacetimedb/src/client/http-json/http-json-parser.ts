import * as Effect from "effect/Effect"

import * as Schema from "effect/Schema"

import {
  ConnectionId,
  Identity,
  TimeDuration,
  Timestamp,
  Uuid,
} from "spacetimedb"

import * as ParseResult from "../../compat/parse-result.ts"

import { snakeCaseName } from "../../contract/canonical-name.ts"

export const IntegerTokenKey = "$effectSpacetimeDbInteger"

export type IntegerToken = {
  readonly [IntegerTokenKey]: string
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
  typeof value[IntegerTokenKey] === "string"

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
      output += body.slice(start, index)
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

export const parseJsonPreservingIntegers = (
  body: string,
): Effect.Effect<unknown, ParseResult.ParseError> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
    markIntegerNumbers(body),
  )

export const parseFailure = (
  input: unknown,
  cause: unknown,
): ParseResult.ParseError =>
  ParseResult.parseError(
    new ParseResult.Type(
      Schema.Unknown.ast,
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
