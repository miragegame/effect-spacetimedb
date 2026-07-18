import { typedFromEntries } from "../../utils.ts"
import { pascalCaseName } from "../canonical-name.ts"
import type { AnyValueType, SumVariants } from "./core.ts"
import { isAuthoredUnitValueType } from "./predicates.ts"
import type { SumType } from "./shapes.ts"

export type TaggedEnvelope = {
  readonly tag: string
  readonly hasValue: boolean
  readonly value: unknown
  readonly keys: ReadonlyArray<string>
}

export type SingleEntryEnvelope = {
  readonly tag: string
  readonly value: unknown
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(value, key)

export const isUnitWireValue = (value: unknown): boolean =>
  (Array.isArray(value) && value.length === 0) ||
  (isRecord(value) && Object.keys(value).length === 0)

export const isMissingOrUnitWireValue = (value: unknown): boolean =>
  value === undefined || isUnitWireValue(value)

export const taggedEnvelopeOf = (
  value: unknown,
): TaggedEnvelope | undefined => {
  if (
    !isRecord(value) ||
    typeof value.tag !== "string" ||
    !hasOwn(value, "tag")
  ) {
    return undefined
  }

  const hasValue = hasOwn(value, "value")
  return {
    tag: value.tag,
    hasValue,
    value: hasValue ? value.value : undefined,
    keys: Object.keys(value),
  }
}

export const singleEntryEnvelopeOf = (
  value: unknown,
): SingleEntryEnvelope | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const entries = Object.entries(value)
  const entry = entries[0]
  return entries.length === 1 && entry !== undefined
    ? { tag: entry[0], value: entry[1] }
    : undefined
}

export const acceptsTaggedUnitValue = (
  hasValue: boolean,
  value: unknown,
  options: {
    readonly allowUnitWireValue: boolean
  },
): boolean =>
  !hasValue ||
  value === undefined ||
  (options.allowUnitWireValue && isUnitWireValue(value))

export const isTaggedPayloadEnvelope = (
  envelope: Pick<TaggedEnvelope, "hasValue" | "keys" | "value">,
  options: {
    readonly unit: boolean
    readonly allowUnitWireValue: boolean
  },
): boolean =>
  options.unit
    ? (envelope.keys.length === 1 && !envelope.hasValue) ||
      (envelope.keys.length === 2 &&
        envelope.hasValue &&
        acceptsTaggedUnitValue(envelope.hasValue, envelope.value, options))
    : envelope.keys.length === 2 && envelope.hasValue

export const isAuthoredUnitPayloadEnvelope = (
  envelope: Pick<TaggedEnvelope, "hasValue" | "keys" | "value">,
): boolean =>
  (envelope.keys.length === 1 && !envelope.hasValue) ||
  (envelope.keys.length === 2 &&
    envelope.hasValue &&
    envelope.value === undefined)

export const sumVariantEntry = (
  variants: SumVariants,
  tag: string,
  options: {
    readonly aliasPrecedence?: "direct" | "last"
  } = {},
): readonly [string, AnyValueType] | undefined => {
  if (options.aliasPrecedence === "last") {
    let match: readonly [string, AnyValueType] | undefined
    for (const [authoredTag, variant] of Object.entries(variants)) {
      if (authoredTag === tag || pascalCaseName(authoredTag) === tag) {
        match = [authoredTag, variant] as const
      }
    }
    return match
  }

  if (hasOwn(variants, tag)) {
    return [tag, variants[tag] as AnyValueType] as const
  }
  return Object.entries(variants).find(
    ([authoredTag]) => pascalCaseName(authoredTag) === tag,
  )
}

export const sumVariantFromDecoded = <Variants extends SumVariants>(
  tag: string,
  decoded: unknown,
): SumType<Variants> =>
  decoded === undefined
    ? ({ tag } as SumType<Variants>)
    : ({ tag, value: decoded } as SumType<Variants>)

export const makeSumVariantConstructors = <const Variants extends SumVariants>(
  variants: Variants,
) =>
  typedFromEntries(
    Object.entries(variants).map(
      ([tag, variant]) =>
        [
          tag,
          isAuthoredUnitValueType(variant)
            ? { tag }
            : (value: unknown) => ({ tag, value }),
        ] as const,
    ),
  )
