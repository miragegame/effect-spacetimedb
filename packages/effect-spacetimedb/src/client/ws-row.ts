import type { AnyFieldType, FieldOptionsOf } from "../contract/field.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import type { EncodedOf } from "../contract/type.ts"
import * as Type from "../contract/type.ts"

type WsFieldEncoded<Field extends AnyFieldType> =
  Field extends Type.OptionValueType<infer Inner>
    ? EncodedOf<Inner> | undefined
    : FieldOptionsOf<Field>["optional"] extends true
      ? EncodedOf<Field> | undefined
      : EncodedOf<Field>

type WsOptionalColumnKeys<Table extends AnyTableSpec> = {
  [Key in keyof Table["columns"]]-?: Table["columns"][Key] extends Type.OptionValueType<AnyFieldType>
    ? Key
    : FieldOptionsOf<Table["columns"][Key]>["optional"] extends true
      ? Key
      : never
}[keyof Table["columns"]]

type WsRequiredColumnKeys<Table extends AnyTableSpec> = Exclude<
  keyof Table["columns"],
  WsOptionalColumnKeys<Table>
>

export type WsTableRow<Table extends AnyTableSpec> = {
  readonly [Key in WsRequiredColumnKeys<Table>]: WsFieldEncoded<
    Table["columns"][Key]
  >
} & {
  readonly [Key in WsOptionalColumnKeys<Table>]?: WsFieldEncoded<
    Table["columns"][Key]
  >
}
