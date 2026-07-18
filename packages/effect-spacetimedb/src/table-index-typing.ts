import type { FieldValue } from "./contract/field.ts"
import type {
  AnyTableSpec,
  TableRow as ContractTableRow,
} from "./contract/table.ts"
import type { ColumnKey, PrimaryKeyNames } from "./contract/table-keys.ts"

export type TableRow<Table extends AnyTableSpec> = ContractTableRow<Table>

export type Bound<T> =
  | { readonly tag: "included"; readonly value: T }
  | { readonly tag: "excluded"; readonly value: T }
  | { readonly tag: "unbounded" }

export type Range<T> = {
  readonly from: Bound<T>
  readonly to: Bound<T>
}

export type {
  ColumnKey,
  PrimaryKeyNames,
  SinglePrimaryKeyName,
} from "./contract/table-keys.ts"

export const sameIndexColumns = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean =>
  left.length === right.length &&
  left.every((column) => right.includes(column)) &&
  right.every((column) => left.includes(column))

type UniqueConstraintSpec<Table extends AnyTableSpec> = Extract<
  Table["constraints"][number],
  { readonly kind: "unique" }
>

type ContainsAllColumns<
  Columns extends readonly string[],
  ConstraintColumns extends readonly string[],
> = Columns extends readonly [
  infer Head extends string,
  ...infer Tail extends readonly string[],
]
  ? Head extends ConstraintColumns[number]
    ? ContainsAllColumns<Tail, ConstraintColumns>
    : false
  : true

type IsSameColumnSet<
  Left extends readonly string[],
  Right extends readonly string[],
> = ContainsAllColumns<Left, Right> extends true
  ? ContainsAllColumns<Right, Left>
  : false

type HasExplicitUniqueConstraint<
  Table extends AnyTableSpec,
  Columns extends readonly string[],
> = true extends (
  UniqueConstraintSpec<Table> extends infer Constraint
    ? Constraint extends {
        readonly columns: infer ConstraintColumns extends readonly string[]
      }
      ? IsSameColumnSet<Columns, ConstraintColumns>
      : false
    : false
)
  ? true
  : false

type HasImplicitPrimaryKeyUniqueness<
  Table extends AnyTableSpec,
  Columns extends readonly string[],
> = Columns extends readonly [infer Only extends string]
  ? Only extends PrimaryKeyNames<Table>
    ? true
    : false
  : false

export type IsUniqueIndexColumns<
  Table extends AnyTableSpec,
  Columns extends readonly string[],
> = HasImplicitPrimaryKeyUniqueness<Table, Columns> extends true
  ? true
  : HasExplicitUniqueConstraint<Table, Columns>

export type ExplicitIndexSpec<Table extends AnyTableSpec> =
  Table["indexes"][number]

export type IndexPointTuple<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = Columns extends readonly [
  infer Head extends ColumnKey<Table>,
  ...infer Tail extends readonly ColumnKey<Table>[],
]
  ? readonly [
      FieldValue<Table["columns"][Head]>,
      ...IndexPointTuple<Table, Tail>,
    ]
  : readonly []

export type IndexPointObject<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = {
  readonly [Column in Columns[number]]: FieldValue<Table["columns"][Column]>
}

type CollapseIndexPoint<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Tuple extends readonly unknown[],
  IncludeObjectInputs extends boolean,
> = Tuple extends readonly [infer Only]
  ? Only
  : IncludeObjectInputs extends true
    ? Tuple | IndexPointObject<Table, Columns>
    : Tuple

export type IndexPoint<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  IncludeObjectInputs extends boolean,
> = CollapseIndexPoint<
  Table,
  Columns,
  IndexPointTuple<Table, Columns>,
  IncludeObjectInputs
>

export type StructuralRange<T> = {
  readonly from: Bound<T>
  readonly to: Bound<T>
}

export type IndexRangeMode = "native" | "structural"

type RangeInput<Mode extends IndexRangeMode, Value> = Mode extends "structural"
  ? StructuralRange<Value>
  : Range<Value>

type CompositeIndexRangeBounds<
  Tuple extends readonly unknown[],
  Mode extends IndexRangeMode,
  AllowFullWidthRange extends boolean,
  Prefix extends readonly unknown[] = readonly [],
> = Tuple extends readonly [infer Head, ...infer Tail]
  ? Tail extends readonly []
    ? readonly [
        ...Prefix,
        (
          | Head
          | (AllowFullWidthRange extends true ? RangeInput<Mode, Head> : never)
        ),
      ]
    :
        | readonly [...Prefix, Head | RangeInput<Mode, Head>]
        | CompositeIndexRangeBounds<
            Tail,
            Mode,
            AllowFullWidthRange,
            readonly [...Prefix, Head]
          >
  : never

type IndexRangeBounds<
  Tuple extends readonly unknown[],
  Mode extends IndexRangeMode,
  AllowFullWidthRange extends boolean,
> = Tuple extends readonly [infer Term]
  ? Term | RangeInput<Mode, Term>
  : CompositeIndexRangeBounds<Tuple, Mode, AllowFullWidthRange>

type Expand<T> = {
  readonly [K in keyof T]: T[K]
}

type CompositeIndexRangeObject<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Mode extends IndexRangeMode,
  AllowFullWidthRange extends boolean,
  Prefix extends Record<string, unknown> = {},
> = Columns extends readonly [
  infer Head extends ColumnKey<Table>,
  ...infer Tail extends readonly ColumnKey<Table>[],
]
  ? Tail extends readonly []
    ? Expand<
        Prefix & {
          readonly [Key in Head]:
            | FieldValue<Table["columns"][Head]>
            | (AllowFullWidthRange extends true
                ? RangeInput<Mode, FieldValue<Table["columns"][Head]>>
                : never)
        }
      >
    :
        | Expand<
            Prefix & {
              readonly [Key in Head]:
                | FieldValue<Table["columns"][Head]>
                | RangeInput<Mode, FieldValue<Table["columns"][Head]>>
            }
          >
        | CompositeIndexRangeObject<
            Table,
            Tail,
            Mode,
            AllowFullWidthRange,
            Prefix & {
              readonly [Key in Head]: FieldValue<Table["columns"][Head]>
            }
          >
  : never

export type IndexRange<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Mode extends IndexRangeMode,
  IncludeObjectInputs extends boolean,
  AllowFullWidthRange extends boolean = true,
> = Columns extends readonly [ColumnKey<Table>]
  ? IndexRangeBounds<IndexPointTuple<Table, Columns>, Mode, true>
  : IncludeObjectInputs extends true
    ?
        | IndexRangeBounds<
            IndexPointTuple<Table, Columns>,
            Mode,
            AllowFullWidthRange
          >
        | CompositeIndexRangeObject<Table, Columns, Mode, AllowFullWidthRange>
    : IndexRangeBounds<
        IndexPointTuple<Table, Columns>,
        Mode,
        AllowFullWidthRange
      >
