import type {
  FieldOptions as TableFieldOptions,
  FieldType as TableFieldType,
} from "../field.ts"
import type {
  AnyValueType,
  EncodedOf,
  StructFieldOptions,
  StructFields,
  StructFieldType,
  SumVariants,
  TypeOf,
} from "./core.ts"

export type FieldOptionsAnnotation = {
  readonly primaryKey: boolean
  readonly autoInc: boolean
  readonly optional: boolean
  readonly hasDefault?: boolean
  readonly defaultValue?: unknown
  readonly name?: string
}

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
