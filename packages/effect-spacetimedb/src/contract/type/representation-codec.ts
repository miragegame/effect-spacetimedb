import * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import {
  type AnyValueType,
  makeValueCodec,
  StdbValueCodecError,
  type ValueCodec,
} from "./core.ts"
import {
  decodeHostValue,
  encodeGeneratedClientValue,
  encodeHostValue,
} from "./host-codec.ts"
import { typeInfo } from "./metadata.ts"

export const codecFor = <A = unknown, Encoded = unknown>(
  value: AnyValueType,
): ValueCodec<A, Encoded> =>
  typeInfo<A, Encoded>(value)?.codec ??
  makeValueCodec(value.schema as Schema.Codec<A, Encoded, never>)

export const representationCodecFor = <A = unknown, Encoded = unknown>(
  value: AnyValueType,
  encodeValue: (value: AnyValueType, typedValue: A) => unknown,
): ValueCodec<A, Encoded> =>
  ({
    schema: value.schema as Schema.Codec<A, Encoded, never>,
    encode: (typedValue: A) =>
      Effect.try({
        try: () => encodeValue(value, typedValue) as Encoded,
        catch: (cause) => new StdbValueCodecError({ cause }),
      }),
    decode: (encodedValue: unknown) =>
      Effect.try({
        try: () => decodeHostValue<A>(value, encodedValue),
        catch: (cause) => new StdbValueCodecError({ cause }),
      }),
    encodeSync: (typedValue: A) => encodeValue(value, typedValue) as Encoded,
    decodeUnknownSync: (encodedValue: unknown) =>
      decodeHostValue<A>(value, encodedValue),
  }) satisfies ValueCodec<A, Encoded>

export const hostCodecFor = <A = unknown, Encoded = unknown>(
  value: AnyValueType,
): ValueCodec<A, Encoded> =>
  representationCodecFor<A, Encoded>(value, encodeHostValue)

export const generatedClientCodecFor = <A = unknown, Encoded = unknown>(
  value: AnyValueType,
): ValueCodec<A, Encoded> =>
  representationCodecFor<A, Encoded>(value, encodeGeneratedClientValue)

export const httpCodec = <A = unknown, Encoded = unknown>(
  value: AnyValueType,
): ValueCodec<A, Encoded> => codecFor(value)

export const wsCodec = <A = unknown, Encoded = unknown>(
  value: AnyValueType,
): ValueCodec<A, Encoded> => generatedClientCodecFor(value)

export const dbCodec = <A = unknown, Encoded = unknown>(
  value: AnyValueType,
): ValueCodec<A, Encoded> => hostCodecFor(value)
