import { applyFieldOptions, type AnyValueType, type TypeOf } from "./type.ts"
import type { IndexAlgorithm } from "./table-index.ts"

export { tableFieldOptions as fieldOptions } from "./type.ts"

export type FieldOptions<Value = unknown> = {
  readonly primaryKey?: true
  readonly autoInc?: true
  readonly unique?: true
  readonly index?: IndexAlgorithm
  readonly optional?: true
  readonly default?: Value
  readonly name?: string
}

export const FieldTypeId = "__effectSpacetimeDbFieldType" as const

type NormalizedFieldOptions<Options extends FieldOptions = FieldOptions> = {
  readonly primaryKey: Options["primaryKey"] extends true ? true : false
  readonly autoInc: Options["autoInc"] extends true ? true : false
  readonly unique: Options["unique"] extends true ? true : false
  readonly index: Options extends {
    readonly index: infer Algorithm extends IndexAlgorithm
  }
    ? Algorithm
    : undefined
  readonly optional: Options["optional"] extends true ? true : false
  readonly hasDefault: Options extends { readonly default: unknown }
    ? true
    : false
  readonly defaultValue: Options extends { readonly default: infer Value }
    ? Value
    : undefined
  readonly name: Options extends { readonly name: infer Name extends string }
    ? Name
    : undefined
}

export type AnyNormalizedFieldOptions = {
  readonly primaryKey: boolean
  readonly autoInc: boolean
  readonly unique: boolean
  readonly index: IndexAlgorithm | undefined
  readonly optional: boolean
  readonly hasDefault: boolean
  readonly defaultValue: unknown
  readonly name: string | undefined
}

export type FieldType<
  Type extends AnyValueType = AnyValueType,
  Options extends FieldOptions = FieldOptions,
> = Type & {
  readonly [FieldTypeId]: NormalizedFieldOptions<Options>
}

export type AnyFieldType = AnyValueType & {
  readonly [FieldTypeId]: AnyNormalizedFieldOptions
}

export type FieldOptionsOf<Field extends AnyFieldType> = Field extends {
  readonly [FieldTypeId]: infer Options extends AnyNormalizedFieldOptions
}
  ? Options
  : AnyNormalizedFieldOptions

export type FieldValue<Field extends AnyFieldType> =
  FieldOptionsOf<Field>["optional"] extends true
    ? TypeOf<Field> | undefined
    : TypeOf<Field>

export const Field = <
  Type extends AnyValueType,
  const Options extends FieldOptions<TypeOf<Type>> = {},
>(
  type: Type,
  options?: Options,
): FieldType<Type, Options> => applyFieldOptions(type, options)
