// lint-ignore: unused-files - shared internal host representation codec used by client/server adapters.
import * as Data from "effect/Data"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import { errorTypeId, hasErrorTypeId } from "../../error-identity.ts"
import { pascalCaseName } from "../canonical-name.ts"
import type { AnyValueType } from "../type.ts"
import * as Type from "../type.ts"
import * as TypeDescriptor from "./descriptor.ts"
import { foldValue } from "./value-fold.ts"

type StdbHostEncodeErrorFields = {
  readonly reason:
    | "ExpectedArray"
    | "ExpectedStruct"
    | "MissingStructField"
    | "ExpectedResult"
    | "MissingResultOkValue"
    | "MissingResultErrValue"
    | "ExpectedResultEnvelope"
    | "ExpectedSumEnvelope"
    | "UnknownSumVariant"
    | "MissingSumValue"
  readonly field?: string
  readonly variant?: string
}

const hostEncodeErrorMessage = (error: StdbHostEncodeErrorFields): string =>
  Match.value(error.reason).pipe(
    Match.when("ExpectedArray", () => "Expected array host value"),
    Match.when("ExpectedStruct", () => "Expected struct host value"),
    Match.when("MissingStructField", () =>
      error.field === undefined
        ? "Missing required host struct field"
        : `Missing required host struct field ${error.field}`,
    ),
    Match.when("ExpectedResult", () => "Expected result host value"),
    Match.when("MissingResultOkValue", () => "Missing result host ok value"),
    Match.when("MissingResultErrValue", () => "Missing result host err value"),
    Match.when("ExpectedResultEnvelope", () => "Expected result host envelope"),
    Match.when("ExpectedSumEnvelope", () => "Expected sum host envelope"),
    Match.when("UnknownSumVariant", () =>
      error.variant === undefined
        ? "Unknown sum host variant"
        : `Unknown sum host variant ${error.variant}`,
    ),
    Match.when("MissingSumValue", () =>
      error.variant === undefined
        ? "Missing sum host value"
        : `Missing sum host value for ${error.variant}`,
    ),
    Match.exhaustive,
  )

const StdbHostEncodeErrorTypeId = errorTypeId("StdbHostEncodeError")
export class StdbHostEncodeError extends Data.TaggedError(
  "StdbHostEncodeError",
)<StdbHostEncodeErrorFields> {
  readonly [StdbHostEncodeErrorTypeId] = StdbHostEncodeErrorTypeId
  static is = hasErrorTypeId<StdbHostEncodeError>(StdbHostEncodeErrorTypeId)

  override get message(): string {
    return hostEncodeErrorMessage(this)
  }
}

const isHostRecord = (value: unknown): value is Record<string, unknown> =>
  !Array.isArray(value) && value !== null && typeof value === "object"

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(value, key)

const ownVariant = (
  variants: Type.SumVariants,
  tag: string,
): AnyValueType | undefined =>
  hasOwn(variants, tag) ? variants[tag] : undefined

const encodeSchema = (type: AnyValueType, value: unknown): unknown =>
  Schema.encodeSync(type.schema)(value)

const encodeHostArray = (
  item: AnyValueType,
  value: unknown,
  recurse: (type: AnyValueType, value: unknown) => unknown,
): ReadonlyArray<unknown> => {
  if (!Array.isArray(value)) {
    throw new StdbHostEncodeError({ reason: "ExpectedArray" })
  }

  return value.map((entry) => recurse(item, entry))
}

const encodeHostOption = (
  item: AnyValueType,
  value: unknown,
  recurse: (type: AnyValueType, value: unknown) => unknown,
): unknown => (value === undefined ? undefined : recurse(item, value))

const encodeHostStruct = (
  fields: Type.StructFields,
  value: unknown,
  recurse: (type: AnyValueType, value: unknown) => unknown,
): Record<string, unknown> => {
  if (!isHostRecord(value)) {
    throw new StdbHostEncodeError({ reason: "ExpectedStruct" })
  }

  const encoded: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(fields)) {
    const fieldOptions = Type.structFieldOptions(field)
    const optionField = TypeDescriptor.kind(field) === "option"
    if (!hasOwn(value, key)) {
      if (fieldOptions.optional || optionField) continue
      throw new StdbHostEncodeError({
        reason: "MissingStructField",
        field: key,
      })
    }

    const fieldValue = value[key]
    if (fieldOptions.optional && fieldValue === undefined) {
      encoded[key] = undefined
      continue
    }

    encoded[key] = recurse(field, fieldValue)
  }

  return encoded
}

const encodeHostResult = (
  members: ReadonlyArray<AnyValueType>,
  value: unknown,
  recurse: (type: AnyValueType, value: unknown) => unknown,
): unknown => {
  if (!isHostRecord(value)) {
    throw new StdbHostEncodeError({ reason: "ExpectedResult" })
  }

  const ok = members[0]
  const err = members[1]
  const encodeMember = (
    tag: "ok" | "err",
    member: AnyValueType,
    memberValue: unknown,
    hasValue: boolean,
    missingReason: "MissingResultOkValue" | "MissingResultErrValue",
  ): Record<string, unknown> => {
    const authoredUnit = Type.isAuthoredUnitValueType(member)

    if (!authoredUnit && !hasValue) {
      throw new StdbHostEncodeError({
        reason: missingReason,
      })
    }

    const encoded = recurse(
      member,
      authoredUnit && !hasValue ? undefined : memberValue,
    )

    return Type.isUnitValueType(member) ? { [tag]: {} } : { [tag]: encoded }
  }

  if (ok != null && hasOwn(value, "ok")) {
    return encodeMember("ok", ok, value.ok, true, "MissingResultOkValue")
  }
  if (ok != null && value.tag === "ok") {
    return encodeMember(
      "ok",
      ok,
      value.value,
      hasOwn(value, "value"),
      "MissingResultOkValue",
    )
  }
  if (err != null && hasOwn(value, "err")) {
    return encodeMember("err", err, value.err, true, "MissingResultErrValue")
  }
  if (err != null && value.tag === "err") {
    return encodeMember(
      "err",
      err,
      value.value,
      hasOwn(value, "value"),
      "MissingResultErrValue",
    )
  }

  throw new StdbHostEncodeError({ reason: "ExpectedResultEnvelope" })
}

const encodeHostSum = (
  variants: Type.SumVariants,
  value: unknown,
  recurse: (type: AnyValueType, value: unknown) => unknown,
): unknown => {
  if (!isHostRecord(value) || typeof value.tag !== "string") {
    throw new StdbHostEncodeError({ reason: "ExpectedSumEnvelope" })
  }

  const variant = ownVariant(variants, value.tag)
  if (variant === undefined) {
    throw new StdbHostEncodeError({
      reason: "UnknownSumVariant",
      variant: value.tag,
    })
  }

  const authoredUnit = Type.isAuthoredUnitValueType(variant)
  const wireUnit = Type.isUnitValueType(variant)
  const hasValue = hasOwn(value, "value")

  if (!authoredUnit && !hasValue) {
    throw new StdbHostEncodeError({
      reason: "MissingSumValue",
      variant: value.tag,
    })
  }

  const encodedValue = recurse(
    variant,
    authoredUnit && !hasValue ? undefined : value.value,
  )

  if (wireUnit) {
    return { tag: value.tag }
  }

  return {
    tag: value.tag,
    value: encodedValue,
  }
}

export const encodeHostValue = foldValue<unknown>({
  absent: encodeSchema,
  array: (_type, item, value, recurse) => encodeHostArray(item, value, recurse),
  custom: (type, _item, value) => encodeSchema(type, value),
  literal: (type, _values, value) => encodeSchema(type, value),
  option: (_type, item, value, recurse) =>
    encodeHostOption(item, value, recurse),
  primitive: (type, _kind, value) => encodeSchema(type, value),
  result: (_type, members, value, recurse) =>
    encodeHostResult(members, value, recurse),
  struct: (_type, fields, value, recurse) =>
    encodeHostStruct(fields, value, recurse),
  sum: (_type, variants, value, recurse) =>
    encodeHostSum(variants, value, recurse),
})

const encodeGeneratedClientLiteral = (
  type: AnyValueType,
  values: TypeDescriptor.StdbLiteralDescriptor["values"],
  value: unknown,
): unknown => {
  const encoded = encodeSchema(type, value)
  const isStringLiteral = values.every((entry) => typeof entry === "string")
  if (
    !isStringLiteral ||
    !isHostRecord(encoded) ||
    typeof encoded.tag !== "string"
  ) {
    return encoded
  }

  // String literals lower to authored-verbatim SATS tags; generated clients
  // expose the same enum variants through SpaceTimeDB's PascalCase convention.
  return {
    ...encoded,
    tag: pascalCaseName(encoded.tag),
  }
}

const sumVariantEntry = (
  variants: Type.SumVariants,
  tag: string,
): readonly [string, AnyValueType] | undefined => {
  const direct = ownVariant(variants, tag)
  if (direct !== undefined) {
    return [tag, direct] as const
  }

  return Object.entries(variants).find(
    ([authoredTag]) => pascalCaseName(authoredTag) === tag,
  )
}

const encodeGeneratedClientSum = (
  variants: Type.SumVariants,
  value: unknown,
  recurse: (type: AnyValueType, value: unknown) => unknown,
): unknown => {
  if (!isHostRecord(value) || typeof value.tag !== "string") {
    throw new StdbHostEncodeError({ reason: "ExpectedSumEnvelope" })
  }

  const entry = sumVariantEntry(variants, value.tag)
  if (entry === undefined) {
    throw new StdbHostEncodeError({
      reason: "UnknownSumVariant",
      variant: value.tag,
    })
  }
  const [authoredTag, variant] = entry

  const authoredUnit = Type.isAuthoredUnitValueType(variant)
  const wireUnit = Type.isUnitValueType(variant)
  const hasValue = hasOwn(value, "value")

  if (!authoredUnit && !hasValue) {
    throw new StdbHostEncodeError({
      reason: "MissingSumValue",
      variant: value.tag,
    })
  }

  const encodedValue = recurse(
    variant,
    authoredUnit && !hasValue ? undefined : value.value,
  )
  const tag = pascalCaseName(authoredTag)

  if (wireUnit) {
    return { tag }
  }

  return {
    tag,
    value: encodedValue,
  }
}

export const encodeGeneratedClientValue = foldValue<unknown>({
  absent: encodeSchema,
  array: (_type, item, value, recurse) => encodeHostArray(item, value, recurse),
  custom: (type, _item, value) => encodeSchema(type, value),
  literal: encodeGeneratedClientLiteral,
  option: (_type, item, value, recurse) =>
    encodeHostOption(item, value, recurse),
  primitive: (type, _kind, value) => encodeSchema(type, value),
  result: (_type, members, value, recurse) =>
    encodeHostResult(members, value, recurse),
  struct: (_type, fields, value, recurse) =>
    encodeHostStruct(fields, value, recurse),
  sum: (_type, variants, value, recurse) =>
    encodeGeneratedClientSum(variants, value, recurse),
})

const normalizeHostOption = (
  item: AnyValueType,
  value: unknown,
  recurse: (type: AnyValueType, value: unknown) => unknown,
): unknown =>
  value === undefined ? { none: {} } : { some: recurse(item, value) }

const normalizeHostStruct = (
  fields: Type.StructFields,
  value: unknown,
  recurse: (type: AnyValueType, value: unknown) => unknown,
): unknown => {
  if (!isHostRecord(value)) {
    return value
  }

  const normalized: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(fields)) {
    if (hasOwn(value, key)) {
      normalized[key] = recurse(Type.structFieldWireType(field), value[key])
    }
  }
  return normalized
}

const normalizeHostResult = (
  members: ReadonlyArray<AnyValueType>,
  value: unknown,
  recurse: (type: AnyValueType, value: unknown) => unknown,
): unknown => {
  if (!isHostRecord(value)) {
    return value
  }

  const ok = members[0]
  const err = members[1]
  const keys = Object.keys(value)
  const hasOk = hasOwn(value, "ok")
  const hasErr = hasOwn(value, "err")

  if (ok != null && hasOk && !hasErr && keys.length === 1) {
    return Type.isUnitValueType(ok)
      ? { tag: "ok" }
      : { tag: "ok", value: recurse(ok, value.ok) }
  }
  if (err != null && hasErr && !hasOk && keys.length === 1) {
    return Type.isUnitValueType(err)
      ? { tag: "err" }
      : { tag: "err", value: recurse(err, value.err) }
  }
  if (ok != null && value.tag === "ok") {
    return Type.isUnitValueType(ok)
      ? { tag: "ok" }
      : hasOwn(value, "value")
        ? { tag: "ok", value: recurse(ok, value.value) }
        : value
  }
  if (err != null && value.tag === "err") {
    return Type.isUnitValueType(err)
      ? { tag: "err" }
      : hasOwn(value, "value")
        ? { tag: "err", value: recurse(err, value.value) }
        : value
  }

  return value
}

const normalizeHostSum = (
  variants: Type.SumVariants,
  value: unknown,
  recurse: (type: AnyValueType, value: unknown) => unknown,
): unknown => {
  if (!isHostRecord(value)) {
    return value
  }

  if (typeof value.tag === "string") {
    const entry = sumVariantEntry(variants, value.tag)
    if (entry === undefined) {
      return value
    }

    const [tag, variant] = entry
    if (Type.isUnitValueType(variant)) {
      return { tag }
    }
    if (!hasOwn(value, "value")) {
      return value
    }
    return {
      tag,
      value: recurse(variant, value.value),
    }
  }

  const entries = Object.entries(value)
  if (entries.length !== 1) {
    return value
  }

  const [rawTag, payload] = entries[0] as readonly [string, unknown]
  const variantEntry = sumVariantEntry(variants, rawTag)
  if (variantEntry === undefined) {
    return value
  }

  const [tag, variant] = variantEntry
  return Type.isUnitValueType(variant)
    ? { tag }
    : { [tag]: recurse(variant, payload) }
}

const normalizeHostValue = foldValue<unknown>({
  absent: (_type, value) => value,
  array: (_type, item, value, recurse) =>
    Array.isArray(value) ? value.map((entry) => recurse(item, entry)) : value,
  custom: (_type, _item, value) => value,
  literal: (_type, _values, value) => value,
  option: (_type, item, value, recurse) =>
    normalizeHostOption(item, value, recurse),
  primitive: (_type, _kind, value) => value,
  result: (_type, members, value, recurse) =>
    normalizeHostResult(members, value, recurse),
  struct: (_type, fields, value, recurse) =>
    normalizeHostStruct(fields, value, recurse),
  sum: (_type, variants, value, recurse) =>
    normalizeHostSum(variants, value, recurse),
})

export const decodeHostValue = <A = unknown>(
  type: AnyValueType,
  value: unknown,
): A =>
  Schema.decodeUnknownSync(type.schema)(normalizeHostValue(type, value)) as A
