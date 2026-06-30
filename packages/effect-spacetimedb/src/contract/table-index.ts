import type { AnyFieldType } from "./field.ts"
import * as ColumnReference from "./column-reference.ts"

export type IndexAlgorithm = "btree" | "hash" | "direct"

export type IndexSpec<
  Name extends string = string,
  Columns extends readonly string[] = readonly string[],
  Algorithm extends IndexAlgorithm = IndexAlgorithm,
> = {
  readonly name: Name
  readonly algorithm: Algorithm
  readonly columns: Columns
}

type ColumnsOf<Fields extends Record<string, AnyFieldType>> = keyof Fields &
  string

export function define<
  const Fields extends Record<string, AnyFieldType>,
  const Name extends string,
  const Columns extends readonly ColumnsOf<Fields>[],
  const Algorithm extends IndexAlgorithm = "btree",
>(options: {
  readonly name: Name
  readonly columns: Columns
  readonly algorithm?: Algorithm
}): IndexSpec<Name, Columns, Algorithm>
export function define<
  const Name extends string,
  const Columns extends readonly ColumnReference.ColumnSelection[],
  const Algorithm extends IndexAlgorithm = "btree",
>(
  name: Name,
  columns: Columns,
  options?: { readonly algorithm?: Algorithm },
): IndexSpec<Name, ColumnReference.ColumnNamesOf<Columns>, Algorithm>
export function define(
  optionsOrName:
    | {
        readonly name: string
        readonly columns: readonly string[]
        readonly algorithm?: IndexAlgorithm
      }
    | string,
  columns?: readonly ColumnReference.ColumnSelection[],
  options?: { readonly algorithm?: IndexAlgorithm },
): IndexSpec {
  if (typeof optionsOrName === "string") {
    return {
      name: optionsOrName,
      columns: ColumnReference.namesOf(columns ?? []),
      algorithm: options?.algorithm ?? "btree",
    }
  }

  return {
    name: optionsOrName.name,
    columns: optionsOrName.columns,
    algorithm: optionsOrName.algorithm ?? "btree",
  }
}
