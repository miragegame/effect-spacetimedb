import type { AnyFieldType } from "./field.ts"

const ColumnReferenceTypeId = Symbol.for("effect-spacetimedb/ColumnReference")

export type ColumnReference<Name extends string = string> = {
  readonly [ColumnReferenceTypeId]: typeof ColumnReferenceTypeId
  readonly name: Name
}

export type ColumnSelection = string | ColumnReference<string>

export type ColumnNameOf<Value> = Value extends ColumnReference<infer Name>
  ? Name
  : Value extends string
    ? Value
    : never

export type ColumnNamesOf<Columns extends readonly ColumnSelection[]> =
  Columns extends readonly [
    infer Head extends ColumnSelection,
    ...infer Tail extends readonly ColumnSelection[],
  ]
    ? readonly [ColumnNameOf<Head>, ...ColumnNamesOf<Tail>]
    : Columns extends readonly []
      ? readonly []
      : ReadonlyArray<ColumnNameOf<Columns[number]>>

export type ColumnReferences<Fields extends Record<string, AnyFieldType>> = {
  readonly [Key in keyof Fields & string]: ColumnReference<Key>
}

export const reference = <const Name extends string>(
  name: Name,
): ColumnReference<Name> => ({
  [ColumnReferenceTypeId]: ColumnReferenceTypeId,
  name,
})

export const isReference = (value: unknown): value is ColumnReference<string> =>
  typeof value === "object" && value !== null && ColumnReferenceTypeId in value

export const nameOf = <Value extends ColumnSelection>(
  value: Value,
): ColumnNameOf<Value> => (isReference(value) ? value.name : value) as never

export const namesOf = <const Columns extends readonly ColumnSelection[]>(
  columns: Columns,
): ColumnNamesOf<Columns> =>
  columns.map(nameOf) as unknown as ColumnNamesOf<Columns>

export const referencesFor = <
  const Fields extends Record<string, AnyFieldType>,
>(
  fields: Fields,
): ColumnReferences<Fields> =>
  Object.fromEntries(
    Object.keys(fields).map((fieldName) => [fieldName, reference(fieldName)]),
  ) as ColumnReferences<Fields>
