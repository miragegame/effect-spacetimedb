import * as AST from "effect/SchemaAST"

import { encodedAst } from "../../contract/schema-annotations.ts"

import * as TypeDescriptor from "../../contract/type/descriptor.ts"

import { type Recurse } from "../../contract/type/value-fold.ts"

import { type AnyValueType, isUnitValueType } from "../../contract/type.ts"

import { normalizeAst } from "./http-json-output.ts"

import {
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
