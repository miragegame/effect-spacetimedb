import * as Effect from "effect/Effect"

import * as Schema from "effect/Schema"

import * as ParseResult from "../../schema-parse.ts"

import { transformOrFail } from "../../schema-transform.ts"

import type {
  AnyValueType,
  EncodedOf,
  StructFields,
  SumVariants,
  TypeOf,
} from "./core.ts"
import { isValueType } from "./core.ts"
import {
  isRecord,
  isTaggedPayloadEnvelope,
  isUnitWireValue,
  singleEntryEnvelopeOf,
  sumVariantEntry,
  sumVariantFromDecoded,
  taggedEnvelopeOf,
} from "./envelope.ts"
import {
  hasOptionalFieldOption,
  isAuthoredUnitValueType,
  isOptionValueType,
  isUnitValueType,
} from "./predicates.ts"
import type {
  OptionWire,
  ResultWireVariant,
  StructType,
  SumType,
  SumWire,
} from "./shapes.ts"

export type {
  OptionalKeys,
  OptionalStructField,
  OptionWire,
  RequiredKeys,
  ResultType,
  ResultWire,
  ResultWireVariant,
  StructType,
  SumType,
  SumVariant,
  SumWire,
  SumWireVariant,
  UnitWire,
} from "./shapes.ts"
export {
  isRecord,
  isUnitWireValue,
  makeSumVariantConstructors,
  sumVariantFromDecoded,
} from "./envelope.ts"

export const isOkResult = (value: unknown): value is { readonly ok: unknown } =>
  isRecord(value) &&
  "ok" in value &&
  !("err" in value) &&
  Object.keys(value).length === 1

export const isErrResult = (
  value: unknown,
): value is { readonly err: unknown } =>
  isRecord(value) &&
  "err" in value &&
  !("ok" in value) &&
  Object.keys(value).length === 1

export const makeExactResultSchema = <
  OkSchema extends AnyValueType,
  ErrSchema extends AnyValueType,
>(
  okSchema: OkSchema,
  errSchema: ErrSchema,
): Schema.Codec<
  { readonly ok: TypeOf<OkSchema> } | { readonly err: TypeOf<ErrSchema> },
  | ResultWireVariant<"ok", EncodedOf<OkSchema>>
  | ResultWireVariant<"err", EncodedOf<ErrSchema>>,
  never
> => {
  type Ok = TypeOf<OkSchema>
  type OkEncoded = EncodedOf<OkSchema>
  type Err = TypeOf<ErrSchema>
  type ErrEncoded = EncodedOf<ErrSchema>

  const okIsUnit = isUnitValueType(okSchema)
  const errIsUnit = isUnitValueType(errSchema)
  return transformOrFail(Schema.Unknown, Schema.Unknown, {
    strict: true,
    decode: (encoded) => {
      const envelope = taggedEnvelopeOf(encoded)
      if (envelope === undefined) {
        return Effect.fail(new ParseResult.Unexpected(encoded))
      }

      if (envelope.tag === "ok") {
        if (
          !isTaggedPayloadEnvelope(envelope, {
            unit: okIsUnit,
            allowUnitWireValue: true,
          })
        ) {
          return Effect.fail(new ParseResult.Unexpected(encoded))
        }

        return okIsUnit
          ? Schema.decodeUnknownEffect(okSchema.schema)(undefined).pipe(
              Effect.mapError((error) => error.issue),
              Effect.map((decoded) => ({ ok: decoded })),
            )
          : Schema.decodeUnknownEffect(okSchema.schema)(envelope.value).pipe(
              Effect.mapError((error) => error.issue),
              Effect.map((decoded) => ({ ok: decoded })),
            )
      }

      if (envelope.tag === "err") {
        if (
          !isTaggedPayloadEnvelope(envelope, {
            unit: errIsUnit,
            allowUnitWireValue: true,
          })
        ) {
          return Effect.fail(new ParseResult.Unexpected(encoded))
        }

        return errIsUnit
          ? Schema.decodeUnknownEffect(errSchema.schema)(undefined).pipe(
              Effect.mapError((error) => error.issue),
              Effect.map((decoded) => ({ err: decoded })),
            )
          : Schema.decodeUnknownEffect(errSchema.schema)(envelope.value).pipe(
              Effect.mapError((error) => error.issue),
              Effect.map((decoded) => ({ err: decoded })),
            )
      }

      return Effect.fail(new ParseResult.Unexpected(encoded))
    },
    encode: (value) => {
      if (isOkResult(value)) {
        return Schema.encodeEffect(okSchema.schema)(value.ok as Ok).pipe(
          Effect.mapError((error) => error.issue),
          Effect.map((encodedOk) =>
            okIsUnit
              ? ({ tag: "ok" } as ResultWireVariant<"ok", OkEncoded>)
              : ({
                  tag: "ok",
                  value: encodedOk,
                } as ResultWireVariant<"ok", OkEncoded>),
          ),
        )
      }

      if (isErrResult(value)) {
        return Schema.encodeEffect(errSchema.schema)(value.err as Err).pipe(
          Effect.mapError((error) => error.issue),
          Effect.map((encodedErr) =>
            errIsUnit
              ? ({ tag: "err" } as ResultWireVariant<"err", ErrEncoded>)
              : ({
                  tag: "err",
                  value: encodedErr,
                } as ResultWireVariant<"err", ErrEncoded>),
          ),
        )
      }

      return Effect.fail(
        new ParseResult.Type(value, "Expected result envelope"),
      )
    },
  }).pipe(
    narrowSchema<
      { readonly ok: Ok } | { readonly err: Err },
      ResultWireVariant<"ok", OkEncoded> | ResultWireVariant<"err", ErrEncoded>
    >,
  )
}

export const makeExactSumSchema = <Variants extends SumVariants>(
  variants: Variants,
): Schema.Codec<SumType<Variants>, SumWire<Variants>, never> => {
  const variantEntries = Object.entries(variants)
  const variantByTag = new Map(variantEntries)
  const wireUnitTags = new Set(
    variantEntries
      .filter(([, variant]) => isUnitValueType(variant))
      .map(([tag]) => tag),
  )
  const authoredUnitTags = new Set(
    variantEntries
      .filter(([, variant]) => isAuthoredUnitValueType(variant))
      .map(([tag]) => tag),
  )

  const decodeVariant = (
    tag: string,
    encodedValue: unknown,
    hasValue: boolean,
    original: unknown,
  ) => {
    const variantEntry = sumVariantEntry(variants, tag, {
      aliasPrecedence: "last",
    })
    if (variantEntry === undefined) {
      return Effect.fail(new ParseResult.Unexpected(original))
    }
    const [authoredTag, variant] = variantEntry

    const wireUnit = wireUnitTags.has(authoredTag)

    if (
      (wireUnit &&
        !(
          !hasValue ||
          encodedValue === undefined ||
          isUnitWireValue(encodedValue)
        )) ||
      (!wireUnit && !hasValue)
    ) {
      return Effect.fail(new ParseResult.Unexpected(original))
    }

    return wireUnit
      ? Schema.decodeUnknownEffect(variant.schema)(undefined).pipe(
          Effect.mapError((error) => error.issue),
          Effect.map((decoded) =>
            sumVariantFromDecoded<Variants>(authoredTag, decoded),
          ),
        )
      : Schema.decodeUnknownEffect(variant.schema)(encodedValue).pipe(
          Effect.mapError((error) => error.issue),
          Effect.map((decoded) =>
            authoredUnitTags.has(authoredTag)
              ? sumVariantFromDecoded<Variants>(authoredTag, decoded)
              : ({
                  tag: authoredTag,
                  value: decoded,
                } as SumType<Variants>),
          ),
        )
  }

  return transformOrFail(Schema.Unknown, Schema.Unknown, {
    strict: true,
    decode: (encoded) => {
      if (Array.isArray(encoded)) {
        const [tag, value, ...rest] = encoded
        if (rest.length > 0 || typeof tag !== "string") {
          return Effect.fail(new ParseResult.Unexpected(encoded))
        }
        return decodeVariant(tag, value, encoded.length >= 2, encoded)
      }

      if (!isRecord(encoded)) {
        return Effect.fail(new ParseResult.Unexpected(encoded))
      }

      const envelope = taggedEnvelopeOf(encoded)
      if (envelope !== undefined) {
        const variantEntry = sumVariantEntry(variants, envelope.tag, {
          aliasPrecedence: "last",
        })
        if (variantEntry === undefined) {
          return Effect.fail(new ParseResult.Unexpected(encoded))
        }
        const [authoredTag] = variantEntry

        const unit = wireUnitTags.has(authoredTag)
        if (
          !isTaggedPayloadEnvelope(envelope, {
            unit,
            allowUnitWireValue: true,
          })
        ) {
          return Effect.fail(new ParseResult.Unexpected(encoded))
        }

        return decodeVariant(
          authoredTag,
          envelope.value,
          envelope.hasValue,
          encoded,
        )
      }

      const entry = singleEntryEnvelopeOf(encoded)
      if (entry === undefined) {
        return Effect.fail(new ParseResult.Unexpected(encoded))
      }

      return decodeVariant(entry.tag, entry.value, true, encoded)
    },
    encode: (value) => {
      if (!isRecord(value) || typeof value.tag !== "string") {
        return Effect.fail(new ParseResult.Type(value, "Expected sum envelope"))
      }

      const tag = value.tag
      const variant = variantByTag.get(tag)
      if (variant === undefined) {
        return Effect.fail(new ParseResult.Unexpected(value))
      }

      const keys = Object.keys(value)
      const hasValue = Object.hasOwn(value, "value")
      const authoredUnit = authoredUnitTags.has(tag)
      const wireUnit = wireUnitTags.has(tag)

      if (
        (!authoredUnit && (keys.length !== 2 || !hasValue)) ||
        keys.length > 2
      ) {
        return Effect.fail(new ParseResult.Unexpected(value))
      }
      if (
        authoredUnit &&
        !(keys.length === 1 || (keys.length === 2 && hasValue))
      ) {
        return Effect.fail(new ParseResult.Unexpected(value))
      }

      return Schema.encodeEffect(variant.schema)(
        authoredUnit && !hasValue ? undefined : value.value,
      ).pipe(
        Effect.mapError((error) => error.issue),
        wireUnit
          ? Effect.as({ [tag]: {} } as SumWire<Variants>)
          : Effect.map(
              (encodedValue) => ({ [tag]: encodedValue }) as SumWire<Variants>,
            ),
      )
    },
  }).pipe(narrowSchema<SumType<Variants>, SumWire<Variants>>)
}

export const makeOptionSchema = <Inner extends AnyValueType>(
  inner: Inner,
): Schema.Codec<TypeOf<Inner> | undefined, OptionWire<Inner>, never> =>
  transformOrFail(Schema.Unknown, Schema.Unknown, {
    strict: true,
    decode: (encoded) => {
      if (encoded === undefined || encoded === null) {
        return Effect.void
      }

      const optionEntry = singleEntryEnvelopeOf(encoded)
      if (optionEntry !== undefined) {
        if (optionEntry.tag === "none") {
          return isUnitWireValue(optionEntry.value)
            ? Effect.void
            : Effect.fail(new ParseResult.Unexpected(encoded))
        }

        if (optionEntry.tag === "some") {
          return Schema.decodeUnknownEffect(inner.schema)(
            optionEntry.value,
          ).pipe(Effect.mapError((error) => error.issue))
        }
      }

      return Schema.decodeUnknownEffect(inner.schema)(encoded).pipe(
        Effect.mapError((error) => error.issue),
      )
    },
    encode: (value) =>
      value === undefined
        ? Effect.succeed({ none: {} } as OptionWire<Inner>)
        : Schema.encodeEffect(inner.schema)(value).pipe(
            Effect.mapError((error) => error.issue),
            Effect.map((encoded) => ({ some: encoded }) as OptionWire<Inner>),
          ),
  }).pipe(narrowSchema<TypeOf<Inner> | undefined, OptionWire<Inner>>)

export const structTypeError = (
  value: unknown,
  message: string,
): ParseResult.ParseIssue => new ParseResult.Type(value, message)

export type StructFieldCodecEntry = {
  readonly optional: boolean
  readonly option: boolean
  // The codec matching the field's wire shape: optional fields share the option codec so
  // their wire is identical to an `Stdb.option` field (see structFieldWireType).
  readonly schema: Schema.Codec<unknown, unknown, never>
}

// Lazily computed and memoized so constructing a struct over malformed fields (e.g. raw
// schemas) stays inert — module validation reports those as diagnostics when the type is
// lowered; the codec must not crash earlier than the pre-lowering behavior did.
export const makeStructFieldCodecs = (): ((
  key: string,
  field: AnyValueType,
) => StructFieldCodecEntry) => {
  const cache = new Map<string, StructFieldCodecEntry>()
  return (key, field) => {
    const cached = cache.get(key)
    if (cached !== undefined) {
      return cached
    }
    const optional = isValueType(field) && hasOptionalFieldOption(field)
    const entry: StructFieldCodecEntry = {
      optional,
      option: isValueType(field) && isOptionValueType(field),
      schema: optional
        ? narrowSchema<unknown, unknown>(makeOptionSchema(field))
        : narrowSchema<unknown, unknown>(field.schema),
    }
    cache.set(key, entry)
    return entry
  }
}

export const makeStructSchema = <Fields extends StructFields>(
  fields: Fields,
): Schema.Codec<StructType<Fields>, unknown, never> => {
  const fieldCodec = makeStructFieldCodecs()

  return transformOrFail(Schema.Unknown, Schema.Unknown, {
    strict: true,
    decode: Effect.fn(function* (encoded) {
      if (!isRecord(encoded)) {
        return yield* Effect.fail(
          structTypeError(encoded, "Expected struct object"),
        )
      }

      const decoded: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(fields)) {
        const field = fieldCodec(key, value)
        if (!Object.hasOwn(encoded, key)) {
          if (field.optional) continue
          if (field.option) {
            decoded[key] = undefined
            continue
          }
          return yield* Effect.fail(
            structTypeError(encoded, `Missing required struct field ${key}`),
          )
        }

        const fieldValue = encoded[key]
        if (field.optional && fieldValue === undefined) {
          decoded[key] = undefined
          continue
        }

        decoded[key] = yield* Schema.decodeUnknownEffect(field.schema)(
          fieldValue,
        ).pipe(Effect.mapError((error) => error.issue))
      }

      return decoded as StructType<Fields>
    }),
    encode: Effect.fn(function* (value) {
      if (!isRecord(value)) {
        return yield* Effect.fail(
          structTypeError(value, "Expected struct object"),
        )
      }

      const encoded: Record<string, unknown> = {}
      for (const [key, fieldValueType] of Object.entries(fields)) {
        const field = fieldCodec(key, fieldValueType)
        if (!Object.hasOwn(value, key)) {
          if (field.optional || field.option) {
            encoded[key] = yield* Schema.encodeEffect(field.schema)(
              undefined,
            ).pipe(Effect.mapError((error) => error.issue))
            continue
          }
          return yield* Effect.fail(
            structTypeError(value, `Missing required struct field ${key}`),
          )
        }

        const fieldValue = value[key]
        encoded[key] = yield* Schema.encodeEffect(field.schema)(
          fieldValue,
        ).pipe(Effect.mapError((error) => error.issue))
      }

      return encoded
    }),
  }).pipe(narrowSchema<StructType<Fields>, unknown>)
}

export const narrowSchema = <A, Encoded>(
  schema: Schema.Top,
): Schema.Codec<A, Encoded, never> =>
  // Descriptor-driven transforms start from Schema.Unknown because their accepted
  // wire envelopes are richer than a static Schema.Struct union can express today.
  // Keep the A/Encoded assertion here so callers do not each carry local casts.
  schema as Schema.Codec<A, Encoded, never>
