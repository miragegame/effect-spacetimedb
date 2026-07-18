import type * as Effect from "effect/Effect"
import { fieldOptions } from "../contract/field.ts"
import type { AnyTableSpec, TableRow } from "../contract/table.ts"
import type { IndexAlgorithm } from "../contract/table-index.ts"
import type { ColumnKey, PrimaryKeyNames } from "../contract/table-keys.ts"
import type { StdbDecodeError } from "../decode-error.ts"
import type {
  ExplicitIndexSpec,
  IndexPoint,
  IndexRange,
} from "../table-index-typing.ts"

type IsSameColumnOrder<
  Left extends readonly string[],
  Right extends readonly string[],
> = Left extends readonly [
  infer LeftHead extends string,
  ...infer LeftTail extends readonly string[],
]
  ? Right extends readonly [
      infer RightHead extends string,
      ...infer RightTail extends readonly string[],
    ]
    ? LeftHead extends RightHead
      ? RightHead extends LeftHead
        ? IsSameColumnOrder<LeftTail, RightTail>
        : false
      : false
    : false
  : Right extends readonly []
    ? true
    : false

type UniqueConstraintSpec<Table extends AnyTableSpec> = Extract<
  Table["constraints"][number],
  { readonly kind: "unique" }
>

type HasOrderedUniqueConstraint<
  Table extends AnyTableSpec,
  Columns extends readonly string[],
> = true extends (
  UniqueConstraintSpec<Table> extends infer Constraint
    ? Constraint extends {
        readonly columns: infer ConstraintColumns extends readonly string[]
      }
      ? IsSameColumnOrder<Columns, ConstraintColumns>
      : false
    : false
)
  ? true
  : false

type IsUniqueClientIndexColumns<
  Table extends AnyTableSpec,
  Columns extends readonly string[],
> = Columns extends readonly [infer Only extends string]
  ? Only extends PrimaryKeyNames<Table>
    ? true
    : HasOrderedUniqueConstraint<Table, Columns>
  : HasOrderedUniqueConstraint<Table, Columns>

type UniqueClientIndex<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = {
  readonly find: (
    value: IndexPoint<Table, Columns, true>,
  ) => Effect.Effect<TableRow<Table> | undefined, StdbDecodeError>
}

type RangeClientIndex<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = {
  readonly filter: (
    value: IndexRange<Table, Columns, "native", true>,
  ) => Effect.Effect<ReadonlyArray<TableRow<Table>>, StdbDecodeError>
}

type ExplicitClientIndex<
  Table extends AnyTableSpec,
  Index extends ExplicitIndexSpec<Table>,
> = Index extends {
  readonly algorithm: infer Algorithm
  readonly columns: infer Columns extends readonly ColumnKey<Table>[]
}
  ? Algorithm extends "btree"
    ? IsUniqueClientIndexColumns<Table, Columns> extends true
      ? UniqueClientIndex<Table, Columns>
      : RangeClientIndex<Table, Columns>
    : never
  : never

export type ClientTableIndexAccessors<Table extends AnyTableSpec> = {
  readonly [Name in PrimaryKeyNames<Table>]: UniqueClientIndex<
    Table,
    readonly [Name]
  >
} & {
  readonly [Index in ExplicitIndexSpec<Table> as Index["algorithm"] extends "btree"
    ? Index["name"] & string
    : never]: ExplicitClientIndex<Table, Index>
}

type ClientIndexPlanBase = {
  readonly key: string
  readonly columns: ReadonlyArray<string>
}

export type ClientIndexPlan = ClientIndexPlanBase &
  (
    | { readonly kind: "unique" }
    | { readonly kind: "range" }
    | {
        readonly kind: "unsupported-algorithm"
        readonly algorithm: Exclude<IndexAlgorithm, "btree">
      }
  )

const sameIndexColumnOrder = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean =>
  left.length === right.length &&
  left.every((column, index) => column === right[index])

export const clientIndexPlansOf = (
  table: AnyTableSpec,
): ReadonlyArray<ClientIndexPlan> => {
  const primaryKeys = Object.entries(table.columns)
    .filter(([, column]) => fieldOptions(column).primaryKey)
    .map(([name]) => name)
  const uniqueConstraints = [
    ...primaryKeys.map((name) => [name]),
    ...table.constraints
      .filter((constraint) => constraint.kind === "unique")
      .map((constraint) => [...constraint.columns]),
  ]
  const implicit = primaryKeys.map((key) => ({
    key,
    columns: [key],
    kind: "unique" as const,
  }))
  const explicit: ReadonlyArray<ClientIndexPlan> = table.indexes.map(
    (index) => {
      const base = { key: index.name, columns: [...index.columns] }
      if (index.algorithm !== "btree") {
        return {
          ...base,
          kind: "unsupported-algorithm",
          algorithm: index.algorithm,
        }
      }
      return {
        ...base,
        kind: uniqueConstraints.some((columns) =>
          sameIndexColumnOrder(columns, index.columns),
        )
          ? "unique"
          : "range",
      }
    },
  )
  return [...implicit, ...explicit]
}
