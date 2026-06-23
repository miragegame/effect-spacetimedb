import * as Effect from "effect/Effect"

import * as Schema from "effect/Schema"

import * as ParseResult from "../compat/parse-result.ts"

import { transformOrFail } from "../compat/schema-transform.ts"

import { typedFromEntries } from "../utils.ts"

import { pascalCaseName } from "./canonical-name.ts"

import type {
  FieldOptions as TableFieldOptions,
  FieldType as TableFieldType,
} from "./field.ts"

import {
  hasOptionalFieldOption,
  isAuthoredUnitValueType,
  isOptionValueType,
  isUnitValueType,
} from "./type-constructors.ts"

import { isValueType } from "./type-core.ts"

import type {
  AnyValueType,
  EncodedOf,
  StructFieldOptions,
  StructFields,
  StructFieldType,
  SumVariants,
  TypeOf,
} from "./type-core.ts"

export type OptionalStructField<Field extends AnyValueType> =
  Field extends StructFieldType<
    AnyValueType,
    infer Options extends StructFieldOptions
  >
    ? Options["optional"] extends true
      ? true
      : false
    : Field extends TableFieldType<
          AnyValueType,
          infer Options extends TableFieldOptions
        >
      ? Options["optional"] extends true
        ? true
        : false
      : false

export type OptionalKeys<Fields extends StructFields> = {
  readonly [K in keyof Fields]-?: OptionalStructField<Fields[K]> extends true
    ? K
    : never
}[keyof Fields]

export type RequiredKeys<Fields extends StructFields> = Exclude<
  keyof Fields,
  OptionalKeys<Fields>
>

export type StructType<Fields extends StructFields> = {
  readonly [K in RequiredKeys<Fields>]: TypeOf<Fields[K]>
} & {
  readonly [K in OptionalKeys<Fields>]?: TypeOf<Fields[K]>
}

export type ResultType<Ok extends AnyValueType, Err extends AnyValueType> =
  | { readonly ok: TypeOf<Ok> }
  | { readonly err: TypeOf<Err> }

export type ResultWireVariant<Tag extends "ok" | "err", Value> = [
  Value,
] extends [void]
  ? {
      readonly tag: Tag
      readonly value?: Value
    }
  : {
      readonly tag: Tag
      readonly value: Value
    }

export type ResultWire<Ok extends AnyValueType, Err extends AnyValueType> =
  | ResultWireVariant<"ok", EncodedOf<Ok>>
  | ResultWireVariant<"err", EncodedOf<Err>>

export type SumVariant<Tag extends string, Value> = [Value] extends [void]
  ? {
      readonly tag: Tag
      readonly value?: Value
    }
  : {
      readonly tag: Tag
      readonly value: Value
    }

export type SumType<Variants extends SumVariants> = {
  readonly [Tag in keyof Variants & string]: SumVariant<
    Tag,
    TypeOf<Variants[Tag]>
  >
}[keyof Variants & string]

export type UnitWire = Readonly<Record<string, never>>

export type OptionWire<Inner extends AnyValueType> =
  | {
      readonly some: EncodedOf<Inner>
    }
  | {
      readonly none: UnitWire
    }

export type SumWireVariant<Tag extends string, Value> = {
  readonly [Key in Tag]: [Value] extends [void] ? UnitWire : Value
}

export type SumWire<Variants extends SumVariants> = {
  readonly [Tag in keyof Variants & string]: SumWireVariant<
    Tag,
    EncodedOf<Variants[Tag]>
  >
}[keyof Variants & string]

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

export type FieldOptionsAnnotation = {
  readonly primaryKey: boolean
  readonly autoInc: boolean
  readonly optional: boolean
  readonly hasDefault?: boolean
  readonly defaultValue?: unknown
  readonly name?: string
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const isUnitWireValue = (value: unknown): boolean =>
  (Array.isArray(value) && value.length === 0) ||
  (isRecord(value) && Object.keys(value).length === 0)

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
      if (
        !isRecord(encoded) ||
        typeof encoded.tag !== "string" ||
        !Object.hasOwn(encoded, "tag")
      ) {
        return Effect.fail(new ParseResult.Unexpected(encoded))
      }

      if (encoded.tag === "ok") {
        const keys = Object.keys(encoded)
        const hasValue = Object.hasOwn(encoded, "value")
        if (
          (okIsUnit &&
            !(
              (keys.length === 1 && !hasValue) ||
              (keys.length === 2 && hasValue && encoded.value === undefined)
            )) ||
          (!okIsUnit && (keys.length !== 2 || !hasValue))
        ) {
          return Effect.fail(new ParseResult.Unexpected(encoded))
        }

        return okIsUnit
          ? Schema.decodeUnknownEffect(okSchema.schema)(undefined).pipe(
              Effect.mapError((error) => error.issue),
              Effect.map((decoded) => ({ ok: decoded })),
            )
          : Schema.decodeUnknownEffect(okSchema.schema)(encoded.value).pipe(
              Effect.mapError((error) => error.issue),
              Effect.map((decoded) => ({ ok: decoded })),
            )
      }

      if (encoded.tag === "err") {
        const keys = Object.keys(encoded)
        const hasValue = Object.hasOwn(encoded, "value")
        if (
          (errIsUnit &&
            !(
              (keys.length === 1 && !hasValue) ||
              (keys.length === 2 && hasValue && encoded.value === undefined)
            )) ||
          (!errIsUnit && (keys.length !== 2 || !hasValue))
        ) {
          return Effect.fail(new ParseResult.Unexpected(encoded))
        }

        return errIsUnit
          ? Schema.decodeUnknownEffect(errSchema.schema)(undefined).pipe(
              Effect.mapError((error) => error.issue),
              Effect.map((decoded) => ({ err: decoded })),
            )
          : Schema.decodeUnknownEffect(errSchema.schema)(encoded.value).pipe(
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
        new ParseResult.Type(
          Schema.Unknown.ast,
          value,
          "Expected result envelope",
        ),
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
  const authoredTagByDecodeTag = new Map(
    variantEntries.flatMap(([tag]) => [
      [tag, tag] as const,
      [pascalCaseName(tag), tag] as const,
    ]),
  )
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
    const authoredTag = authoredTagByDecodeTag.get(tag)
    if (authoredTag === undefined) {
      return Effect.fail(new ParseResult.Unexpected(original))
    }

    const variant = variantByTag.get(authoredTag)
    if (variant === undefined) {
      return Effect.fail(new ParseResult.Unexpected(original))
    }

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

      if (typeof encoded.tag === "string" && Object.hasOwn(encoded, "tag")) {
        const authoredTag = authoredTagByDecodeTag.get(encoded.tag)
        if (authoredTag === undefined) {
          return Effect.fail(new ParseResult.Unexpected(encoded))
        }

        const keys = Object.keys(encoded)
        const hasValue = Object.hasOwn(encoded, "value")
        const unit = wireUnitTags.has(authoredTag)
        if (
          (unit &&
            !(
              (keys.length === 1 && !hasValue) ||
              (keys.length === 2 &&
                hasValue &&
                (encoded.value === undefined || isUnitWireValue(encoded.value)))
            )) ||
          (!unit && (keys.length !== 2 || !hasValue))
        ) {
          return Effect.fail(new ParseResult.Unexpected(encoded))
        }

        return decodeVariant(authoredTag, encoded.value, hasValue, encoded)
      }

      const entries = Object.entries(encoded)
      const entry = entries[0]
      if (entries.length !== 1 || entry === undefined) {
        return Effect.fail(new ParseResult.Unexpected(encoded))
      }

      return decodeVariant(entry[0], entry[1], true, encoded)
    },
    encode: (value) => {
      if (!isRecord(value) || typeof value.tag !== "string") {
        return Effect.fail(
          new ParseResult.Type(
            Schema.Unknown.ast,
            value,
            "Expected sum envelope",
          ),
        )
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

      if (isRecord(encoded) && Object.keys(encoded).length === 1) {
        if (Object.hasOwn(encoded, "none")) {
          return isUnitWireValue(encoded.none)
            ? Effect.void
            : Effect.fail(new ParseResult.Unexpected(encoded))
        }

        if (Object.hasOwn(encoded, "some")) {
          return Schema.decodeUnknownEffect(inner.schema)(encoded.some).pipe(
            Effect.mapError((error) => error.issue),
          )
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
): ParseResult.ParseIssue =>
  new ParseResult.Type(Schema.Unknown.ast, value, message)

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
): Schema.Codec<A, Encoded, never> => schema as Schema.Codec<A, Encoded, never>
