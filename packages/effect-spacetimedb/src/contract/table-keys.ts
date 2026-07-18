import type { FieldOptionsOf, FieldValue } from "./field.ts"
import type { AnyTableSpec } from "./table.ts"

export type ColumnKey<Table extends AnyTableSpec> = keyof Table["columns"] &
  string

export type PrimaryKeyNames<Table extends AnyTableSpec> = {
  readonly [K in ColumnKey<Table>]: FieldOptionsOf<
    Table["columns"][K]
  >["primaryKey"] extends true
    ? K
    : never
}[ColumnKey<Table>]

type SingleUnionMember<
  Member extends string,
  All extends string = Member,
> = Member extends string
  ? [Exclude<All, Member>] extends [never]
    ? Member
    : never
  : never

export type SinglePrimaryKeyName<Table extends AnyTableSpec> =
  SingleUnionMember<PrimaryKeyNames<Table>>

type SinglePrimaryKeyDiagnostic = {
  readonly "row lookup requires a table with exactly one primary key column": never
}

export type SinglePrimaryKeyValue<Table extends AnyTableSpec> = [
  SinglePrimaryKeyName<Table>,
] extends [infer Name extends ColumnKey<Table>]
  ? FieldValue<Table["columns"][Name]>
  : SinglePrimaryKeyDiagnostic
