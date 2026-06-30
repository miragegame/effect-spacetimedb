import { snakeCaseName } from "../../contract/canonical-name.ts"

import * as TypeDescriptor from "../../contract/type/descriptor.ts"

import { foldValue, type Recurse } from "../../contract/type/value-fold.ts"

import { isUnitValueType, structFieldWireType } from "../../contract/type.ts"

import {
  normalizeStringLiteralTag,
  stringLiteralWireTags,
} from "./http-json-literal-tags.ts"

import { isJsonRecord, ownValue } from "./http-json-parser.ts"

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
