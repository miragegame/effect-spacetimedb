import type { AnyFieldType } from "./field.ts"
import * as ColumnReference from "./column-reference.ts"

type ColumnsOf<Fields extends Record<string, AnyFieldType>> = keyof Fields &
  string

export type UniqueConstraintSpec<
  Name extends string = string,
  Columns extends readonly string[] = readonly string[],
> = {
  readonly kind: "unique"
  readonly name: Name
  readonly columns: Columns
}

export type ConstraintSpec = UniqueConstraintSpec

export function unique<
  const Fields extends Record<string, AnyFieldType>,
  const Name extends string,
  const Columns extends readonly ColumnsOf<Fields>[],
>(options: {
  readonly name: Name
  readonly columns: Columns
}): UniqueConstraintSpec<Name, Columns>
export function unique<
  const Name extends string,
  const Columns extends readonly ColumnReference.ColumnSelection[],
>(
  name: Name,
  columns: Columns,
): UniqueConstraintSpec<Name, ColumnReference.ColumnNamesOf<Columns>>
export function unique(
  optionsOrName:
    | {
        readonly name: string
        readonly columns: readonly string[]
      }
    | string,
  columns?: readonly ColumnReference.ColumnSelection[],
): UniqueConstraintSpec {
  if (typeof optionsOrName === "string") {
    return {
      kind: "unique",
      name: optionsOrName,
      columns: ColumnReference.namesOf(columns ?? []),
    }
  }

  return {
    kind: "unique",
    name: optionsOrName.name,
    columns: optionsOrName.columns,
  }
}
