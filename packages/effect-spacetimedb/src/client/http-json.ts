import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as AST from "effect/SchemaAST"
import {
  ConnectionId,
  Identity,
  TimeDuration,
  Timestamp,
  Uuid,
} from "spacetimedb"
import * as ParseResult from "../compat/parse-result.ts"
import { snakeCaseName } from "../contract/canonical-name.ts"
import {
  stringLiteralGeneratedClientTag,
  stringLiteralSatsVariantTag,
} from "../contract/literal-tags.ts"
import { encodedAst } from "../contract/schema-annotations.ts"
import * as TypeDescriptor from "../contract/type/descriptor.ts"
import { foldValue, type Recurse } from "../contract/type/value-fold.ts"
import {
  type AnyValueType,
  isUnitValueType,
  structFieldWireType,
} from "../contract/type.ts"
import { StdbDecodeError } from "../decode-error.ts"

const IntegerTokenKey = "$effectSpacetimeDbInteger"

type IntegerToken = {
  readonly [IntegerTokenKey]: string
}

type ParsedJsonNumber = {
  readonly end: number
  readonly isInteger: boolean
  readonly valid: boolean
}

type JsonStringifyState = {
  readonly seen: WeakSet<object>
}

const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= "0" && char <= "9"

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && !Array.isArray(value) && typeof value === "object"

const isIntegerToken = (value: unknown): value is IntegerToken =>
  isJsonRecord(value) &&
  Object.keys(value).length === 1 &&
  typeof value[IntegerTokenKey] === "string"

const ownValue = (value: Record<string, unknown>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined

const jsonValuesEqual = (left: unknown, right: unknown): boolean => {
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

const normalizeDeclaredField = (
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

const escapeJsonString = (value: string): string =>
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

const exactRecordValue = (value: unknown, key: string): unknown | undefined =>
  isJsonRecord(value) && Object.keys(value).length === 1
    ? ownValue(value, key)
    : undefined

const integerToken = (digits: string): string =>
  `{${escapeJsonString(IntegerTokenKey)}:${escapeJsonString(digits)}}`

const parseJsonNumber = (input: string, start: number): ParsedJsonNumber => {
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

const markIntegerNumbers = (body: string): string => {
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

const parseJsonPreservingIntegers = (
  body: string,
): Effect.Effect<unknown, ParseResult.ParseError> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
    markIntegerNumbers(body),
  )

const parseFailure = (input: unknown, cause: unknown): ParseResult.ParseError =>
  ParseResult.parseError(
    new ParseResult.Type(
      Schema.Unknown.ast,
      input,
      cause instanceof Error ? cause.message : String(cause),
    ),
  )

const integerToBigInt = (value: unknown): bigint => {
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

const integerToNumber = (value: unknown): number => {
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

const identityFromJson = (value: unknown): Identity =>
  typeof value === "string"
    ? new Identity(value)
    : new Identity(integerToBigInt(value))

const connectionIdFromJson = (value: unknown): ConnectionId =>
  typeof value === "string"
    ? ConnectionId.fromString(value)
    : new ConnectionId(integerToBigInt(value))

const uuidFromJson = (value: unknown): Uuid =>
  typeof value === "string"
    ? Uuid.parse(value)
    : new Uuid(integerToBigInt(value))

const normalizeSpecialRecord = (value: unknown): unknown | undefined => {
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

const flattenJsonUnionMembers = (
  members: ReadonlyArray<AST.AST>,
): ReadonlyArray<AST.AST> =>
  members.flatMap((member) =>
    AST.isUnion(member) ? flattenJsonUnionMembers(member.types) : [member],
  )

const propertyAst = (ast: AST.AST, name: string): AST.AST | undefined =>
  AST.isObjects(ast)
    ? ast.propertySignatures.find((property) => property.name === name)?.type
    : undefined

const literalString = (ast: AST.AST): string | undefined => {
  const normalized = encodedAst(ast)
  return AST.isLiteral(normalized) && typeof normalized.literal === "string"
    ? normalized.literal
    : undefined
}

const memberTag = (member: AST.AST): string | undefined => {
  const tagAst = propertyAst(encodedAst(member), "tag")
  return tagAst != null ? literalString(tagAst) : undefined
}

const taggedMember = (
  members: ReadonlyArray<AST.AST>,
  tag: string,
): AST.AST | undefined => members.find((member) => memberTag(member) === tag)

const isSatsUnitValue = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) && value.length === 0) ||
  (isJsonRecord(value) && Object.keys(value).length === 0)

const astAllowsUnitOmission = (ast: AST.AST): boolean => {
  const normalized = encodedAst(ast)
  if (AST.isVoid(normalized) || AST.isUndefined(normalized)) {
    return true
  }
  return AST.isUnion(normalized)
    ? flattenJsonUnionMembers(normalized.types).some(astAllowsUnitOmission)
    : false
}

const normalizedVariantValue = (
  valueAst: AST.AST | undefined,
  value: unknown,
): { readonly include: boolean; readonly value?: unknown } => {
  if (valueAst == null) {
    return { include: false }
  }

  return isSatsUnitValue(value) && astAllowsUnitOmission(valueAst)
    ? { include: false }
    : {
        include: true,
        value: normalizeAst(valueAst, value),
      }
}

const normalizeUnknown = (value: unknown): unknown => {
  if (isIntegerToken(value)) {
    return integerToNumber(value)
  }
  if (Array.isArray(value)) {
    return value.map(normalizeUnknown)
  }
  if (isJsonRecord(value)) {
    const special = normalizeSpecialRecord(value)
    if (special !== undefined) {
      return special
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        normalizeUnknown(entry),
      ]),
    )
  }
  return value
}

const normalizeUnion = (ast: AST.Union, value: unknown): unknown => {
  const members = flattenJsonUnionMembers(ast.types)
  const nonUndefinedMembers = members.filter(
    (member) => !AST.isUndefined(encodedAst(member)),
  )
  const optionMember =
    nonUndefinedMembers.length === 1 &&
    nonUndefinedMembers.length !== members.length
      ? nonUndefinedMembers[0]
      : undefined

  if (
    (value === undefined || value === null) &&
    members.some((member) => AST.isUndefined(encodedAst(member)))
  ) {
    return undefined
  }

  if (Array.isArray(value) && value.length === 2) {
    const variantIndex = integerToNumber(value[0])
    if (optionMember != null) {
      if (variantIndex === 0) {
        return normalizeAst(optionMember, value[1])
      }
      if (variantIndex === 1 && isSatsUnitValue(value[1])) {
        return undefined
      }
      return value
    }

    const member = members[variantIndex]
    if (member != null) {
      const memberAst = encodedAst(member)
      const tag = memberTag(member)
      const valueAst = propertyAst(memberAst, "value")
      const normalizedValue = normalizedVariantValue(valueAst, value[1])
      return tag != null
        ? normalizeAst(memberAst, {
            tag,
            ...(normalizedValue.include
              ? { value: normalizedValue.value }
              : {}),
          })
        : normalizeAst(member, value[1])
    }
  }

  if (Array.isArray(value)) {
    const productMember = members.find((member) =>
      AST.isObjects(encodedAst(member)),
    )
    if (productMember != null) {
      return normalizeAst(productMember, value)
    }
  }

  if (optionMember != null) {
    if (isJsonRecord(value) && Object.keys(value).length === 1) {
      const [entryPair] = Object.entries(value)
      if (entryPair?.[0] === "some") {
        return normalizeAst(optionMember, entryPair[1])
      }
      if (entryPair?.[0] === "none" && isSatsUnitValue(entryPair[1])) {
        return undefined
      }
    }

    return normalizeAst(optionMember, value)
  }

  if (isJsonRecord(value) && typeof value.tag === "string") {
    const member = taggedMember(members, value.tag)
    if (member != null) {
      return normalizeAst(member, value)
    }
  }

  if (isJsonRecord(value) && Object.keys(value).length === 1) {
    const [entryPair] = Object.entries(value)
    if (entryPair == null) {
      return normalizeUnknown(value)
    }
    const [tag, entry] = entryPair
    const member = taggedMember(members, tag)
    const memberAst = member != null ? encodedAst(member) : undefined
    const valueAst =
      memberAst != null ? propertyAst(memberAst, "value") : undefined
    const normalizedValue = normalizedVariantValue(valueAst, entry)
    if (memberAst != null) {
      return normalizeAst(memberAst, {
        tag,
        ...(normalizedValue.include ? { value: normalizedValue.value } : {}),
      })
    }
  }

  const literalMember = members.find((member) => {
    const normalized = encodedAst(member)
    return AST.isLiteral(normalized) && normalized.literal === value
  })
  if (literalMember != null) {
    return value
  }

  return normalizeUnknown(value)
}

const normalizeTypeLiteral = (ast: AST.Objects, value: unknown): unknown => {
  const properties = ast.propertySignatures

  if (Array.isArray(value)) {
    return Object.fromEntries(
      properties.flatMap((property, index) =>
        typeof property.name === "string" && index < value.length
          ? [[property.name, normalizeAst(property.type, value[index])]]
          : [],
      ),
    )
  }

  if (!isJsonRecord(value)) {
    return value
  }

  const entries = new Map(Object.entries(value))
  for (const property of properties) {
    if (typeof property.name === "string") {
      normalizeDeclaredField(entries, property.name, (fieldValue) =>
        normalizeAst(property.type, fieldValue),
      )
    }
  }

  return Object.fromEntries(entries)
}

const normalizeTuple = (ast: AST.Arrays, value: unknown): unknown => {
  if (!Array.isArray(value)) {
    return value
  }

  const rest =
    ast.elements.length === 0 && ast.rest.length === 1 ? ast.rest[0] : undefined

  return rest != null ? value.map((entry) => normalizeAst(rest, entry)) : value
}

const normalizeResultVariant = (
  tag: "ok" | "err",
  type: AnyValueType,
  value: unknown,
  hasValue: boolean,
  recurse: Recurse<unknown>,
): unknown =>
  isUnitValueType(type)
    ? !hasValue || isSatsUnitValue(value)
      ? { tag }
      : { tag, value }
    : hasValue
      ? {
          tag,
          value: recurse(type, value),
        }
      : { tag }

const normalizeResultValue = (
  okType: AnyValueType,
  errType: AnyValueType,
  value: unknown,
  recurse: Recurse<unknown>,
): unknown => {
  if (Array.isArray(value) && value.length === 2) {
    const variant = integerToNumber(value[0])
    if (variant === 0) {
      return normalizeResultVariant("ok", okType, value[1], true, recurse)
    }
    if (variant === 1) {
      return normalizeResultVariant("err", errType, value[1], true, recurse)
    }
  }

  if (isJsonRecord(value) && typeof value.tag === "string") {
    const hasValue = Object.hasOwn(value, "value")
    const isExactEnvelope = Object.keys(value).length === (hasValue ? 2 : 1)
    if (!isExactEnvelope) {
      return value
    }

    if (value.tag === "ok") {
      return normalizeResultVariant(
        "ok",
        okType,
        ownValue(value, "value"),
        hasValue,
        recurse,
      )
    }
    if (value.tag === "err") {
      return normalizeResultVariant(
        "err",
        errType,
        ownValue(value, "value"),
        hasValue,
        recurse,
      )
    }
  }

  if (isJsonRecord(value) && Object.keys(value).length === 1) {
    const [entry] = Object.entries(value)
    if (entry?.[0] === "ok") {
      return normalizeResultVariant("ok", okType, entry[1], true, recurse)
    }
    if (entry?.[0] === "err") {
      return normalizeResultVariant("err", errType, entry[1], true, recurse)
    }
  }

  return value
}

const normalizeSumVariant = (
  tag: string,
  type: AnyValueType,
  value: unknown,
  hasValue: boolean,
  recurse: Recurse<unknown>,
): unknown =>
  isUnitValueType(type)
    ? !hasValue || isSatsUnitValue(value)
      ? { tag }
      : { tag, value }
    : hasValue
      ? {
          tag,
          value: recurse(type, value),
        }
      : { tag }

const normalizeSumValue = (
  variants: TypeDescriptor.StdbSumDescriptor["variants"],
  value: unknown,
  recurse: Recurse<unknown>,
): unknown => {
  const entries = Object.entries(variants)
  if (Array.isArray(value) && value.length === 2) {
    const variant = integerToNumber(value[0])
    const entry = entries[variant]
    if (entry != null) {
      return normalizeSumVariant(entry[0], entry[1], value[1], true, recurse)
    }
  }

  if (isJsonRecord(value) && typeof value.tag === "string") {
    const variant = variants[value.tag]
    const hasValue = Object.hasOwn(value, "value")
    const isExactEnvelope = Object.keys(value).length === (hasValue ? 2 : 1)
    if (variant === undefined || !isExactEnvelope) {
      return value
    }

    return normalizeSumVariant(
      value.tag,
      variant,
      ownValue(value, "value"),
      hasValue,
      recurse,
    )
  }

  if (isJsonRecord(value) && Object.keys(value).length === 1) {
    const [entry] = Object.entries(value)
    if (entry != null) {
      const variant = variants[entry[0]]
      if (variant != null) {
        return normalizeSumVariant(entry[0], variant, entry[1], true, recurse)
      }
    }
  }

  return value
}

const stringLiteralWireTags = (
  values: TypeDescriptor.StdbLiteralDescriptor["values"],
):
  | ReadonlyArray<{
      readonly authored: string
      readonly tag: string
      readonly generatedClientTag: string
    }>
  | undefined =>
  values.every((entry) => typeof entry === "string")
    ? (values as ReadonlyArray<string>).map((authored) => ({
        authored,
        tag: stringLiteralSatsVariantTag(authored),
        generatedClientTag: stringLiteralGeneratedClientTag(authored),
      }))
    : undefined

const normalizeStringLiteralTag = (
  tags: NonNullable<ReturnType<typeof stringLiteralWireTags>>,
  value: string,
): string | undefined => {
  const entry = tags.find(
    (tag) =>
      tag.authored === value ||
      tag.tag === value ||
      tag.generatedClientTag === value,
  )

  return entry?.tag
}

const literalTagFromIndex = (
  tags: NonNullable<ReturnType<typeof stringLiteralWireTags>>,
  value: unknown,
): string | undefined => {
  const index =
    isIntegerToken(value) ||
    typeof value === "number" ||
    typeof value === "bigint"
      ? integerToNumber(value)
      : undefined
  return index === undefined ? undefined : tags[index]?.tag
}

const normalizeLiteralValue = (
  type: AnyValueType,
  values: TypeDescriptor.StdbLiteralDescriptor["values"],
  value: unknown,
): unknown => {
  const tags = stringLiteralWireTags(values)
  if (tags === undefined) {
    return isIntegerToken(value)
      ? integerToNumber(value)
      : normalizeAst(type.schema.ast, value)
  }

  if (Array.isArray(value) && value.length === 2) {
    const tag = literalTagFromIndex(tags, value[0])
    if (tag !== undefined && isSatsUnitValue(value[1])) {
      return { tag }
    }
  }

  if (isJsonRecord(value)) {
    const tagValue = ownValue(value, "tag")
    const indexedTag = literalTagFromIndex(tags, tagValue)
    if (indexedTag !== undefined) {
      return { tag: indexedTag }
    }

    if (typeof tagValue === "string") {
      const tag = normalizeStringLiteralTag(tags, tagValue)
      if (tag !== undefined) {
        return { tag }
      }
    }

    if (Object.keys(value).length === 1) {
      const [entry] = Object.entries(value)
      if (entry != null) {
        const [tag, payload] = entry
        const normalizedTag = normalizeStringLiteralTag(tags, tag)
        if (normalizedTag !== undefined && isSatsUnitValue(payload)) {
          return { tag: normalizedTag }
        }
      }
    }
  }

  if (typeof value === "string") {
    const tag = normalizeStringLiteralTag(tags, value)
    if (tag !== undefined) {
      return { tag }
    }
  }

  return normalizeAst(type.schema.ast, value)
}

const prepareLiteralInputValue = (
  values: TypeDescriptor.StdbLiteralDescriptor["values"],
  value: unknown,
): unknown => {
  const tags = stringLiteralWireTags(values)
  if (tags === undefined) return value

  if (isJsonRecord(value) && Object.keys(value).length === 1) {
    const tag = ownValue(value, "tag")
    if (typeof tag === "string") {
      const normalizedTag = normalizeStringLiteralTag(tags, tag)
      if (normalizedTag !== undefined) {
        return { [normalizedTag]: {} }
      }
    }
  }

  if (typeof value === "string") {
    const tag = normalizeStringLiteralTag(tags, value)
    if (tag !== undefined) {
      return { [tag]: {} }
    }
  }

  return value
}

const prepareSumInputValue = (
  variants: TypeDescriptor.StdbSumDescriptor["variants"],
  value: unknown,
  recurse: Recurse<unknown>,
): unknown => {
  if (!isJsonRecord(value) || Object.keys(value).length !== 1) return value

  const [entry] = Object.entries(value)
  if (entry == null) return value

  const [tag, payload] = entry
  const variant = variants[tag]
  if (variant === undefined) return value

  return {
    [tag]: isUnitValueType(variant) ? payload : recurse(variant, payload),
  }
}

const prepareResultInputValue = (
  members: TypeDescriptor.StdbResultDescriptor["members"],
  value: unknown,
  recurse: Recurse<unknown>,
): unknown => {
  if (!isJsonRecord(value)) return value

  const ok = members[0]
  const err = members[1]
  if (
    ok != null &&
    Object.hasOwn(value, "ok") &&
    !Object.hasOwn(value, "err")
  ) {
    return {
      ok: isUnitValueType(ok) ? {} : recurse(ok, value.ok),
    }
  }
  if (
    err != null &&
    Object.hasOwn(value, "err") &&
    !Object.hasOwn(value, "ok")
  ) {
    return {
      err: isUnitValueType(err) ? {} : recurse(err, value.err),
    }
  }
  if (ok != null && value.tag === "ok") {
    return {
      ok: isUnitValueType(ok)
        ? {}
        : Object.hasOwn(value, "value")
          ? recurse(ok, value.value)
          : value.value,
    }
  }
  if (err != null && value.tag === "err") {
    return {
      err: isUnitValueType(err)
        ? {}
        : Object.hasOwn(value, "value")
          ? recurse(err, value.value)
          : value.value,
    }
  }

  return value
}

const preparePrimitiveInputValue = (
  kind: TypeDescriptor.StdbPrimitiveDescriptor["kind"],
  value: unknown,
): unknown => {
  if (
    (kind === "f32" || kind === "f64") &&
    typeof value === "number" &&
    !Number.isFinite(value)
  ) {
    throw new Error(`Cannot encode non-finite ${kind} value over HTTP JSON`)
  }

  return value
}

export const prepareHttpInputValue = foldValue<unknown>({
  absent: (_type, value) => value,
  array: (_type, item, value, recurse) =>
    Array.isArray(value) ? value.map((entry) => recurse(item, entry)) : value,
  custom: (_type, item, value, recurse) =>
    item != null ? recurse(item, value) : value,
  literal: (_type, values, value) => prepareLiteralInputValue(values, value),
  option: (_type, item, value, recurse) => {
    if (!isJsonRecord(value) || Object.keys(value).length !== 1) return value
    const optionEntry = Object.entries(value)[0]!
    if (optionEntry[0] !== "some") return value
    return {
      some: recurse(item, optionEntry[1]),
    }
  },
  primitive: (_type, kind, value) => preparePrimitiveInputValue(kind, value),
  result: (_type, members, value, recurse) =>
    prepareResultInputValue(members, value, recurse),
  struct: (_type, fields, value, recurse) => {
    if (!isJsonRecord(value)) return value
    const output: Record<string, unknown> = {}
    for (const [fieldName, fieldType] of Object.entries(fields)) {
      const canonicalName = snakeCaseName(fieldName)
      const sourceName = Object.hasOwn(value, fieldName)
        ? fieldName
        : canonicalName !== fieldName && Object.hasOwn(value, canonicalName)
          ? canonicalName
          : undefined
      if (sourceName !== undefined) {
        output[canonicalName] = recurse(
          structFieldWireType(fieldType),
          value[sourceName],
        )
      }
    }
    return output
  },
  sum: (_type, variants, value, recurse) =>
    prepareSumInputValue(variants, value, recurse),
})

const productFieldValue = (value: unknown): unknown | undefined =>
  Array.isArray(value) && value.length === 1 ? value[0] : undefined

type PrimitiveNormalizer = (options: {
  readonly type: AnyValueType
  readonly value: unknown
  readonly productValue: unknown | undefined
}) => unknown

const normalizeDefaultPrimitive: PrimitiveNormalizer = ({ type, value }) =>
  normalizeAst(type.schema.ast, value)

const primitiveNormalizers = {
  bigint: normalizeDefaultPrimitive,
  bool: normalizeDefaultPrimitive,
  bytes: normalizeDefaultPrimitive,
  connectionId: ({ type, value, productValue }) =>
    productValue === undefined
      ? normalizeAst(type.schema.ast, value)
      : { __connection_id__: integerToBigInt(productValue) },
  f32: normalizeDefaultPrimitive,
  f64: normalizeDefaultPrimitive,
  i8: normalizeDefaultPrimitive,
  i16: normalizeDefaultPrimitive,
  i32: normalizeDefaultPrimitive,
  i64: normalizeDefaultPrimitive,
  i128: normalizeDefaultPrimitive,
  i256: normalizeDefaultPrimitive,
  identity: ({ type, value, productValue }) =>
    productValue === undefined
      ? normalizeAst(type.schema.ast, value)
      : { __identity__: integerToBigInt(productValue) },
  scheduleAt: normalizeDefaultPrimitive,
  string: normalizeDefaultPrimitive,
  timeDuration: ({ type, value, productValue }) =>
    productValue === undefined
      ? normalizeAst(type.schema.ast, value)
      : { __time_duration_micros__: integerToBigInt(productValue) },
  timestamp: ({ type, value, productValue }) =>
    productValue === undefined
      ? normalizeAst(type.schema.ast, value)
      : {
          __timestamp_micros_since_unix_epoch__: integerToBigInt(productValue),
        },
  u8: normalizeDefaultPrimitive,
  u16: normalizeDefaultPrimitive,
  u32: normalizeDefaultPrimitive,
  u64: normalizeDefaultPrimitive,
  u128: normalizeDefaultPrimitive,
  u256: normalizeDefaultPrimitive,
  unit: normalizeDefaultPrimitive,
  uuid: ({ type, value, productValue }) =>
    productValue === undefined
      ? normalizeAst(type.schema.ast, value)
      : { __uuid__: integerToBigInt(productValue) },
} satisfies Record<
  TypeDescriptor.StdbPrimitiveDescriptor["kind"],
  PrimitiveNormalizer
>

const normalizePrimitiveValue = (
  type: AnyValueType,
  kind: TypeDescriptor.StdbPrimitiveDescriptor["kind"],
  value: unknown,
): unknown =>
  primitiveNormalizers[kind]({
    type,
    value,
    productValue: productFieldValue(value),
  })

const normalizeValueType = foldValue<unknown>({
  absent: (type, value) => normalizeAst(type.schema.ast, value),
  array: (type, item, value, recurse) =>
    Array.isArray(value)
      ? value.map((entry) => recurse(item, entry))
      : normalizeAst(type.schema.ast, value),
  custom: (type, item, value, recurse) =>
    item != null ? recurse(item, value) : normalizeAst(type.schema.ast, value),
  literal: (type, values, value) => normalizeLiteralValue(type, values, value),
  option: (_type, item, value, recurse) => {
    if (value === null || value === undefined) {
      return undefined
    }

    if (Array.isArray(value) && value.length === 2) {
      const variant = integerToNumber(value[0])
      if (variant === 0) {
        return recurse(item, value[1])
      }
      if (variant === 1 && isSatsUnitValue(value[1])) {
        return undefined
      }
      return value
    }

    if (isJsonRecord(value) && Object.keys(value).length === 1) {
      const [optionEntry] = Object.entries(value)
      if (optionEntry?.[0] === "some") {
        return recurse(item, optionEntry[1])
      }
      if (optionEntry?.[0] === "none" && isSatsUnitValue(optionEntry[1])) {
        return undefined
      }
    }

    return recurse(item, value)
  },
  primitive: (type, kind, value) => normalizePrimitiveValue(type, kind, value),
  result: (type, members, value, recurse) =>
    members.length === 2
      ? normalizeResultValue(members[0]!, members[1]!, value, recurse)
      : normalizeAst(type.schema.ast, value),
  sum: (_type, variants, value, recurse) =>
    normalizeSumValue(variants, value, recurse),
  struct: (type, fields, value, recurse) => {
    // Optional fields are option-lowered on the wire (structFieldWireType), so they
    // must be normalized through the Option branch — the annotation does not change
    // the field's own descriptor.
    const fieldEntries = Object.entries(fields).map(
      ([fieldName, fieldType]) =>
        [fieldName, structFieldWireType(fieldType)] as const,
    )

    if (Array.isArray(value)) {
      return Object.fromEntries(
        fieldEntries.flatMap(([fieldName, fieldType], index) =>
          index < value.length
            ? [[fieldName, recurse(fieldType, value[index])]]
            : [],
        ),
      )
    }

    if (!isJsonRecord(value)) {
      return normalizeAst(type.schema.ast, value)
    }

    const entries = new Map(Object.entries(value))
    for (const [fieldName, fieldType] of fieldEntries) {
      normalizeDeclaredField(entries, fieldName, (fieldValue) =>
        recurse(fieldType, fieldValue),
      )
    }

    return Object.fromEntries(entries)
  },
})

const normalizeAst = (ast: AST.AST, value: unknown): unknown => {
  const special = normalizeSpecialRecord(value)
  if (special !== undefined) {
    return special
  }

  const normalized = encodedAst(ast)

  if (AST.isBigInt(normalized)) {
    return integerToBigInt(value)
  }

  if (AST.isNumber(normalized)) {
    return isIntegerToken(value) ? integerToNumber(value) : value
  }

  if (AST.isLiteral(normalized)) {
    return isIntegerToken(value) ? integerToNumber(value) : value
  }

  if (AST.isVoid(normalized)) {
    return Array.isArray(value) && value.length === 0 ? undefined : value
  }

  if (AST.isObjects(normalized)) {
    return normalizeTypeLiteral(normalized, value)
  }

  if (AST.isArrays(normalized)) {
    return normalizeTuple(normalized, value)
  }

  if (AST.isUnion(normalized)) {
    return normalizeUnion(normalized, value)
  }

  return normalizeUnknown(value)
}

const stringifyValue = (
  value: unknown,
  state: JsonStringifyState,
): string | undefined => {
  if (value === null) {
    return "null"
  }

  if (typeof value === "bigint") {
    return value.toString()
  }

  if (typeof value === "string") {
    return escapeJsonString(value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot encode non-finite number over HTTP JSON")
    }
    return String(value)
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined
  }

  if (typeof value !== "object") {
    return escapeJsonString(String(value))
  }

  if (value instanceof Uint8Array) {
    return `[${Array.from(value).join(",")}]`
  }

  const toJSON = (value as { readonly toJSON?: unknown }).toJSON
  if (typeof toJSON === "function") {
    const jsonValue = toJSON.call(value)
    if (jsonValue !== value) {
      return stringifyValue(jsonValue, state)
    }
  }

  if (state.seen.has(value)) {
    throw new TypeError("Converting circular structure to JSON")
  }
  state.seen.add(value)

  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((entry) => stringifyValue(entry, state) ?? "null")
        .join(",")}]`
    }

    const fields = Object.entries(value).flatMap(([key, entry]) => {
      const encoded = stringifyValue(entry, state)
      return encoded === undefined
        ? []
        : [`${escapeJsonString(key)}:${encoded}`]
    })

    return `{${fields.join(",")}}`
  } finally {
    state.seen.delete(value)
  }
}

const stringify = (value: unknown): string =>
  stringifyValue(value, { seen: new WeakSet() }) ?? "null"

export const encodeHttpInput = (value: unknown): string => stringify(value)

export const decodeHttpOutput = <A>(
  type: AnyValueType,
  body: string,
): Effect.Effect<A, StdbDecodeError> =>
  parseJsonPreservingIntegers(body).pipe(
    Effect.flatMap((parsed) =>
      Effect.try({
        try: () => normalizeValueType(type, parsed),
        catch: (cause) => parseFailure(body, cause),
      }),
    ),
    Effect.flatMap((normalized) =>
      Schema.decodeUnknownEffect(type.schema)(normalized),
    ),
    Effect.map((decoded) => decoded as A),
    Effect.mapError((cause) => new StdbDecodeError({ phase: "ok", cause })),
  )
