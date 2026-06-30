import * as AST from "effect/SchemaAST"

import { encodedAst } from "../../contract/schema-annotations.ts"

import * as TypeDescriptor from "../../contract/type/descriptor.ts"

import { foldValue, type Recurse } from "../../contract/type/value-fold.ts"

import {
  type AnyValueType,
  isUnitValueType,
  structFieldWireType,
} from "../../contract/type.ts"

import {
  literalTagFromIndex,
  normalizeStringLiteralTag,
  stringLiteralWireTags,
} from "./http-json-literal-tags.ts"

import {
  integerToBigInt,
  integerToNumber,
  isIntegerToken,
  isJsonRecord,
  normalizeDeclaredField,
  normalizeSpecialRecord,
  ownValue,
} from "./http-json-parser.ts"

export const flattenJsonUnionMembers = (
  members: ReadonlyArray<AST.AST>,
): ReadonlyArray<AST.AST> =>
  members.flatMap((member) =>
    AST.isUnion(member) ? flattenJsonUnionMembers(member.types) : [member],
  )

export const propertyAst = (ast: AST.AST, name: string): AST.AST | undefined =>
  AST.isObjects(ast)
    ? ast.propertySignatures.find((property) => property.name === name)?.type
    : undefined

export const literalString = (ast: AST.AST): string | undefined => {
  const normalized = encodedAst(ast)
  return AST.isLiteral(normalized) && typeof normalized.literal === "string"
    ? normalized.literal
    : undefined
}

export const memberTag = (member: AST.AST): string | undefined => {
  const tagAst = propertyAst(encodedAst(member), "tag")
  return tagAst != null ? literalString(tagAst) : undefined
}

export const taggedMember = (
  members: ReadonlyArray<AST.AST>,
  tag: string,
): AST.AST | undefined => members.find((member) => memberTag(member) === tag)

export const isSatsUnitValue = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) && value.length === 0) ||
  (isJsonRecord(value) && Object.keys(value).length === 0)

export const astAllowsUnitOmission = (ast: AST.AST): boolean => {
  const normalized = encodedAst(ast)
  if (AST.isVoid(normalized) || AST.isUndefined(normalized)) {
    return true
  }
  return AST.isUnion(normalized)
    ? flattenJsonUnionMembers(normalized.types).some(astAllowsUnitOmission)
    : false
}

export const normalizedVariantValue = (
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

export const normalizeUnknown = (value: unknown): unknown => {
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

export const normalizeUnion = (ast: AST.Union, value: unknown): unknown => {
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

export const normalizeTypeLiteral = (
  ast: AST.Objects,
  value: unknown,
): unknown => {
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

export const normalizeTuple = (ast: AST.Arrays, value: unknown): unknown => {
  if (!Array.isArray(value)) {
    return value
  }

  const rest =
    ast.elements.length === 0 && ast.rest.length === 1 ? ast.rest[0] : undefined

  return rest != null ? value.map((entry) => normalizeAst(rest, entry)) : value
}

export const normalizeResultVariant = (
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

export const normalizeResultValue = (
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

export const normalizeSumVariant = (
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

export const normalizeSumValue = (
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

export const productFieldValue = (value: unknown): unknown | undefined =>
  Array.isArray(value) && value.length === 1 ? value[0] : undefined

export type PrimitiveNormalizer = (options: {
  readonly type: AnyValueType
  readonly value: unknown
  readonly productValue: unknown | undefined
}) => unknown

export const normalizeDefaultPrimitive: PrimitiveNormalizer = ({
  type,
  value,
}) => normalizeAst(type.schema.ast, value)

export const primitiveNormalizers = {
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

export const normalizePrimitiveValue = (
  type: AnyValueType,
  kind: TypeDescriptor.StdbPrimitiveDescriptor["kind"],
  value: unknown,
): unknown =>
  primitiveNormalizers[kind]({
    type,
    value,
    productValue: productFieldValue(value),
  })

export const normalizeLiteralValue = (
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

export const normalizeValueType = foldValue<unknown>({
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

export const normalizeAst = (ast: AST.AST, value: unknown): unknown => {
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
