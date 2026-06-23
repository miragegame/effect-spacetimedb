import { snakeCaseName } from "../../contract/canonical-name.ts"

import {
  stringLiteralGeneratedClientTag,
  stringLiteralSatsVariantTag,
} from "../../contract/literal-tags.ts"

import * as TypeDescriptor from "../../contract/type/descriptor.ts"

import { foldValue, type Recurse } from "../../contract/type/value-fold.ts"

import {
  type AnyValueType,
  isUnitValueType,
  structFieldWireType,
} from "../../contract/type.ts"

import { isSatsUnitValue } from "./http-json-ast-normalize.ts"

import { normalizeAst } from "./http-json-output.ts"

import {
  integerToNumber,
  isIntegerToken,
  isJsonRecord,
  ownValue,
} from "./http-json-parser.ts"

export const stringLiteralWireTags = (
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

export const normalizeStringLiteralTag = (
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

export const literalTagFromIndex = (
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

export const prepareLiteralInputValue = (
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

export const prepareSumInputValue = (
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

export const prepareResultInputValue = (
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

export const preparePrimitiveInputValue = (
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
