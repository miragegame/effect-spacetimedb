import * as Effect from "effect/Effect"

import * as Schema from "effect/Schema"

import * as AST from "effect/SchemaAST"

import {
  annotateSchema,
  annotationInEncodedShape,
  StdbTypeAnnotationId,
  StdbTypeInfoAnnotationId,
} from "./schema-annotations.ts"

import {
  decodeHostValue,
  encodeGeneratedClientValue,
  encodeHostValue,
} from "./type/host-codec.ts"

import { isUnitValueType } from "./type-constructors.ts"

import {
  isValueType,
  makeValueCodec,
  makeValueType,
  StdbValueCodecError,
} from "./type-core.ts"

import { narrowSchema } from "./type-wire-schema.ts"

import type {
  AnyTypeBuilder,
  AnyValueType,
  BuilderFactories,
  StdbTypeFactory,
  TypeInfoOptions,
  TypeKind,
  ValueCodec,
  ValueType,
  ValueTypeInfo,
} from "./type-core.ts"

export const valueSchemaFromAst = (ast: AST.AST): AnyValueType =>
  makeValueType(narrowSchema<unknown, unknown>(Schema.make(ast)), "custom")

export const memoizeByFactories = <A>(
  evaluate: (factories: BuilderFactories, path?: string) => A,
): ((factories: BuilderFactories, path?: string) => A) => {
  const cache = new WeakMap<object, A>()
  return (factories, path) => {
    const cacheKey = factories as object
    const cached = cache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    const value = evaluate(factories, path)
    cache.set(cacheKey, value)
    return value
  }
}

export const constantFactory =
  <Builder extends AnyTypeBuilder>(
    builder: Builder,
  ): StdbTypeFactory<Builder> =>
  () =>
    builder

export const attachStdbType = <
  A,
  Encoded,
  Builder extends AnyTypeBuilder,
  Kind extends TypeKind,
>(
  schema: Schema.Codec<A, Encoded, never>,
  stdbType: Builder | StdbTypeFactory<Builder>,
  options: TypeInfoOptions & { readonly kind: Kind },
): ValueType<A, Encoded, Kind> =>
  (() => {
    const sats = memoizeByFactories(
      typeof stdbType === "function" ? stdbType : constantFactory(stdbType),
    )
    const typeAnnotatedSchema = annotateSchema(
      schema,
      StdbTypeAnnotationId,
      sats,
    )
    const codec = makeValueCodec(typeAnnotatedSchema)
    const info: ValueTypeInfo<A, Encoded> = {
      schema: typeAnnotatedSchema,
      kind: options.kind,
      sats,
      codec,
      ...(options.fields != null ? { fields: options.fields } : {}),
      ...(options.item != null ? { item: options.item } : {}),
      ...(options.members != null ? { members: options.members } : {}),
      ...(options.variants != null ? { variants: options.variants } : {}),
      ...(options.lazy != null ? { lazy: options.lazy } : {}),
      ...(options.values != null ? { values: options.values } : {}),
    }

    return makeValueType(
      annotateSchema(typeAnnotatedSchema, StdbTypeInfoAnnotationId, info),
      options.kind,
    )
  })()

export const typeInfo = <A = unknown, Encoded = unknown>(
  value: AnyValueType,
): ValueTypeInfo<A, Encoded> | undefined =>
  isValueType(value)
    ? annotationInEncodedShape<ValueTypeInfo<A, Encoded>>(
        StdbTypeInfoAnnotationId,
        value.schema.ast,
      )
    : undefined

export const hasTypeKind = <Kind extends TypeKind>(
  info: ValueTypeInfo | undefined,
  kind: Kind,
): info is ValueTypeInfo & { readonly kind: Kind } =>
  info !== undefined && info.kind === kind

export const supportsNativeColumnMetadata = (
  value: AnyValueType,
  seen = new WeakSet<object>(),
): boolean => {
  if (seen.has(value.schema.ast as object)) {
    return true
  }
  seen.add(value.schema.ast as object)

  const info = typeInfo(value)
  if (info == null) {
    return false
  }

  switch (info.kind) {
    case "custom":
    case "lazy": {
      const inner = info.item ?? info.lazy?.()
      return inner != null ? supportsNativeColumnMetadata(inner, seen) : false
    }
    case "unit":
      return false
    case "array":
    case "bigint":
    case "bool":
    case "bytes":
    case "connectionId":
    case "f32":
    case "f64":
    case "identity":
    case "i8":
    case "i16":
    case "i32":
    case "i64":
    case "i128":
    case "i256":
    case "literal":
    case "option":
    case "result":
    case "sum":
    case "scheduleAt":
    case "string":
    case "struct":
    case "timeDuration":
    case "timestamp":
    case "u8":
    case "u16":
    case "u32":
    case "u64":
    case "u128":
    case "u256":
    case "uuid":
      return true
    default:
      const _exhaustive: never = info.kind
      return _exhaustive
  }
}

export const supportsColumnDefault = (value: AnyValueType): boolean =>
  supportsNativeColumnMetadata(value)

export const supportsColumnName = (value: AnyValueType): boolean =>
  supportsNativeColumnMetadata(value)

export const AutoIncColumnKinds = new Set<TypeKind>([
  "i8",
  "i16",
  "i32",
  "i64",
  "i128",
  "i256",
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "u256",
])

export const PrimaryKeyColumnKinds = new Set<TypeKind>([
  ...AutoIncColumnKinds,
  "bigint",
  "bool",
  "connectionId",
  "identity",
  "string",
  "timeDuration",
  "timestamp",
  "uuid",
])

export const literalSupportsPrimaryKey = (
  values: ValueTypeInfo["values"] | undefined,
): boolean => {
  const first = values?.[0]
  if (first === undefined) {
    return false
  }

  // String literals lower to a native simple enum; boolean literals lower to
  // BoolBuilder. Numeric literals lower to F64Builder, which is not PK-able.
  return typeof first === "string" || typeof first === "boolean"
}

export const supportsPrimaryKey = (
  value: AnyValueType,
  seen = new WeakSet<object>(),
): boolean => {
  if (seen.has(value.schema.ast as object)) {
    return true
  }
  seen.add(value.schema.ast as object)

  const info = typeInfo(value)
  if (info == null) {
    return false
  }

  if (info.kind === "custom" || info.kind === "lazy") {
    const inner = info.item ?? info.lazy?.()
    return inner != null ? supportsPrimaryKey(inner, seen) : false
  }

  if (info.kind === "literal") {
    return literalSupportsPrimaryKey(info.values)
  }

  if (info.kind === "sum") {
    const variants = Object.values(info.variants ?? {})
    return variants.length > 0 && variants.every(isUnitValueType)
  }

  return PrimaryKeyColumnKinds.has(info.kind)
}

export const supportsAutoInc = (
  value: AnyValueType,
  seen = new WeakSet<object>(),
): boolean => {
  if (seen.has(value.schema.ast as object)) {
    return true
  }
  seen.add(value.schema.ast as object)

  const info = typeInfo(value)
  if (info == null) {
    return false
  }

  if (info.kind === "custom" || info.kind === "lazy") {
    const inner = info.item ?? info.lazy?.()
    return inner != null ? supportsAutoInc(inner, seen) : false
  }

  return AutoIncColumnKinds.has(info.kind)
}

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
