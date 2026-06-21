import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as AST from "effect/SchemaAST"
import * as SpacetimeDB from "spacetimedb"
import * as ParseResult from "../compat/parse-result.ts"
import { transformOrFail } from "../compat/schema-transform.ts"
import { typedFromEntries } from "../utils.ts"
import { pascalCaseName } from "./canonical-name.ts"
import { makeStdbDiagnostic, StdbValidationError } from "./diagnostic.ts"
import type {
  AnyNormalizedFieldOptions,
  FieldOptions as TableFieldOptions,
  FieldType as TableFieldType,
} from "./field.ts"
import type { IndexAlgorithm } from "./index.ts"
import {
  findInvalidStringLiteralTag,
  findStringLiteralTagCollision,
  invalidStringLiteralTagMessage,
  stringLiteralGeneratedClientTag,
  stringLiteralSatsVariantTag,
  stringLiteralTagCollisionMessage,
} from "./literal-tags.ts"
import {
  annotateSchema,
  annotationInEncodedShape,
  encodedAst,
  StdbFieldOptionsAnnotationId,
  StdbTypeAnnotationId,
  StdbTypeInfoAnnotationId,
} from "./schema-annotations.ts"
import {
  decodeHostValue,
  encodeGeneratedClientValue,
  encodeHostValue,
} from "./type/host-codec.ts"
import {
  arrayFingerprint,
  contentAddressedName,
  enumFingerprint,
  optionFingerprint,
  primitiveFingerprint,
  productFingerprint,
  recursiveFingerprint,
  type SatsTypeNameKind,
  sumFingerprint,
} from "./type/name.ts"

const { ConnectionId, Identity, TimeDuration, Timestamp, Uuid } = SpacetimeDB

type AnyTypeBuilder = {
  readonly type: unknown
  readonly algebraicType: {
    readonly tag: string
    readonly value?: unknown
  }
  readonly optional: () => unknown
  readonly serialize: (value: unknown) => unknown
  readonly deserialize: (value: unknown) => unknown
}
type BuilderFactories = {
  readonly lazy: (builder: () => AnyTypeBuilder) => AnyTypeBuilder
  readonly string: () => AnyTypeBuilder
  readonly bool: () => AnyTypeBuilder
  readonly i8: () => AnyTypeBuilder
  readonly u8: () => AnyTypeBuilder
  readonly i16: () => AnyTypeBuilder
  readonly u16: () => AnyTypeBuilder
  readonly i32: () => AnyTypeBuilder
  readonly f64: () => AnyTypeBuilder
  readonly f32: () => AnyTypeBuilder
  readonly u32: () => AnyTypeBuilder
  readonly i64: () => AnyTypeBuilder
  readonly u64: () => AnyTypeBuilder
  readonly i128: () => AnyTypeBuilder
  readonly u128: () => AnyTypeBuilder
  readonly i256: () => AnyTypeBuilder
  readonly u256: () => AnyTypeBuilder
  readonly byteArray: () => AnyTypeBuilder
  readonly uuid: () => AnyTypeBuilder
  readonly identity: () => AnyTypeBuilder
  readonly connectionId: () => AnyTypeBuilder
  readonly timestamp: () => AnyTypeBuilder
  readonly scheduleAt: () => AnyTypeBuilder
  readonly timeDuration: () => AnyTypeBuilder
  readonly unit: () => AnyTypeBuilder
  readonly option: (builder: AnyTypeBuilder) => AnyTypeBuilder
  readonly result: (ok: AnyTypeBuilder, err: AnyTypeBuilder) => AnyTypeBuilder
  readonly array: (builder: AnyTypeBuilder) => AnyTypeBuilder
  readonly object: (
    name: string,
    fields: Record<string, AnyTypeBuilder>,
  ) => AnyTypeBuilder
  readonly enum: (
    name: string,
    variants:
      | Record<string, AnyTypeBuilder>
      | readonly [string, ...ReadonlyArray<string>],
  ) => AnyTypeBuilder
}
type StdbTypeFactory<Builder extends AnyTypeBuilder = AnyTypeBuilder> = (
  factories: BuilderFactories,
  path?: string,
) => Builder
type ConnectionIdValue = SpacetimeDB.ConnectionId
type IdentityValue = SpacetimeDB.Identity
type ScheduleAtValue = SpacetimeDB.ScheduleAt
type TimeDurationValue = SpacetimeDB.TimeDuration
type TimestampValue = SpacetimeDB.Timestamp
type UuidValue = SpacetimeDB.Uuid
type PrimitiveLiteral = string | number | boolean
type StringLiteralTuple = readonly [string, ...string[]]
type StringLiteralEncoded<Values extends StringLiteralTuple> = {
  readonly [Value in Values[number]]: { readonly tag: string }
}[Values[number]]
type LiteralEncoded<
  Values extends readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
> = Values extends StringLiteralTuple
  ? StringLiteralEncoded<Values>
  : Values[number]

const StructTypeId = "__effectSpacetimeDbStructType" as const
const StructFieldTypeId = "__effectSpacetimeDbStructFieldType" as const
const StdbValueTypeId: unique symbol = Symbol.for(
  "effect-spacetimedb/StdbValueType",
) as never
const I8Min = -0x80
const I8Max = 0x7f
const U8Max = 0xff
const I16Min = -0x8000
const I16Max = 0x7fff
const U16Max = 0xffff
const I32Min = -(2 ** 31)
const I32Max = 2 ** 31 - 1
const I64Min = -(1n << 63n)
const I64Max = (1n << 63n) - 1n
const U64Max = (1n << 64n) - 1n
const I128Min = -(1n << 127n)
const I128Max = (1n << 127n) - 1n
const U128Max = (1n << 128n) - 1n
const I256Min = -(1n << 255n)
const I256Max = (1n << 255n) - 1n
const U256Max = (1n << 256n) - 1n

export interface StdbValueType<
  out A,
  out Encoded = A,
  out Kind extends TypeKind = TypeKind,
> {
  readonly [StdbValueTypeId]: Kind
  readonly schema: Schema.Codec<A, Encoded, never, never>
  readonly Type: A
  readonly Encoded: Encoded
  readonly primaryKey: <Self extends AnyValueType>(
    this: Self,
  ) => TableFieldType<
    Self,
    MergeTableFieldOptions<
      TableFieldOptionsOfValue<Self>,
      { readonly primaryKey: true }
    >
  >
  readonly autoInc: <Self extends AnyValueType>(
    this: Self,
  ) => TableFieldType<
    Self,
    MergeTableFieldOptions<
      TableFieldOptionsOfValue<Self>,
      { readonly autoInc: true }
    >
  >
  readonly unique: <Self extends AnyValueType>(
    this: Self,
  ) => TableFieldType<
    Self,
    MergeTableFieldOptions<
      TableFieldOptionsOfValue<Self>,
      { readonly unique: true }
    >
  >
  readonly index: <
    Self extends AnyValueType,
    const Algorithm extends IndexAlgorithm = "btree",
  >(
    this: Self,
    algorithm?: Algorithm,
  ) => TableFieldType<
    Self,
    MergeTableFieldOptions<
      TableFieldOptionsOfValue<Self>,
      { readonly index: Algorithm }
    >
  >
  readonly optional: <Self extends AnyValueType>(
    this: Self,
  ) => TableFieldType<
    Self,
    MergeTableFieldOptions<
      TableFieldOptionsOfValue<Self>,
      { readonly optional: true }
    >
  >
  readonly default: <
    Self extends AnyValueType,
    const Value extends TypeOf<Self>,
  >(
    this: Self,
    value: Value,
  ) => TableFieldType<
    Self,
    MergeTableFieldOptions<
      TableFieldOptionsOfValue<Self>,
      { readonly default: Value }
    >
  >
  readonly name: <Self extends AnyValueType, const Name extends string>(
    this: Self,
    dbName: Name,
  ) => TableFieldType<
    Self,
    MergeTableFieldOptions<
      TableFieldOptionsOfValue<Self>,
      { readonly name: Name }
    >
  >
}

export type ValueType<
  A,
  Encoded = A,
  Kind extends TypeKind = TypeKind,
> = StdbValueType<A, Encoded, Kind>

export type AnyValueType = StdbValueType<unknown, unknown>

export type StringValueType = ValueType<string, string, "string">

export type BoolValueType = ValueType<boolean, boolean, "bool">

export type NumberValueType<Kind extends TypeKind = TypeKind> = ValueType<
  number,
  number,
  Kind
>

export type BigIntValueType<
  Kind extends TypeKind = TypeKind,
  Encoded extends bigint | string = bigint,
> = ValueType<bigint, Encoded, Kind>

export type BytesValueType = ValueType<Uint8Array, Uint8Array, "bytes">
export type U8ValueType = NumberValueType<"u8">
export type U16ValueType = NumberValueType<"u16">
export type U32ValueType = NumberValueType<"u32">
export type I8ValueType = NumberValueType<"i8">
export type I16ValueType = NumberValueType<"i16">
export type I32ValueType = NumberValueType<"i32">
export type F32ValueType = NumberValueType<"f32">
export type F64ValueType = NumberValueType<"f64">
export type U64ValueType<
  A extends bigint = bigint,
  Encoded extends bigint = bigint,
> = ValueType<A, Encoded, "u64">
export type I64ValueType = BigIntValueType<"i64">
export type U128ValueType = BigIntValueType<"u128">
export type I128ValueType = BigIntValueType<"i128">
export type U256ValueType = BigIntValueType<"u256">
export type I256ValueType = BigIntValueType<"i256">

export type Type<Value extends AnyValueType> = Value["Type"]

export type Encoded<Value extends AnyValueType> = Value["Encoded"]

export type TypeOf<Value extends AnyValueType> = Type<Value>

export type EncodedOf<Value extends AnyValueType> = Encoded<Value>

type TableFieldOptionsOfValue<Value extends AnyValueType> =
  Value extends TableFieldType<
    AnyValueType,
    infer Options extends TableFieldOptions
  >
    ? Options
    : {}

type MergeTableFieldOptions<
  Current extends TableFieldOptions,
  Next extends TableFieldOptions,
> = Omit<Current, keyof Next> & Next

export type StructFields = Readonly<Record<string, AnyValueType>>

export type StructFieldOptions = {
  readonly optional?: true
}

type NormalizedStructFieldOptions<
  Options extends StructFieldOptions = StructFieldOptions,
> = {
  readonly optional: Options["optional"] extends true ? true : false
}

type AnyNormalizedStructFieldOptions = {
  readonly optional: boolean
}

export type StructValueType<Fields extends StructFields = StructFields> =
  ValueType<StructType<Fields>, unknown> & {
    readonly [StructTypeId]: Fields
  }

export type StructLikeValueType = AnyValueType & {
  readonly [StructTypeId]: StructFields
}

export type StructFieldsOf<Value extends StructLikeValueType> = Value extends {
  readonly [StructTypeId]: infer Fields extends StructFields
}
  ? Fields
  : never

export type StructFieldType<
  Value extends AnyValueType = AnyValueType,
  Options extends StructFieldOptions = StructFieldOptions,
> = Value & {
  readonly [StructFieldTypeId]: NormalizedStructFieldOptions<Options>
}

export type ArrayValueType<Inner extends AnyValueType = AnyValueType> =
  ValueType<ReadonlyArray<TypeOf<Inner>>, ReadonlyArray<EncodedOf<Inner>>>

export type LiteralValueType<
  Values extends readonly [PrimitiveLiteral, ...PrimitiveLiteral[]] = readonly [
    string | number | boolean,
    ...(string | number | boolean)[],
  ],
> = ValueType<Values[number], LiteralEncoded<Values>>

export type OptionValueType<Inner extends AnyValueType = AnyValueType> =
  ValueType<TypeOf<Inner> | undefined, OptionWire<Inner>>

export type LazyValueType<A, Encoded> = ValueType<A, Encoded>

export type UnitValueType = ValueType<void, void>

export type ResultValueType<
  Ok extends AnyValueType = AnyValueType,
  Err extends AnyValueType = AnyValueType,
> = ValueType<ResultType<Ok, Err>, unknown>

export type SumVariants = Readonly<Record<string, AnyValueType>>

type IsUnit<Value extends AnyValueType> = [TypeOf<Value>] extends [void]
  ? true
  : false

type SumVariantConstructors<Variants extends SumVariants> = {
  readonly [Tag in keyof Variants & string]: IsUnit<Variants[Tag]> extends true
    ? Extract<SumType<Variants>, { readonly tag: Tag }>
    : (
        value: TypeOf<Variants[Tag]>,
      ) => Extract<SumType<Variants>, { readonly tag: Tag }>
}

export type SumValueType<Variants extends SumVariants = SumVariants> =
  ValueType<SumType<Variants>, SumWire<Variants>> & {
    readonly make: SumVariantConstructors<Variants>
  }

export type TypeKind =
  | "array"
  | "bigint"
  | "bool"
  | "bytes"
  | "connectionId"
  | "custom"
  | "f32"
  | "f64"
  | "identity"
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "i128"
  | "i256"
  | "lazy"
  | "literal"
  | "option"
  | "result"
  | "scheduleAt"
  | "string"
  | "struct"
  | "sum"
  | "timeDuration"
  | "timestamp"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "u128"
  | "u256"
  | "unit"
  | "uuid"

export class StdbValueCodecError extends Data.TaggedError(
  "StdbValueCodecError",
)<{
  readonly cause: unknown
}> {}

export type ValueCodec<A, Encoded> = {
  readonly schema: Schema.Codec<A, Encoded, never>
  readonly encode: (value: A) => Effect.Effect<Encoded, StdbValueCodecError>
  readonly decode: (value: unknown) => Effect.Effect<A, StdbValueCodecError>
  readonly encodeSync: (value: A) => Encoded
  readonly decodeUnknownSync: (value: unknown) => A
}

export type ValueTypeInfo<A = unknown, Encoded = unknown> = {
  readonly schema: Schema.Codec<A, Encoded, never>
  readonly kind: TypeKind
  readonly sats: StdbTypeFactory
  readonly codec: ValueCodec<A, Encoded>
  readonly fields?: StructFields
  readonly item?: AnyValueType
  readonly members?: ReadonlyArray<AnyValueType>
  readonly variants?: SumVariants
  readonly lazy?: () => AnyValueType
  readonly values?: readonly [
    string | number | boolean,
    ...(string | number | boolean)[],
  ]
}

type TypeInfoOptions = {
  readonly kind: TypeKind
  readonly fields?: StructFields
  readonly item?: AnyValueType
  readonly members?: ReadonlyArray<AnyValueType>
  readonly variants?: SumVariants
  readonly lazy?: () => AnyValueType
  readonly values?: readonly [
    string | number | boolean,
    ...(string | number | boolean)[],
  ]
}

const makeValueCodec = <A, Encoded>(
  schema: Schema.Codec<A, Encoded, never>,
): ValueCodec<A, Encoded> => ({
  schema,
  encode: (value) =>
    Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError((cause) => new StdbValueCodecError({ cause })),
    ),
  decode: (value) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((cause) => new StdbValueCodecError({ cause })),
    ),
  encodeSync: Schema.encodeSync(schema),
  decodeUnknownSync: Schema.decodeUnknownSync(schema),
})

type ResolvedTableFieldOptions = AnyNormalizedFieldOptions

const DefaultTableFieldOptions: ResolvedTableFieldOptions = {
  primaryKey: false,
  autoInc: false,
  unique: false,
  index: undefined,
  optional: false,
  hasDefault: false,
  defaultValue: undefined,
  name: undefined,
}

export const fieldOptionsObject = (
  options: AnyNormalizedFieldOptions,
): TableFieldOptions => ({
  ...(options.primaryKey ? { primaryKey: true as const } : {}),
  ...(options.autoInc ? { autoInc: true as const } : {}),
  ...(options.unique ? { unique: true as const } : {}),
  ...(options.index !== undefined ? { index: options.index } : {}),
  ...(options.optional ? { optional: true as const } : {}),
  ...(options.hasDefault ? { default: options.defaultValue } : {}),
  ...(options.name !== undefined ? { name: options.name } : {}),
})

export const tableFieldOptions = (
  value: AnyValueType,
): ResolvedTableFieldOptions => {
  const annotation =
    annotationInEncodedShape<Partial<ResolvedTableFieldOptions>>(
      StdbFieldOptionsAnnotationId,
      value.schema.ast,
    ) ?? {}
  const index = Match.value(annotation.index).pipe(
    Match.when("btree", () => "btree" as const),
    Match.when("hash", () => "hash" as const),
    Match.when("direct", () => "direct" as const),
    Match.when(undefined, () => undefined),
    Match.exhaustive,
  )

  return {
    ...DefaultTableFieldOptions,
    ...annotation,
    index,
    unique: annotation.unique === true,
    hasDefault: annotation.hasDefault === true,
  }
}

export const applyFieldOptions = <
  Type extends AnyValueType,
  const Options extends TableFieldOptions<TypeOf<Type>> = {},
>(
  type: Type,
  options?: Options,
): TableFieldType<Type, Options> => {
  const hasDefault = options != null ? Object.hasOwn(options, "default") : false

  if (options?.optional === true && options.primaryKey === true) {
    throw new Error("A field cannot be both optional and a primary key")
  }

  if (options?.autoInc === true && options.primaryKey !== true) {
    throw new Error("autoInc fields must also be primary keys")
  }

  if (
    hasDefault &&
    (options?.primaryKey === true || options?.autoInc === true)
  ) {
    throw new Error(
      "A field default cannot be combined with primaryKey or autoInc",
    )
  }

  if (options?.name !== undefined && options.name.length === 0) {
    throw new Error("A field database name cannot be empty")
  }

  if (options?.name !== undefined && options.name.trim().length === 0) {
    throw new Error("A field database name cannot be blank")
  }

  if (hasDefault && !supportsColumnDefault(type)) {
    throw new Error(
      "A field default is not supported for this SpaceTimeDB column type",
    )
  }

  if (options?.primaryKey === true && !supportsPrimaryKey(type)) {
    throw new Error(
      "A primary key is not supported for this SpaceTimeDB column type",
    )
  }

  if (options?.autoInc === true && !supportsAutoInc(type)) {
    throw new Error("autoInc is not supported for this SpaceTimeDB column type")
  }

  if (options?.name !== undefined && !supportsColumnName(type)) {
    throw new Error(
      "A field database name is not supported for this SpaceTimeDB column type",
    )
  }

  return annotateValueTypeSchema(type, StdbFieldOptionsAnnotationId, {
    primaryKey: options?.primaryKey === true,
    autoInc: options?.autoInc === true,
    unique: options?.unique === true,
    index: options?.index,
    optional: options?.optional === true,
    hasDefault,
    defaultValue: options?.default,
    name: options?.name,
  }) as TableFieldType<Type, Options>
}

const mergeFieldOptions = <
  Type extends AnyValueType,
  const Options extends TableFieldOptions<TypeOf<Type>>,
>(
  type: Type,
  options: Options,
): TableFieldType<
  Type,
  MergeTableFieldOptions<TableFieldOptionsOfValue<Type>, Options>
> =>
  applyFieldOptions(type, {
    ...fieldOptionsObject(tableFieldOptions(type)),
    ...options,
  }) as TableFieldType<
    Type,
    MergeTableFieldOptions<TableFieldOptionsOfValue<Type>, Options>
  >

function indexField<Type extends AnyValueType>(
  this: Type,
): TableFieldType<
  Type,
  MergeTableFieldOptions<
    TableFieldOptionsOfValue<Type>,
    { readonly index: "btree" }
  >
>
function indexField<
  Type extends AnyValueType,
  const Algorithm extends IndexAlgorithm,
>(
  this: Type,
  algorithm: Algorithm,
): TableFieldType<
  Type,
  MergeTableFieldOptions<
    TableFieldOptionsOfValue<Type>,
    { readonly index: Algorithm }
  >
>
function indexField<Type extends AnyValueType>(
  this: Type,
  algorithm: IndexAlgorithm = "btree",
) {
  return mergeFieldOptions(this, { index: algorithm })
}

const fieldChainMethods = {
  primaryKey<Type extends AnyValueType>(this: Type) {
    return mergeFieldOptions(this, { primaryKey: true as const })
  },
  autoInc<Type extends AnyValueType>(this: Type) {
    return mergeFieldOptions(this, { autoInc: true as const })
  },
  unique<Type extends AnyValueType>(this: Type) {
    return mergeFieldOptions(this, { unique: true as const })
  },
  index: indexField,
  optional<Type extends AnyValueType>(this: Type) {
    return mergeFieldOptions(this, { optional: true as const })
  },
  default<Type extends AnyValueType>(this: Type, value: TypeOf<Type>) {
    return mergeFieldOptions(this, { default: value })
  },
  name<Type extends AnyValueType>(this: Type, dbName: string) {
    return mergeFieldOptions(this, { name: dbName })
  },
}

const makeValueType = <A, Encoded, Kind extends TypeKind>(
  schema: Schema.Codec<A, Encoded, never, never>,
  kind: Kind,
): ValueType<A, Encoded, Kind> =>
  ({
    [StdbValueTypeId]: kind,
    schema,
    ...fieldChainMethods,
  }) as ValueType<A, Encoded, Kind>

const valueTypeCoreKeys = new Set<PropertyKey>([
  StdbValueTypeId,
  "schema",
  ...Object.keys(fieldChainMethods),
])

const preserveValueTypeExtensions = <Value extends AnyValueType>(
  source: Value,
  target: AnyValueType,
): Value => {
  for (const key of Reflect.ownKeys(source)) {
    if (valueTypeCoreKeys.has(key)) continue
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (descriptor !== undefined) {
      Object.defineProperty(target, key, descriptor)
    }
  }

  return target as Value
}

const isValueType = (value: unknown): value is AnyValueType =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  StdbValueTypeId in value &&
  "schema" in value &&
  typeof (value as { readonly schema?: unknown }).schema === "object" &&
  (value as { readonly schema?: { readonly ast?: unknown } }).schema?.ast !==
    undefined

export const annotateValueTypeSchema = <Value extends AnyValueType>(
  value: Value,
  annotationId: symbol,
  annotation: unknown,
): Value =>
  preserveValueTypeExtensions(
    value,
    makeValueType(
      annotateSchema(value.schema, annotationId, annotation),
      value[StdbValueTypeId],
    ),
  )

type OptionalStructField<Field extends AnyValueType> =
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

type OptionalKeys<Fields extends StructFields> = {
  readonly [K in keyof Fields]-?: OptionalStructField<Fields[K]> extends true
    ? K
    : never
}[keyof Fields]

type RequiredKeys<Fields extends StructFields> = Exclude<
  keyof Fields,
  OptionalKeys<Fields>
>

type StructType<Fields extends StructFields> = {
  readonly [K in RequiredKeys<Fields>]: TypeOf<Fields[K]>
} & {
  readonly [K in OptionalKeys<Fields>]?: TypeOf<Fields[K]>
}

type ResultType<Ok extends AnyValueType, Err extends AnyValueType> =
  | { readonly ok: TypeOf<Ok> }
  | { readonly err: TypeOf<Err> }

type ResultWireVariant<Tag extends "ok" | "err", Value> = [Value] extends [void]
  ? {
      readonly tag: Tag
      readonly value?: Value
    }
  : {
      readonly tag: Tag
      readonly value: Value
    }

type ResultWire<Ok extends AnyValueType, Err extends AnyValueType> =
  | ResultWireVariant<"ok", EncodedOf<Ok>>
  | ResultWireVariant<"err", EncodedOf<Err>>

type SumVariant<Tag extends string, Value> = [Value] extends [void]
  ? {
      readonly tag: Tag
      readonly value?: Value
    }
  : {
      readonly tag: Tag
      readonly value: Value
    }

type SumType<Variants extends SumVariants> = {
  readonly [Tag in keyof Variants & string]: SumVariant<
    Tag,
    TypeOf<Variants[Tag]>
  >
}[keyof Variants & string]

type UnitWire = Readonly<Record<string, never>>

type OptionWire<Inner extends AnyValueType> =
  | {
      readonly some: EncodedOf<Inner>
    }
  | {
      readonly none: UnitWire
    }

type SumWireVariant<Tag extends string, Value> = {
  readonly [Key in Tag]: [Value] extends [void] ? UnitWire : Value
}

type SumWire<Variants extends SumVariants> = {
  readonly [Tag in keyof Variants & string]: SumWireVariant<
    Tag,
    EncodedOf<Variants[Tag]>
  >
}[keyof Variants & string]

const sumVariantFromDecoded = <Variants extends SumVariants>(
  tag: string,
  decoded: unknown,
): SumType<Variants> =>
  decoded === undefined
    ? ({ tag } as SumType<Variants>)
    : ({ tag, value: decoded } as SumType<Variants>)

const makeSumVariantConstructors = <const Variants extends SumVariants>(
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

type FieldOptionsAnnotation = {
  readonly primaryKey: boolean
  readonly autoInc: boolean
  readonly optional: boolean
  readonly hasDefault?: boolean
  readonly defaultValue?: unknown
  readonly name?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isUnitWireValue = (value: unknown): boolean =>
  (Array.isArray(value) && value.length === 0) ||
  (isRecord(value) && Object.keys(value).length === 0)

const isOkResult = (value: unknown): value is { readonly ok: unknown } =>
  isRecord(value) &&
  "ok" in value &&
  !("err" in value) &&
  Object.keys(value).length === 1

const isErrResult = (value: unknown): value is { readonly err: unknown } =>
  isRecord(value) &&
  "err" in value &&
  !("ok" in value) &&
  Object.keys(value).length === 1

const makeExactResultSchema = <
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

const makeExactSumSchema = <Variants extends SumVariants>(
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

const makeOptionSchema = <Inner extends AnyValueType>(
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

const structTypeError = (
  value: unknown,
  message: string,
): ParseResult.ParseIssue =>
  new ParseResult.Type(Schema.Unknown.ast, value, message)

type StructFieldCodecEntry = {
  readonly optional: boolean
  readonly option: boolean
  // The codec matching the field's wire shape: optional fields share the option codec so
  // their wire is identical to an `Stdb.option` field (see structFieldWireType).
  readonly schema: Schema.Codec<unknown, unknown, never>
}

// Lazily computed and memoized so constructing a struct over malformed fields (e.g. raw
// schemas) stays inert — module validation reports those as diagnostics when the type is
// lowered; the codec must not crash earlier than the pre-lowering behavior did.
const makeStructFieldCodecs = (): ((
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

const makeStructSchema = <Fields extends StructFields>(
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

const narrowSchema = <A, Encoded>(
  schema: Schema.Top,
): Schema.Codec<A, Encoded, never> => schema as Schema.Codec<A, Encoded, never>

const valueSchemaFromAst = (ast: AST.AST): AnyValueType =>
  makeValueType(narrowSchema<unknown, unknown>(Schema.make(ast)), "custom")

const memoizeByFactories = <A>(
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

const constantFactory =
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

const hasTypeKind = <Kind extends TypeKind>(
  info: ValueTypeInfo | undefined,
  kind: Kind,
): info is ValueTypeInfo & { readonly kind: Kind } =>
  info !== undefined && info.kind === kind

const supportsNativeColumnMetadata = (
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

const AutoIncColumnKinds = new Set<TypeKind>([
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

const PrimaryKeyColumnKinds = new Set<TypeKind>([
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

const literalSupportsPrimaryKey = (
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

const codecFor = <A = unknown, Encoded = unknown>(
  value: AnyValueType,
): ValueCodec<A, Encoded> =>
  typeInfo<A, Encoded>(value)?.codec ??
  makeValueCodec(value.schema as Schema.Codec<A, Encoded, never>)

const representationCodecFor = <A = unknown, Encoded = unknown>(
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

const hostCodecFor = <A = unknown, Encoded = unknown>(
  value: AnyValueType,
): ValueCodec<A, Encoded> =>
  representationCodecFor<A, Encoded>(value, encodeHostValue)

const generatedClientCodecFor = <A = unknown, Encoded = unknown>(
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

const typeBuilderCaches = new WeakMap<object, WeakMap<object, AnyTypeBuilder>>()
const namedTypeBuilderCaches = new WeakMap<
  object,
  Map<string, AnyTypeBuilder>
>()

type FingerprintState = {
  readonly active: WeakMap<object, string>
  readonly cache: WeakMap<object, string>
  nextId: number
}

const typeBuilderCacheFor = (factories: BuilderFactories) => {
  const cacheKey = factories as object
  const cached = typeBuilderCaches.get(cacheKey)
  if (cached != null) {
    return cached
  }

  const cache = new WeakMap<object, AnyTypeBuilder>()
  typeBuilderCaches.set(cacheKey, cache)
  return cache
}

const namedTypeBuilderCacheFor = (
  factories: BuilderFactories,
): Map<string, AnyTypeBuilder> => {
  const cacheKey = factories as object
  const cached = namedTypeBuilderCaches.get(cacheKey)
  if (cached != null) {
    return cached
  }

  const cache = new Map<string, AnyTypeBuilder>()
  namedTypeBuilderCaches.set(cacheKey, cache)
  return cache
}

const makeFingerprintState = (): FingerprintState => ({
  active: new WeakMap<object, string>(),
  cache: new WeakMap<object, string>(),
  nextId: 0,
})

const withRecursiveFingerprint = (
  key: object,
  state: FingerprintState,
  evaluate: () => string,
): string => {
  const cached = state.cache.get(key)
  if (cached !== undefined) {
    return cached
  }

  const active = state.active.get(key)
  if (active !== undefined) {
    return recursiveFingerprint(active)
  }

  const ref = `r${state.nextId}`
  state.nextId += 1
  state.active.set(key, ref)

  try {
    const fingerprint = evaluate()
    state.cache.set(key, fingerprint)
    return fingerprint
  } finally {
    state.active.delete(key)
  }
}

const forkFingerprintState = (state: FingerprintState): FingerprintState => ({
  active: state.active,
  cache: new WeakMap<object, string>(),
  nextId: state.nextId,
})

const primitiveLiteralFingerprint = (
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
): string => {
  const first = values[0]
  const expectedType = typeof first

  if (values.some((value) => typeof value !== expectedType)) {
    throw new Error("Type.literal(...) must use a single primitive kind")
  }

  if (typeof first === "string") {
    return primitiveFingerprint("String")
  }

  if (typeof first === "boolean") {
    return primitiveFingerprint("Bool")
  }

  return primitiveFingerprint("F64")
}

const unitFingerprint = (): string => primitiveFingerprint("Unit")

const literalEnumFingerprint = (variantTags: ReadonlyArray<string>): string =>
  enumFingerprint(variantTags.map((tag) => [tag, unitFingerprint()] as const))

const literalValueTypeFingerprint = (
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
): string =>
  isStringLiteralTuple(values)
    ? literalEnumFingerprint(values.map(stringLiteralSatsVariantTag))
    : primitiveLiteralFingerprint(values)

const unsupportedPrimitiveFingerprint = (kind: TypeKind): never => {
  throw new Error(`Type kind ${kind} is not a primitive SATS type`)
}

const primitiveValueTypeFingerprint = (kind: TypeKind): string => {
  const primitiveMatcher = Match.value(kind).pipe(
    Match.when("array", () => unsupportedPrimitiveFingerprint("array")),
    Match.when("bigint", () => primitiveFingerprint("String")),
    Match.when("bool", () => primitiveFingerprint("Bool")),
    Match.when("bytes", () => arrayFingerprint(primitiveFingerprint("U8"))),
    Match.when("connectionId", () => primitiveFingerprint("ConnectionId")),
    Match.when("custom", () => unsupportedPrimitiveFingerprint("custom")),
    Match.when("f32", () => primitiveFingerprint("F32")),
    Match.when("f64", () => primitiveFingerprint("F64")),
    Match.when("i128", () => primitiveFingerprint("I128")),
    Match.when("i16", () => primitiveFingerprint("I16")),
    Match.when("i256", () => primitiveFingerprint("I256")),
    Match.when("i32", () => primitiveFingerprint("I32")),
    Match.when("i64", () => primitiveFingerprint("I64")),
    Match.when("i8", () => primitiveFingerprint("I8")),
    Match.when("identity", () => primitiveFingerprint("Identity")),
    Match.when("lazy", () => unsupportedPrimitiveFingerprint("lazy")),
    Match.when("literal", () => unsupportedPrimitiveFingerprint("literal")),
    Match.when("option", () => unsupportedPrimitiveFingerprint("option")),
    Match.when("result", () => unsupportedPrimitiveFingerprint("result")),
  )

  return primitiveMatcher.pipe(
    Match.when("scheduleAt", () => primitiveFingerprint("ScheduleAt")),
    Match.when("string", () => primitiveFingerprint("String")),
    Match.when("struct", () => unsupportedPrimitiveFingerprint("struct")),
    Match.when("sum", () => unsupportedPrimitiveFingerprint("sum")),
    Match.when("timeDuration", () => primitiveFingerprint("TimeDuration")),
    Match.when("timestamp", () => primitiveFingerprint("Timestamp")),
    Match.when("u128", () => primitiveFingerprint("U128")),
    Match.when("u16", () => primitiveFingerprint("U16")),
    Match.when("u256", () => primitiveFingerprint("U256")),
    Match.when("u32", () => primitiveFingerprint("U32")),
    Match.when("u64", () => primitiveFingerprint("U64")),
    Match.when("u8", () => primitiveFingerprint("U8")),
    Match.when("unit", () => unitFingerprint()),
    Match.when("uuid", () => primitiveFingerprint("Uuid")),
    Match.exhaustive,
  )
}

const valueTypeInfoFingerprint = (
  info: ValueTypeInfo,
  state: FingerprintState,
): string => {
  switch (info.kind) {
    case "array":
      return arrayFingerprint(
        embeddedValueTypeFingerprint(
          info.item ??
            (() => {
              throw new Error("Array value type is missing item metadata")
            })(),
          state,
        ),
      )
    case "custom":
      return info.item != null
        ? embeddedValueTypeFingerprint(info.item, state)
        : primitiveFingerprint("Custom")
    case "lazy": {
      const lazyValue = info.lazy
      if (lazyValue == null) {
        throw new Error("Lazy value type is missing lazy metadata")
      }

      return embeddedValueTypeFingerprint(lazyValue(), state)
    }
    case "literal":
      return literalValueTypeFingerprint(
        info.values ??
          (() => {
            throw new Error("Literal value type is missing values metadata")
          })(),
      )
    case "option":
      return optionFingerprint(
        embeddedValueTypeFingerprint(
          info.item ??
            (() => {
              throw new Error("Option value type is missing item metadata")
            })(),
          state,
        ),
      )
    case "result": {
      const [ok, err] = info.members ?? []
      if (ok == null || err == null) {
        throw new Error("Result value type is missing member metadata")
      }

      return sumFingerprint([
        ["ok", valueTypePayloadFingerprint(ok, state)],
        ["err", valueTypePayloadFingerprint(err, state)],
      ])
    }
    case "struct":
      return productFingerprint(
        Object.entries(info.fields ?? {}).map(([fieldName, field]) => [
          fieldName,
          embeddedValueTypeFingerprint(structFieldWireType(field), state),
        ]),
      )
    case "sum":
      return sumFingerprint(
        Object.entries(info.variants ?? {}).map(([tag, variant]) => [
          tag,
          valueTypePayloadFingerprint(variant, state),
        ]),
      )
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
    case "scheduleAt":
    case "string":
    case "timeDuration":
    case "timestamp":
    case "u8":
    case "u16":
    case "u32":
    case "u64":
    case "u128":
    case "u256":
    case "unit":
    case "uuid":
      return primitiveValueTypeFingerprint(info.kind)
    default:
      const _exhaustive: never = info.kind
      return _exhaustive
  }
}

const valueTypeFingerprint = (
  value: AnyValueType,
  state: FingerprintState = makeFingerprintState(),
): string =>
  withRecursiveFingerprint(value as object, state, () => {
    const info = typeInfo(value)
    return info != null
      ? valueTypeInfoFingerprint(info, state)
      : astFingerprint(value.schema.ast, state)
  })

const embeddedValueTypeFingerprint = (
  value: AnyValueType,
  state: FingerprintState,
): string => valueTypeFingerprint(value, forkFingerprintState(state))

const valueTypePayloadFingerprint = (
  value: AnyValueType,
  state: FingerprintState,
): string =>
  isUnitValueType(value)
    ? unitFingerprint()
    : embeddedValueTypeFingerprint(value, state)

const astLiteralFingerprint = (ast: AST.Literal): string => {
  const values = literalValueTuple([ast.literal])
  if (values == null) {
    throw new Error(
      `Cannot fingerprint unsupported literal ${String(ast.literal)}`,
    )
  }

  return primitiveLiteralFingerprint(values)
}

const astFingerprint = (ast: AST.AST, state: FingerprintState): string =>
  withRecursiveFingerprint(ast as object, state, () => {
    const normalized = encodedAst(ast)
    if (normalized !== ast) {
      return astFingerprint(normalized, state)
    }

    const info = annotationInEncodedShape<ValueTypeInfo>(
      StdbTypeInfoAnnotationId,
      ast,
    )
    if (info != null) {
      return valueTypeInfoFingerprint(info, state)
    }

    if (AST.isSuspend(ast)) {
      return embeddedAstFingerprint(ast.thunk(), state)
    }

    if (AST.isVoid(ast)) {
      return unitFingerprint()
    }

    if (AST.isLiteral(ast)) {
      return astLiteralFingerprint(ast)
    }

    if (AST.isUnion(ast)) {
      const optionValue = optionMemberAst(ast)
      if (optionValue != null) {
        return optionFingerprint(embeddedAstFingerprint(optionValue, state))
      }

      const values = literalValuesFromAst(ast)
      if (values != null) {
        return primitiveLiteralFingerprint(values)
      }
    }

    if (AST.isArrays(ast)) {
      const rest = arrayRestAst(ast)
      if (rest != null) {
        return arrayFingerprint(embeddedAstFingerprint(rest, state))
      }
    }

    if (AST.isObjects(ast)) {
      return productFingerprint(
        ast.propertySignatures.map((property) => {
          if (typeof property.name !== "string") {
            throw new Error(
              "SpacetimeDB struct lowering requires string property names",
            )
          }

          return [property.name, embeddedAstFingerprint(property.type, state)]
        }),
      )
    }

    throw new Error(
      `Cannot fingerprint unsupported Effect Schema AST ${ast._tag}`,
    )
  })

const embeddedAstFingerprint = (
  ast: AST.AST,
  state: FingerprintState,
): string => astFingerprint(ast, forkFingerprintState(state))

export const satsTypeFingerprint = (value: AnyValueType): string =>
  valueTypeFingerprint(value)

export const contentAddressedSatsTypeBuilder = (
  factories: BuilderFactories,
  kind: SatsTypeNameKind,
  fingerprint: string,
  build: (name: string) => AnyTypeBuilder,
): AnyTypeBuilder => {
  const name = contentAddressedName(kind, fingerprint)
  const cacheKey = `${kind}\0${fingerprint}`
  const cache = namedTypeBuilderCacheFor(factories)
  const cached = cache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const builder = build(name)
  cache.set(cacheKey, builder)
  return builder
}

class UnsupportedStdbTypeError extends Error {
  constructor(
    readonly ast: AST.AST,
    readonly path: string | undefined,
    detail?: string,
  ) {
    super(
      detail ??
        `unsupported Effect Schema AST ${ast._tag}. Use a supported Stdb.* value constructor, Stdb.string(BrandSchema) for branded strings, Stdb.literal(...) for literal unions, Stdb.option(...) for optional values, or Stdb.custom(schema, { type }) for schemas that need explicit SATS lowering`,
    )
  }
}

class StdbTypeLoweringError extends Error {}

const appendPath = (path: string | undefined, segment: string): string =>
  path != null && path !== "" ? `${path}.${segment}` : segment

const arrayItemPath = (path: string | undefined): string | undefined =>
  path != null && path !== "" ? `${path}[]` : undefined

const unsupportedStdbType = (
  ast: AST.AST,
  path: string | undefined,
  detail?: string,
): never => {
  throw new UnsupportedStdbTypeError(ast, path, detail)
}

const cachedTypeBuilder = (
  cache: WeakMap<object, AnyTypeBuilder>,
  ast: AST.AST,
  builder: AnyTypeBuilder,
) => {
  cache.set(ast as object, builder)
  return builder
}

const unresolvedRecursiveBuilder = (): never => {
  throw new Error(
    "Recursive SpacetimeDB type builder was accessed before resolution",
  )
}

const makeDeferredRecursiveBuilder = (): {
  readonly builder: AnyTypeBuilder
  readonly resolve: (value: AnyTypeBuilder) => void
} => {
  let resolved: AnyTypeBuilder | undefined
  const deferredAlgebraicType = {
    get tag() {
      return resolved?.algebraicType.tag ?? unresolvedRecursiveBuilder()
    },
    get value() {
      return (
        (resolved?.algebraicType as { readonly value?: unknown } | undefined)
          ?.value ?? unresolvedRecursiveBuilder()
      )
    },
  } as unknown as AnyTypeBuilder["algebraicType"]

  return {
    builder: {
      get algebraicType() {
        return deferredAlgebraicType
      },
    } as AnyTypeBuilder,
    resolve: (value) => {
      resolved = value
    },
  }
}

const cachedRecursiveTypeBuilder = (
  cache: WeakMap<object, AnyTypeBuilder>,
  ast: AST.AST,
  evaluate: () => AnyTypeBuilder,
): AnyTypeBuilder => {
  const deferred = makeDeferredRecursiveBuilder()
  cache.set(ast as object, deferred.builder)

  try {
    const builder = evaluate()
    deferred.resolve(builder)
    cache.set(ast as object, builder)
    return builder
  } catch (error) {
    cache.delete(ast as object)
    throw error
  }
}

const literalValueTuple = (
  values: ReadonlyArray<unknown>,
): readonly [PrimitiveLiteral, ...PrimitiveLiteral[]] | undefined =>
  values.length === 0 ||
  values.some(
    (value): value is Exclude<typeof value, PrimitiveLiteral> =>
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean",
  )
    ? undefined
    : (values as readonly [PrimitiveLiteral, ...PrimitiveLiteral[]])

const flattenUnionMembers = (
  members: ReadonlyArray<AST.AST>,
): ReadonlyArray<AST.AST> =>
  members.flatMap((member) =>
    AST.isUnion(member) ? flattenUnionMembers(member.types) : [member],
  )

const literalValuesFromAst = (
  ast: AST.AST,
):
  | readonly [string | number | boolean, ...(string | number | boolean)[]]
  | undefined => {
  const normalized = encodedAst(ast)

  if (AST.isLiteral(normalized)) {
    return literalValueTuple([normalized.literal])
  }

  if (!AST.isUnion(normalized)) {
    return undefined
  }

  return literalValueTuple(
    flattenUnionMembers(normalized.types).map((member) =>
      AST.isLiteral(member) ? member.literal : Symbol.for("invalid"),
    ),
  )
}

const optionMemberAst = (ast: AST.AST): AST.AST | undefined => {
  const normalized = encodedAst(ast)
  if (!AST.isUnion(normalized)) {
    return undefined
  }

  const members = flattenUnionMembers(normalized.types)
  const nonUndefinedMembers = members.filter(
    (member) => !AST.isUndefined(member),
  )

  return nonUndefinedMembers.length === 1 &&
    members.some((member) => AST.isUndefined(member))
    ? nonUndefinedMembers[0]
    : undefined
}

const arrayRestAst = (ast: AST.AST): AST.AST | undefined => {
  const normalized = encodedAst(ast)
  return AST.isArrays(normalized) &&
    normalized.elements.length === 0 &&
    normalized.rest.length === 1
    ? normalized.rest[0]
    : undefined
}

const typeBuilderFromAst = (
  ast: AST.AST,
  factories: BuilderFactories,
  path: string | undefined,
): AnyTypeBuilder => {
  const cache = typeBuilderCacheFor(factories)
  const cached = cache.get(ast as object)
  if (cached != null) {
    return cached
  }

  const normalized = encodedAst(ast)
  if (normalized !== ast) {
    return cachedRecursiveTypeBuilder(cache, ast, () =>
      typeBuilderFromAst(normalized, factories, path),
    )
  }

  const annotated = annotationInEncodedShape<StdbTypeFactory<AnyTypeBuilder>>(
    StdbTypeAnnotationId,
    ast,
  )
  if (annotated != null) {
    return cachedTypeBuilder(cache, ast, annotated(factories, path))
  }

  if (AST.isSuspend(ast)) {
    return cachedTypeBuilder(
      cache,
      ast,
      factories.lazy(() => typeBuilderFromAst(ast.thunk(), factories, path)),
    )
  }

  if (AST.isVoid(ast)) {
    return cachedTypeBuilder(cache, ast, factories.unit())
  }

  if (AST.isLiteral(ast)) {
    const values = literalValueTuple([ast.literal])
    if (values == null) {
      return unsupportedStdbType(ast, path)
    }

    return cachedTypeBuilder(
      cache,
      ast,
      resolveLiteralBuilder(factories, values),
    )
  }

  if (AST.isUnion(ast)) {
    return cachedRecursiveTypeBuilder(cache, ast, () => {
      const optionValue = optionMemberAst(ast)
      if (optionValue != null) {
        return factories.option(
          typeBuilderFromAst(optionValue, factories, path),
        )
      }

      const values = literalValuesFromAst(ast)
      if (values != null) {
        return resolveLiteralBuilder(factories, values)
      }

      return unsupportedStdbType(ast, path)
    })
  }

  if (AST.isArrays(ast)) {
    return cachedRecursiveTypeBuilder(cache, ast, () => {
      const rest = arrayRestAst(ast)
      if (rest != null) {
        return factories.array(
          typeBuilderFromAst(rest, factories, arrayItemPath(path)),
        )
      }

      return unsupportedStdbType(ast, path)
    })
  }

  if (AST.isObjects(ast)) {
    return cachedRecursiveTypeBuilder(cache, ast, () => {
      const fields = typedFromEntries(
        ast.propertySignatures.map((property) => {
          if (typeof property.name !== "string") {
            return unsupportedStdbType(
              property.type,
              path,
              "SpacetimeDB struct lowering requires string property names",
            )
          }

          return [
            property.name,
            typeBuilderFromAst(
              property.type,
              factories,
              appendPath(path, property.name),
            ),
          ] as const
        }),
      ) as never
      const fingerprint = astFingerprint(ast, makeFingerprintState())

      return contentAddressedSatsTypeBuilder(
        factories,
        "Struct",
        fingerprint,
        (name) => factories.object(name, fields),
      )
    })
  }

  return unsupportedStdbType(ast, path)
}

export const typeBuilderWithFactories = (
  value: AnyValueType,
  factories: BuilderFactories,
  path?: string,
): AnyTypeBuilder => {
  try {
    const info = typeInfo(value)
    if (info != null) {
      const cache = typeBuilderCacheFor(factories)
      const cached = cache.get(value.schema.ast as object)
      if (cached != null) {
        return cached
      }

      return cachedRecursiveTypeBuilder(cache, value.schema.ast, () =>
        info.sats(factories, path),
      )
    }

    return typeBuilderFromAst(value.schema.ast, factories, path)
  } catch (cause) {
    if (cause instanceof StdbTypeLoweringError) {
      throw cause
    }

    const failurePath =
      cause instanceof UnsupportedStdbTypeError ? (cause.path ?? path) : path
    const message =
      cause instanceof Error && cause.message.length > 0
        ? cause.message
        : String(cause)
    throw new StdbTypeLoweringError(
      `SpaceTimeDB type lowering failed${failurePath != null && failurePath !== "" ? ` at ${failurePath}` : ""}: ${message}.`,
      {
        cause,
      },
    )
  }
}

const resolvePrimitiveSchema = <Base, BaseEncoded, A extends Base, Encoded>(
  domain: Schema.Codec<A, Encoded, never> | undefined,
  fallback: Schema.Codec<Base, BaseEncoded, never>,
): Schema.Codec<Base | A, BaseEncoded | Encoded, never> =>
  narrowSchema<Base | A, BaseEncoded | Encoded>(domain ?? fallback)

const boundedBigIntSchema = <A extends bigint, Encoded extends bigint>(
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

const boundedNumberSchema = <A extends number, Encoded extends number>(
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

const isByteArrayInput = (value: unknown): value is ReadonlyArray<number> =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      typeof entry === "number" &&
      Number.isInteger(entry) &&
      entry >= 0 &&
      entry <= U8Max,
  )

const bytesFromUnknown = narrowSchema<Uint8Array, Uint8Array>(
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

const resolveLiteralBuilder = (
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

const NumericLiteralPrecisionMessage =
  "numeric literals lower to f64; non-finite values and unsafe integers cannot be represented safely - use a string literal or a bigint-backed column."

const assertNumericLiteralPrecision = (
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

const isStringLiteralTuple = (
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
): values is StringLiteralTuple =>
  values.every((value) => typeof value === "string")

const assertUniqueStringLiteralVariantTags = <
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

type StringLiteralEncodedWithOptionalValue<Values extends StringLiteralTuple> =
  StringLiteralEncoded<Values> & {
    readonly value?: unknown
  }

const stringLiteralEncodedSchema = <const Values extends StringLiteralTuple>(
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

const stringLiteralSchema = <const Values extends StringLiteralTuple>(
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

const nativeValueSchema = <A>(
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

const rawBigIntField = (value: unknown, field: string): bigint | undefined =>
  isRecord(value) && typeof value[field] === "bigint" ? value[field] : undefined

const SelfUuid = nativeValueSchema<UuidValue>((value) => {
  if (value instanceof Uuid) {
    return value
  }
  const raw = rawBigIntField(value, "__uuid__")
  return raw === undefined ? undefined : new Uuid(raw)
})
const SelfIdentity = nativeValueSchema<IdentityValue>((value) => {
  if (value instanceof Identity) {
    return value
  }
  const raw = rawBigIntField(value, "__identity__")
  return raw === undefined ? undefined : new Identity(raw)
})
const SelfConnectionId = nativeValueSchema<ConnectionIdValue>((value) => {
  if (value instanceof ConnectionId) {
    return value
  }
  const raw = rawBigIntField(value, "__connection_id__")
  return raw === undefined ? undefined : new ConnectionId(raw)
})
const SelfTimestamp = nativeValueSchema<TimestampValue>((value) => {
  if (value instanceof Timestamp) {
    return value
  }
  const raw = rawBigIntField(value, "__timestamp_micros_since_unix_epoch__")
  return raw === undefined ? undefined : new Timestamp(raw)
})
const SelfTimeDuration = nativeValueSchema<TimeDurationValue>((value) => {
  if (value instanceof TimeDuration) {
    return value
  }
  const raw = rawBigIntField(value, "__time_duration_micros__")
  return raw === undefined ? undefined : new TimeDuration(raw)
})

const SelfScheduleAt = narrowSchema<ScheduleAtValue, unknown>(
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

/**
 * Literal value type.
 *
 * String literals lower to a native SATS enum whose DB/host and HTTP/JSON
 * variant tags preserve authored strings verbatim when they are valid
 * SpaceTimeDB identifiers. Other strings use a generated-client-safe schema tag
 * while decoding back to the authored value. Generated clients still expose
 * those enum variants through SpaceTimeDB's PascalCase convention.
 *
 * Numeric literals lower to `f64`; non-finite values and unsafe integers beyond
 * `Number.MAX_SAFE_INTEGER` are rejected because they cannot round-trip safely.
 */
export const literal = <
  const Values extends readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
>(
  ...values: Values
): LiteralValueType<Values> => {
  if (isStringLiteralTuple(values)) {
    return stringLiteralSchema(values) as unknown as LiteralValueType<Values>
  }

  assertNumericLiteralPrecision(values)

  return attachStdbType(
    Schema.Literals(values) as Schema.Codec<
      Values[number],
      Values[number],
      never,
      never
    >,
    (factories) => resolveLiteralBuilder(factories, values),
    { kind: "literal", values },
  ) as unknown as LiteralValueType<Values>
}

export const array = <Inner extends AnyValueType>(
  inner: Inner,
): ArrayValueType<Inner> =>
  attachStdbType(
    inner.schema.pipe(narrowSchema, Schema.Array),
    (factories) => factories.array(typeBuilderWithFactories(inner, factories)),
    { kind: "array", item: inner },
  ) as ArrayValueType<Inner>

export const option = <Inner extends AnyValueType>(
  inner: Inner,
): OptionValueType<Inner> => {
  const schema = makeOptionSchema(inner)

  return attachStdbType(
    schema,
    (factories) => factories.option(typeBuilderWithFactories(inner, factories)),
    { kind: "option", item: inner },
  ) as OptionValueType<Inner>
}

export const structFieldOptions = (
  value: AnyValueType,
): AnyNormalizedStructFieldOptions => ({
  optional:
    annotationInEncodedShape<FieldOptionsAnnotation>(
      StdbFieldOptionsAnnotationId,
      value.schema.ast,
    )?.optional === true,
})

const hasOptionalFieldOption = (value: AnyValueType): boolean =>
  structFieldOptions(value).optional

const isOptionValueType = (value: AnyValueType): boolean =>
  hasTypeKind(typeInfo(value), "option")

// Single decision point for the wire shape of a struct field: an `{ optional: true }`
// field-options annotation lowers to the same SATS `option<T>` as `Stdb.option`. Every
// wire-shape consumer (struct SATS builder, struct schema, HTTP-JSON normalization, and
// the content-addressed fingerprints) must route struct fields through this helper so
// optional fields cannot diverge between the type, the codec, and the type name. Table
// columns lower through their own native row-builder path and must not use this.
// Malformed fields (raw schemas) pass through untouched so module validation can report
// them as diagnostics instead of crashing here.
export const structFieldWireType = (value: AnyValueType): AnyValueType =>
  isValueType(value) && hasOptionalFieldOption(value) ? option(value) : value

export const field = <
  Value extends AnyValueType,
  Options extends StructFieldOptions,
>(
  value: Value,
  options?: Options,
): StructFieldType<Value, Options> =>
  annotateValueTypeSchema(value, StdbFieldOptionsAnnotationId, {
    primaryKey: false,
    autoInc: false,
    optional: options?.optional === true,
  }) as StructFieldType<Value, Options>

export const optional = <Value extends AnyValueType>(
  value: Value,
): StructFieldType<Value, { readonly optional: true }> =>
  field(value, { optional: true })

export const custom = <A, Encoded>(
  schema: Schema.Codec<A, Encoded, never>,
  options: { readonly type: AnyValueType },
): ValueType<A, Encoded> =>
  attachStdbType(
    schema,
    (factories) => typeBuilderWithFactories(options.type, factories),
    { kind: "custom", item: options.type },
  )

export const struct = <const Fields extends StructFields>(
  fields: Fields,
): StructValueType<Fields> => {
  const valueSchema = makeStructSchema(fields)

  return attachStdbType(
    valueSchema,
    (factories, path) => {
      const fieldBuilders = typedFromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          typeBuilderWithFactories(
            structFieldWireType(value),
            factories,
            appendPath(path, key),
          ),
        ]),
      ) as never
      const fingerprintState = makeFingerprintState()
      const fingerprint = productFingerprint(
        Object.entries(fields).map(([key, value]) => [
          key,
          embeddedValueTypeFingerprint(
            structFieldWireType(value),
            fingerprintState,
          ),
        ]),
      )

      return contentAddressedSatsTypeBuilder(
        factories,
        "Struct",
        fingerprint,
        (name) => factories.object(name, fieldBuilders),
      )
    },
    {
      kind: "struct",
      fields,
    },
  ) as StructValueType<Fields>
}

export const lazy = <A, Encoded>(
  evaluate: () => ValueType<A, Encoded>,
): LazyValueType<A, Encoded> => {
  let resolved: ValueType<A, Encoded> | undefined
  const evaluateOnce = (): ValueType<A, Encoded> => (resolved ??= evaluate())
  const schema = Schema.suspend(() => evaluateOnce().schema) as Schema.Codec<
    A,
    Encoded,
    never
  >

  return attachStdbType(
    schema,
    (factories, path) =>
      factories.lazy(() =>
        typeBuilderWithFactories(evaluateOnce(), factories, path),
      ),
    {
      kind: "lazy",
      lazy: evaluateOnce,
    },
  ) as unknown as LazyValueType<A, Encoded>
}

export const unit = (): UnitValueType =>
  attachStdbType(Schema.Void, (factories) => factories.unit(), {
    kind: "unit",
  })

export const result = <Ok extends AnyValueType, Err extends AnyValueType>(
  ok: Ok,
  err: Err,
): ResultValueType<Ok, Err> => {
  const schema = narrowSchema<ResultType<Ok, Err>, ResultWire<Ok, Err>>(
    makeExactResultSchema(ok, err),
  )

  return attachStdbType(
    schema,
    (factories) =>
      factories.result(
        isUnitValueType(ok)
          ? factories.unit()
          : typeBuilderWithFactories(ok, factories),
        isUnitValueType(err)
          ? factories.unit()
          : typeBuilderWithFactories(err, factories),
      ),
    {
      kind: "result",
      members: [ok, err],
    },
  ) as ResultValueType<Ok, Err>
}

export const sum = <const Variants extends SumVariants>(
  variants: Variants,
): SumValueType<Variants> => {
  const schema = narrowSchema<SumType<Variants>, SumWire<Variants>>(
    makeExactSumSchema(variants),
  )

  const valueType = attachStdbType(
    schema,
    (factories) => {
      const variantEntries = Object.entries(variants)
      const fingerprintState = makeFingerprintState()
      const fingerprint = sumFingerprint(
        variantEntries.map(([tag, variant]) => [
          tag,
          valueTypePayloadFingerprint(variant, fingerprintState),
        ]),
      )
      const allUnitVariants = variantEntries.every(([, variant]) =>
        isUnitValueType(variant),
      )

      return contentAddressedSatsTypeBuilder(
        factories,
        "Sum",
        fingerprint,
        (name) =>
          allUnitVariants
            ? factories.enum(name, variantEntries.map(([tag]) => tag) as never)
            : factories.enum(
                name,
                typedFromEntries(
                  variantEntries.map(([tag, variant]) => [
                    tag,
                    isUnitValueType(variant)
                      ? factories.unit()
                      : typeBuilderWithFactories(variant, factories),
                  ]),
                ) as never,
              ),
      )
    },
    {
      kind: "sum",
      members: Object.values(variants),
      variants,
    },
  ) as SumValueType<Variants>
  Object.defineProperty(valueType, "make", {
    value: makeSumVariantConstructors(variants),
    enumerable: false,
    writable: false,
  })

  return valueType
}

export const enum_ = <const Tags extends readonly [string, ...string[]]>(
  ...tags: Tags
): SumValueType<{ readonly [K in Tags[number]]: UnitValueType }> =>
  sum(
    typedFromEntries(tags.map((tag) => [tag, unit()] as const)) as {
      readonly [K in Tags[number]]: UnitValueType
    },
  )

export { enum_ as enum }

export const structFields = (value: AnyValueType): StructFields | undefined => {
  const info = typeInfo(value)
  if (info?.fields != null) {
    return info.fields
  }

  const ast = encodedAst(value.schema.ast)
  if (!AST.isObjects(ast)) {
    return undefined
  }

  return typedFromEntries(
    ast.propertySignatures.map((property) => {
      if (typeof property.name !== "string") {
        throw new Error(
          "SpacetimeDB struct lowering requires string property names",
        )
      }

      return [property.name, valueSchemaFromAst(property.type)] as const
    }),
  )
}

export const arrayItem = (value: AnyValueType): AnyValueType | undefined => {
  const info = typeInfo(value)
  if (hasTypeKind(info, "array")) {
    return info.item
  }

  const item = arrayRestAst(value.schema.ast)
  return item != null ? valueSchemaFromAst(item) : undefined
}

export const optionItem = (value: AnyValueType): AnyValueType | undefined => {
  const info = typeInfo(value)
  if (hasTypeKind(info, "option")) {
    return info.item
  }

  const item = optionMemberAst(value.schema.ast)
  return item != null ? valueSchemaFromAst(item) : undefined
}

const authoredLiteralValuesFromAst = (
  ast: AST.AST,
):
  | readonly [string | number | boolean, ...(string | number | boolean)[]]
  | undefined => literalValuesFromAst(ast)

export const literalValues = (
  value: AnyValueType,
):
  | readonly [string | number | boolean, ...(string | number | boolean)[]]
  | undefined =>
  typeInfo(value)?.values ?? authoredLiteralValuesFromAst(value.schema.ast)

export const isUnitValueType = (value: AnyValueType): boolean => {
  if (hasTypeKind(typeInfo(value), "unit")) {
    return true
  }

  const ast = encodedAst(value.schema.ast)
  return AST.isVoid(ast)
}

const astIsAuthoredVoid = (ast: AST.AST): boolean => {
  if (AST.isVoid(ast) || AST.isUndefined(ast)) {
    return true
  }

  return AST.isSuspend(ast) && astIsAuthoredVoid(ast.thunk())
}

export const isAuthoredUnitValueType = (value: AnyValueType): boolean =>
  hasTypeKind(typeInfo(value), "unit") || astIsAuthoredVoid(value.schema.ast)
