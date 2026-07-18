import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import * as SpacetimeDB from "spacetimedb"
import type {
  AnyNormalizedFieldOptions,
  FieldOptions as TableFieldOptions,
  FieldType as TableFieldType,
} from "../field.ts"
import { validateSatsTypeIdentifier } from "../sats-identifier-validation.ts"
import {
  annotateSchema,
  annotationInEncodedShape,
  type SchemaAnnotationId,
  StdbFieldOptionsAnnotationId,
  StdbTypeInfoAnnotationId,
} from "../schema-annotations.ts"
import type { IndexAlgorithm } from "../table-index.ts"
import type {
  OptionWire,
  ResultType,
  StructType,
  SumType,
  SumWire,
} from "./shapes.ts"
export const { ConnectionId, Identity, TimeDuration, Timestamp, Uuid } =
  SpacetimeDB

export type AnyTypeBuilder = {
  readonly type: unknown
  readonly algebraicType: {
    readonly tag: string
    readonly value?: unknown
  }
  readonly optional: () => unknown
  readonly serialize: (value: unknown) => unknown
  readonly deserialize: (value: unknown) => unknown
}

export type BuilderFactories = {
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

export type StdbTypeFactory<Builder extends AnyTypeBuilder = AnyTypeBuilder> = (
  factories: BuilderFactories,
  path?: string,
  value?: AnyValueType,
) => Builder

export type ConnectionIdValue = SpacetimeDB.ConnectionId

export type IdentityValue = SpacetimeDB.Identity

export type ScheduleAtValue = SpacetimeDB.ScheduleAt

export type TimeDurationValue = SpacetimeDB.TimeDuration

export type TimestampValue = SpacetimeDB.Timestamp

export type UuidValue = SpacetimeDB.Uuid

export type PrimitiveLiteral = string | number | boolean

export type StringLiteralTuple = readonly [string, ...string[]]

export type StringLiteralEncoded<Values extends StringLiteralTuple> = {
  readonly [Value in Values[number]]: { readonly tag: string }
}[Values[number]]

export type LiteralEncoded<
  Values extends readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
> = Values extends StringLiteralTuple
  ? StringLiteralEncoded<Values>
  : Values[number]

export const StructTypeId = "__effectSpacetimeDbStructType" as const
export const StructFieldTypeId = "__effectSpacetimeDbStructFieldType" as const
export const StdbValueTypeId: unique symbol = Symbol.for(
  "effect-spacetimedb/StdbValueType",
) as never

export const I8Min = -0x80
export const I8Max = 0x7f
export const U8Max = 0xff

export const I16Min = -0x8000
export const I16Max = 0x7fff
export const U16Max = 0xffff

export const I32Min = -(2 ** 31)
export const I32Max = 2 ** 31 - 1

export const I64Min = -(1n << 63n)

export const I64Max = (1n << 63n) - 1n

export const U64Max = (1n << 64n) - 1n

export const I128Min = -(1n << 127n)

export const I128Max = (1n << 127n) - 1n

export const U128Max = (1n << 128n) - 1n

export const I256Min = -(1n << 255n)

export const I256Max = (1n << 255n) - 1n

export const U256Max = (1n << 256n) - 1n

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
  /**
   * Struct-field annotation for an absent-or-undefined property inside
   * `Stdb.struct({ ... })`. It has the same wire lowering as `Stdb.option(T)`;
   * see `test/unit/optional-lowering.test.ts`.
   */
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
  readonly named: <Self extends AnyValueType>(
    this: Self,
    identifier: string,
  ) => Self
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

export type NormalizedStructFieldOptions<
  Options extends StructFieldOptions = StructFieldOptions,
> = {
  readonly optional: Options["optional"] extends true ? true : false
}

export type AnyNormalizedStructFieldOptions = {
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

export type IsUnit<Value extends AnyValueType> = [TypeOf<Value>] extends [void]
  ? true
  : false

export type SumVariantConstructors<Variants extends SumVariants> = {
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

export type TypeInfoOptions = {
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

export const makeValueCodec = <A, Encoded>(
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

export const DefaultTableFieldOptions: AnyNormalizedFieldOptions = {
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

const hasUnitKind = (value: AnyValueType): boolean =>
  typeInfo(value)?.kind === "unit"

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
    return variants.length > 0 && variants.every(hasUnitKind)
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

export class StdbTypeNotNameableError extends Data.TaggedError(
  "StdbTypeNotNameableError",
)<{
  readonly kind: TypeKind
}> {
  override get message(): string {
    return `SATS type identifiers can only be assigned to struct, sum, and string-literal value types; received ${this.kind}`
  }
}

const isStringLiteralValues = (
  values: readonly [
    string | number | boolean,
    ...(string | number | boolean)[],
  ],
): values is readonly [string, ...string[]] =>
  values.every((value) => typeof value === "string")

export const satsIdentifierOf = (
  value: AnyValueType | undefined,
  fallback: string | undefined,
): string | undefined =>
  value === undefined
    ? fallback
    : (annotationInEncodedShape<string>("identifier", value.schema.ast) ??
      fallback)

export function namedValueType<Type extends AnyValueType>(
  this: Type,
  identifier: string,
): Type {
  validateSatsTypeIdentifier(identifier)

  const info = typeInfo(this)
  if (
    info == null ||
    (info.kind !== "struct" &&
      info.kind !== "sum" &&
      (info.kind !== "literal" ||
        info.values == null ||
        !isStringLiteralValues(info.values)))
  ) {
    throw new StdbTypeNotNameableError({
      kind: info?.kind ?? this[StdbValueTypeId],
    })
  }

  const schema = annotateSchema(this.schema, "identifier", identifier)
  const renamedInfo: ValueTypeInfo = {
    ...info,
    schema,
    codec: makeValueCodec(schema),
  }
  const renamed = makeValueType(
    annotateSchema(schema, StdbTypeInfoAnnotationId, renamedInfo),
    this[StdbValueTypeId],
  )

  return preserveValueTypeExtensions(this, renamed)
}

export const tableFieldOptions = (
  value: AnyValueType,
): AnyNormalizedFieldOptions => {
  const annotation =
    annotationInEncodedShape<Partial<AnyNormalizedFieldOptions>>(
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

export const mergeFieldOptions = <
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

export function indexField<Type extends AnyValueType>(
  this: Type,
): TableFieldType<
  Type,
  MergeTableFieldOptions<
    TableFieldOptionsOfValue<Type>,
    { readonly index: "btree" }
  >
>

export function indexField<
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

export function indexField<Type extends AnyValueType>(
  this: Type,
  algorithm: IndexAlgorithm = "btree",
) {
  return mergeFieldOptions(this, { index: algorithm })
}

export const fieldChainMethods = {
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
  named<Type extends AnyValueType>(this: Type, identifier: string) {
    return namedValueType.call(this, identifier)
  },
}

export const makeValueType = <A, Encoded, Kind extends TypeKind>(
  schema: Schema.Codec<A, Encoded, never, never>,
  kind: Kind,
): ValueType<A, Encoded, Kind> =>
  ({
    [StdbValueTypeId]: kind,
    schema,
    ...fieldChainMethods,
  }) as ValueType<A, Encoded, Kind>

export const valueTypeCoreKeys = new Set<PropertyKey>([
  StdbValueTypeId,
  "schema",
  ...Object.keys(fieldChainMethods),
])

export const preserveValueTypeExtensions = <Value extends AnyValueType>(
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

export const isValueType = (value: unknown): value is AnyValueType =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  StdbValueTypeId in value &&
  "schema" in value &&
  typeof (value as { readonly schema?: unknown }).schema === "object" &&
  (value as { readonly schema?: { readonly ast?: unknown } }).schema?.ast !==
    undefined

export const annotateValueTypeSchema = <Value extends AnyValueType>(
  value: Value,
  annotationId: SchemaAnnotationId,
  annotation: unknown,
): Value =>
  preserveValueTypeExtensions(
    value,
    makeValueType(
      annotateSchema(value.schema, annotationId, annotation),
      value[StdbValueTypeId],
    ),
  )
