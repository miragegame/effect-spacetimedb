import * as AST from "effect/SchemaAST"

import { encodedAst } from "../../contract/schema-annotations.ts"

import * as TypeDescriptor from "../../contract/type/descriptor.ts"

import { foldValue } from "../../contract/type/value-fold.ts"

import { type AnyValueType, structFieldWireType } from "../../contract/type.ts"

import {
  isSatsUnitValue,
  normalizeResultValue,
  normalizeSumValue,
  normalizeTuple,
  normalizeTypeLiteral,
  normalizeUnion,
  normalizeUnknown,
} from "./http-json-ast-normalize.ts"

import { normalizeLiteralValue } from "./http-json-input.ts"

import {
  integerToBigInt,
  integerToNumber,
  isIntegerToken,
  isJsonRecord,
  normalizeDeclaredField,
  normalizeSpecialRecord,
} from "./http-json-parser.ts"

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
