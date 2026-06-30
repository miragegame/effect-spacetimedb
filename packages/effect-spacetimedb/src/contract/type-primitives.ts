import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as ParseResult from "../schema-parse.ts"
import { transformOrFail } from "../schema-transform.ts"
import { makeStdbDiagnostic, StdbValidationError } from "./diagnostic.ts"
import {
  findInvalidStringLiteralTag,
  findStringLiteralTagCollision,
  invalidStringLiteralTagMessage,
  stringLiteralGeneratedClientTag,
  stringLiteralSatsVariantTag,
  stringLiteralTagCollisionMessage,
} from "./literal-tags.ts"

import {
  ConnectionId,
  I128Max,
  I128Min,
  I16Max,
  I16Min,
  I256Max,
  I256Min,
  I32Max,
  I32Min,
  I64Max,
  I64Min,
  I8Max,
  I8Min,
  Identity,
  TimeDuration,
  Timestamp,
  U128Max,
  U16Max,
  U256Max,
  U64Max,
  U8Max,
  Uuid,
} from "./type-core.ts"

import {
  contentAddressedSatsTypeBuilder,
  literalEnumFingerprint,
} from "./type-fingerprint.ts"

import { attachStdbType } from "./type-metadata.ts"

import { isRecord, isUnitWireValue, narrowSchema } from "./type-wire-schema.ts"

import type {
  BigIntValueType,
  BoolValueType,
  BuilderFactories,
  BytesValueType,
  ConnectionIdValue,
  F32ValueType,
  F64ValueType,
  I128ValueType,
  I16ValueType,
  I256ValueType,
  I32ValueType,
  I64ValueType,
  I8ValueType,
  IdentityValue,
  LiteralValueType,
  PrimitiveLiteral,
  ScheduleAtValue,
  StringLiteralEncoded,
  StringLiteralTuple,
  StringValueType,
  TimeDurationValue,
  TimestampValue,
  U128ValueType,
  U16ValueType,
  U256ValueType,
  U32ValueType,
  U64ValueType,
  U8ValueType,
  UuidValue,
  ValueType,
} from "./type-core.ts"

export const resolvePrimitiveSchema = <
  Base,
  BaseEncoded,
  A extends Base,
  Encoded,
>(
  domain: Schema.Codec<A, Encoded, never> | undefined,
  fallback: Schema.Codec<Base, BaseEncoded, never>,
): Schema.Codec<Base | A, BaseEncoded | Encoded, never> =>
  narrowSchema<Base | A, BaseEncoded | Encoded>(domain ?? fallback)

export const boundedBigIntSchema = <A extends bigint, Encoded extends bigint>(
  domain: Schema.Codec<A, Encoded, never, never> | undefined,
  min: bigint,
  max: bigint,
): Schema.Codec<bigint | A, bigint | Encoded, never, never> => {
  const wire = Schema.BigInt.check(
    Schema.isBetweenBigInt({ minimum: min, maximum: max }),
  )

  return narrowSchema<bigint | A, bigint | Encoded>(
    (domain != null
      ? wire
          .pipe(Schema.decodeTo(domain as Schema.Codec<A, bigint, never>))
          .check(Schema.isBetweenBigInt({ minimum: min, maximum: max }))
      : wire) as Schema.Codec<bigint | A, bigint | Encoded, never, never>,
  )
}

export const boundedNumberSchema = <A extends number, Encoded extends number>(
  domain: Schema.Codec<A, Encoded, never, never> | undefined,
  min: number,
  max: number,
): Schema.Codec<number | A, number | Encoded, never, never> => {
  const wire = Schema.Int.check(
    Schema.isBetween({ minimum: min, maximum: max }),
  )

  return narrowSchema<number | A, number | Encoded>(
    (domain != null
      ? wire
          .pipe(Schema.decodeTo(domain as Schema.Codec<A, number, never>))
          .check(
            Schema.isInt(),
            Schema.isBetween({ minimum: min, maximum: max }),
          )
      : wire) as Schema.Codec<number | A, number | Encoded, never, never>,
  )
}

export const isByteArrayInput = (
  value: unknown,
): value is ReadonlyArray<number> =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      typeof entry === "number" &&
      Number.isInteger(entry) &&
      entry >= 0 &&
      entry <= U8Max,
  )

export const bytesFromUnknown = narrowSchema<Uint8Array, Uint8Array>(
  transformOrFail(Schema.Unknown, Schema.Uint8Array, {
    strict: true,
    decode: (value) => {
      if (value instanceof Uint8Array) {
        return Effect.succeed(value)
      }

      if (isByteArrayInput(value)) {
        return Effect.succeed(Uint8Array.from(value))
      }

      if (typeof value === "string") {
        return Schema.decodeUnknownEffect(Schema.Uint8ArrayFromHex)(value).pipe(
          Effect.mapError((error) => error.issue),
        )
      }

      return Effect.fail(new ParseResult.Unexpected(value))
    },
    encode: (value) => Effect.succeed(value),
  }),
)

export const resolveLiteralBuilder = (
  factories: BuilderFactories,
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
):
  | ReturnType<BuilderFactories["string"]>
  | ReturnType<BuilderFactories["bool"]>
  | ReturnType<BuilderFactories["f64"]> => {
  // Keep this guard at the builder boundary as a fallback for literal metadata
  // reconstructed from annotated schemas instead of the public constructor.
  assertNumericLiteralPrecision(values)
  const first = values[0]
  const expectedType = typeof first

  if (values.some((value) => typeof value !== expectedType)) {
    throw new Error("Type.literal(...) must use a single primitive kind")
  }

  if (typeof first === "string") {
    return factories.string()
  }

  if (typeof first === "boolean") {
    return factories.bool()
  }

  return factories.f64()
}

export const NumericLiteralPrecisionMessage =
  "numeric literals lower to f64; non-finite values and unsafe integers cannot be represented safely - use a string literal or a bigint-backed column."

export const assertNumericLiteralPrecision = (
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
): void => {
  for (const value of values) {
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        (Number.isInteger(value) && Math.abs(value) > Number.MAX_SAFE_INTEGER))
    ) {
      throw new StdbValidationError({
        diagnostics: [
          makeStdbDiagnostic(
            "NumericLiteralPrecision",
            ["literal"],
            NumericLiteralPrecisionMessage,
          ),
        ],
      })
    }
  }
}

export const isStringLiteralTuple = (
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
): values is StringLiteralTuple =>
  values.every((value) => typeof value === "string")

export const assertUniqueStringLiteralVariantTags = <
  const Values extends StringLiteralTuple,
>(
  values: Values,
): void => {
  const invalid = findInvalidStringLiteralTag(values)
  if (invalid !== undefined) {
    throw new StdbValidationError({
      diagnostics: [
        makeStdbDiagnostic(
          "InvalidLiteralTag",
          ["literal"],
          invalidStringLiteralTagMessage(invalid),
        ),
      ],
    })
  }

  const collision = findStringLiteralTagCollision(values)
  if (collision !== undefined) {
    throw new StdbValidationError({
      diagnostics: [
        makeStdbDiagnostic(
          "LiteralTagCollision",
          ["literal"],
          stringLiteralTagCollisionMessage(collision),
        ),
      ],
    })
  }
}

export type StringLiteralEncodedWithOptionalValue<
  Values extends StringLiteralTuple,
> = StringLiteralEncoded<Values> & {
  readonly value?: unknown
}

export const stringLiteralEncodedSchema = <
  const Values extends StringLiteralTuple,
>(
  _values: Values,
): Schema.Codec<
  StringLiteralEncodedWithOptionalValue<Values>,
  { readonly tag: string; readonly value?: unknown },
  never
> =>
  narrowSchema<
    StringLiteralEncodedWithOptionalValue<Values>,
    { readonly tag: string; readonly value?: unknown }
  >(
    Schema.Struct({
      tag: Schema.String,
      value: Schema.optional(Schema.Unknown),
    }),
  )

export const stringLiteralSchema = <const Values extends StringLiteralTuple>(
  values: Values,
): LiteralValueType<Values> => {
  assertUniqueStringLiteralVariantTags(values)
  const tagToLiteral = new Map(
    values.flatMap((authored) => {
      const variantTag = stringLiteralSatsVariantTag(authored)
      const generatedClientTag = stringLiteralGeneratedClientTag(authored)

      return [
        [authored, authored] as const,
        [variantTag, authored] as const,
        [generatedClientTag, authored] as const,
      ]
    }),
  )
  const literalToTag = new Map(
    values.map(
      (authored) => [authored, stringLiteralSatsVariantTag(authored)] as const,
    ),
  )
  const schema = transformOrFail(
    stringLiteralEncodedSchema(values),
    Schema.Literals(values) as Schema.Codec<
      Values[number],
      Values[number],
      never,
      never
    >,
    {
      strict: true,
      decode: (value) => {
        const decoded = tagToLiteral.get(value.tag)

        if (decoded === undefined) {
          return Effect.fail(new ParseResult.Unexpected(value))
        }

        if (
          Object.hasOwn(value, "value") &&
          value.value !== undefined &&
          !isUnitWireValue(value.value)
        ) {
          return Effect.fail(new ParseResult.Unexpected(value))
        }

        return Effect.succeed(decoded)
      },
      encode: (value) => {
        const variantTag = literalToTag.get(value)

        return variantTag != null && variantTag !== ""
          ? Effect.succeed({
              tag: variantTag,
            } as StringLiteralEncoded<Values>)
          : Effect.fail(new ParseResult.Unexpected(value))
      },
    },
  )

  const variantTags = values.map(stringLiteralSatsVariantTag) as [
    string,
    ...string[],
  ]
  const fingerprint = literalEnumFingerprint(variantTags)

  // Preserve authored literals as SATS tags when they are valid identifiers; otherwise
  // fall back to the generated-client-safe tag SpaceTimeDB can expose.
  return attachStdbType(
    schema,
    (factories) =>
      contentAddressedSatsTypeBuilder(factories, "Enum", fingerprint, (name) =>
        factories.enum(name, variantTags),
      ),
    { kind: "literal", values },
  ) as unknown as LiteralValueType<Values>
}

export const nativeValueSchema = <A>(
  decode: (value: unknown) => A | undefined,
): Schema.Codec<A, unknown, never> =>
  narrowSchema<A, unknown>(
    transformOrFail(Schema.Unknown, Schema.Unknown, {
      strict: true,
      decode: (value) => {
        const decoded = decode(value)
        return decoded === undefined
          ? Effect.fail(new ParseResult.Unexpected(value))
          : Effect.succeed(decoded)
      },
      encode: (value) => Effect.succeed(value),
    }),
  )

export const rawBigIntField = (
  value: unknown,
  field: string,
): bigint | undefined =>
  isRecord(value) && typeof value[field] === "bigint" ? value[field] : undefined

export const SelfUuid = nativeValueSchema<UuidValue>((value) => {
  if (value instanceof Uuid) {
    return value
  }
  const raw = rawBigIntField(value, "__uuid__")
  return raw === undefined ? undefined : new Uuid(raw)
})

export const SelfIdentity = nativeValueSchema<IdentityValue>((value) => {
  if (value instanceof Identity) {
    return value
  }
  const raw = rawBigIntField(value, "__identity__")
  return raw === undefined ? undefined : new Identity(raw)
})

export const SelfConnectionId = nativeValueSchema<ConnectionIdValue>(
  (value) => {
    if (value instanceof ConnectionId) {
      return value
    }
    const raw = rawBigIntField(value, "__connection_id__")
    return raw === undefined ? undefined : new ConnectionId(raw)
  },
)

export const SelfTimestamp = nativeValueSchema<TimestampValue>((value) => {
  if (value instanceof Timestamp) {
    return value
  }
  const raw = rawBigIntField(value, "__timestamp_micros_since_unix_epoch__")
  return raw === undefined ? undefined : new Timestamp(raw)
})

export const SelfTimeDuration = nativeValueSchema<TimeDurationValue>(
  (value) => {
    if (value instanceof TimeDuration) {
      return value
    }
    const raw = rawBigIntField(value, "__time_duration_micros__")
    return raw === undefined ? undefined : new TimeDuration(raw)
  },
)

export const SelfScheduleAt = narrowSchema<ScheduleAtValue, unknown>(
  Schema.Union([
    Schema.Struct({
      tag: Schema.Literal("Interval"),
      value: SelfTimeDuration,
    }),
    Schema.Struct({
      tag: Schema.Literal("Time"),
      value: SelfTimestamp,
    }),
  ]),
)

export function string(): StringValueType

export function string<A extends string, Encoded extends string>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function string<A extends string, Encoded extends string>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<string | A, string | Encoded> {
  const schema = resolvePrimitiveSchema(domain, Schema.String)

  return attachStdbType(schema, (factories) => factories.string(), {
    kind: "string",
  })
}

export function bool(): BoolValueType

export function bool<A extends boolean, Encoded extends boolean>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function bool<A extends boolean, Encoded extends boolean>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<boolean | A, boolean | Encoded> {
  const schema = resolvePrimitiveSchema(domain, Schema.Boolean)

  return attachStdbType(schema, (factories) => factories.bool(), {
    kind: "bool",
  })
}

export function u8(): U8ValueType

export function u8<A extends number, Encoded extends number>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function u8<A extends number, Encoded extends number>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<number | A, number | Encoded> {
  const schema = boundedNumberSchema(domain, 0, U8Max)

  return attachStdbType(schema, (factories) => factories.u8(), {
    kind: "u8",
  })
}

export function u16(): U16ValueType

export function u16<A extends number, Encoded extends number>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function u16<A extends number, Encoded extends number>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<number | A, number | Encoded> {
  const schema = boundedNumberSchema(domain, 0, U16Max)

  return attachStdbType(schema, (factories) => factories.u16(), {
    kind: "u16",
  })
}

export function i8(): I8ValueType

export function i8<A extends number, Encoded extends number>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function i8<A extends number, Encoded extends number>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<number | A, number | Encoded> {
  const schema = boundedNumberSchema(domain, I8Min, I8Max)

  return attachStdbType(schema, (factories) => factories.i8(), {
    kind: "i8",
  })
}

export function i16(): I16ValueType

export function i16<A extends number, Encoded extends number>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function i16<A extends number, Encoded extends number>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<number | A, number | Encoded> {
  const schema = boundedNumberSchema(domain, I16Min, I16Max)

  return attachStdbType(schema, (factories) => factories.i16(), {
    kind: "i16",
  })
}

export function i32(): I32ValueType

export function i32<A extends number, Encoded extends number>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function i32<A extends number, Encoded extends number>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<number | A, number | Encoded> {
  const schema = boundedNumberSchema(domain, I32Min, I32Max)

  return attachStdbType(schema, (factories) => factories.i32(), {
    kind: "i32",
  })
}

export function f32(): F32ValueType

export function f32<A extends number, Encoded extends number>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function f32<A extends number, Encoded extends number>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<number | A, number | Encoded> {
  // @effect-diagnostics-next-line schemaNumber:off -- SpaceTimeDB f32 values preserve native float NaN/Infinity; HTTP JSON rejects non-finite at encoding.
  const schema = resolvePrimitiveSchema(domain, Schema.Number)

  return attachStdbType(schema, (factories) => factories.f32(), {
    kind: "f32",
  })
}

export function f64(): F64ValueType

export function f64<A extends number, Encoded extends number>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function f64<A extends number, Encoded extends number>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<number | A, number | Encoded> {
  // @effect-diagnostics-next-line schemaNumber:off -- SpaceTimeDB f64 values preserve native float NaN/Infinity; HTTP JSON rejects non-finite at encoding.
  const schema = resolvePrimitiveSchema(domain, Schema.Number)

  return attachStdbType(schema, (factories) => factories.f64(), {
    kind: "f64",
  })
}

export function u32(): U32ValueType

export function u32<A extends number, Encoded extends number>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function u32<A extends number, Encoded extends number>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<number | A, number | Encoded> {
  const schema = boundedNumberSchema(domain, 0, 0xffffffff)

  return attachStdbType(schema, (factories) => factories.u32(), {
    kind: "u32",
  })
}

export function u64(): U64ValueType

export function u64<A extends bigint, Encoded extends bigint>(
  domain: Schema.Codec<A, Encoded, never, never>,
): U64ValueType<A, Encoded>

export function u64<A extends bigint, Encoded extends bigint>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<bigint | A, bigint | Encoded, "u64"> {
  const schema = boundedBigIntSchema(domain, 0n, U64Max)

  return attachStdbType(schema, (factories) => factories.u64(), {
    kind: "u64",
  })
}

export function i64(): I64ValueType

export function i64<A extends bigint, Encoded extends bigint>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function i64<A extends bigint, Encoded extends bigint>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<bigint | A, bigint | Encoded> {
  const schema = boundedBigIntSchema(domain, I64Min, I64Max)

  return attachStdbType(schema, (factories) => factories.i64(), {
    kind: "i64",
  })
}

export function u128(): U128ValueType

export function u128<A extends bigint, Encoded extends bigint>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function u128<A extends bigint, Encoded extends bigint>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<bigint | A, bigint | Encoded> {
  const schema = boundedBigIntSchema(domain, 0n, U128Max)

  return attachStdbType(schema, (factories) => factories.u128(), {
    kind: "u128",
  })
}

export function i128(): I128ValueType

export function i128<A extends bigint, Encoded extends bigint>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function i128<A extends bigint, Encoded extends bigint>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<bigint | A, bigint | Encoded> {
  const schema = boundedBigIntSchema(domain, I128Min, I128Max)

  return attachStdbType(schema, (factories) => factories.i128(), {
    kind: "i128",
  })
}

export function u256(): U256ValueType

export function u256<A extends bigint, Encoded extends bigint>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function u256<A extends bigint, Encoded extends bigint>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<bigint | A, bigint | Encoded> {
  const schema = boundedBigIntSchema(domain, 0n, U256Max)

  return attachStdbType(schema, (factories) => factories.u256(), {
    kind: "u256",
  })
}

export function i256(): I256ValueType

export function i256<A extends bigint, Encoded extends bigint>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function i256<A extends bigint, Encoded extends bigint>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<bigint | A, bigint | Encoded> {
  const schema = boundedBigIntSchema(domain, I256Min, I256Max)

  return attachStdbType(schema, (factories) => factories.i256(), {
    kind: "i256",
  })
}

export function bytes(): BytesValueType

export function bytes<A extends Uint8Array, Encoded extends Uint8Array>(
  domain: Schema.Codec<A, Encoded, never, never>,
): ValueType<A, Encoded>

export function bytes<A extends Uint8Array, Encoded extends Uint8Array>(
  domain?: Schema.Codec<A, Encoded, never, never>,
): ValueType<Uint8Array | A, Uint8Array | Encoded> {
  const schema = resolvePrimitiveSchema(domain, bytesFromUnknown)

  return attachStdbType(schema, (factories) => factories.byteArray(), {
    kind: "bytes",
  })
}

export function bigint(): BigIntValueType<"bigint", string>

export function bigint<A extends bigint>(
  domain: Schema.Codec<A, bigint, never, never>,
): ValueType<A, string, "bigint">

export function bigint<A extends bigint>(
  domain?: Schema.Codec<A, bigint, never, never>,
): ValueType<bigint | A, string, "bigint"> {
  const schema = narrowSchema<bigint | A, string>(
    domain != null
      ? Schema.BigIntFromString.pipe(Schema.decodeTo(domain))
      : Schema.BigIntFromString,
  )

  return attachStdbType(schema, (factories) => factories.string(), {
    kind: "bigint",
  })
}

export function uuid(): ValueType<UuidValue, unknown> {
  return attachStdbType(SelfUuid, (factories) => factories.uuid(), {
    kind: "uuid",
  })
}

export function identity(): ValueType<IdentityValue, unknown> {
  return attachStdbType(SelfIdentity, (factories) => factories.identity(), {
    kind: "identity",
  })
}

export function connectionId(): ValueType<ConnectionIdValue, unknown> {
  return attachStdbType(
    SelfConnectionId,
    (factories) => factories.connectionId(),
    {
      kind: "connectionId",
    },
  )
}

export function timestamp(): ValueType<TimestampValue, unknown> {
  return attachStdbType(SelfTimestamp, (factories) => factories.timestamp(), {
    kind: "timestamp",
  })
}

export function scheduleAt(): ValueType<ScheduleAtValue, unknown> {
  return attachStdbType(SelfScheduleAt, (factories) => factories.scheduleAt(), {
    kind: "scheduleAt",
  })
}

export function timeDuration(): ValueType<TimeDurationValue, unknown> {
  return attachStdbType(
    SelfTimeDuration,
    (factories) => factories.timeDuration(),
    {
      kind: "timeDuration",
    },
  )
}
