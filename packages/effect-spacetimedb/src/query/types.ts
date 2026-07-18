import type {
  ConnectionId,
  Identity,
  RowTypedQuery,
  Timestamp,
} from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec, TableRow } from "../contract/table.ts"
import type {
  AnyValueType,
  ArrayValueType,
  OptionValueType,
  TypeOf,
} from "../contract/type.ts"
import type { AnyViewSpec } from "../contract/view.ts"

export type TypedQuery<Row = unknown> = RowTypedQuery<Row, unknown>

export type QueryRelation<Row> = TypedQuery<Row> & {
  readonly toSql: () => string
}

export type StdbLiteralColumn =
  | string
  | number
  | bigint
  | boolean
  | Identity
  | Timestamp
  | ConnectionId

declare const StdbPredicateTypeId: unique symbol

export type StdbPredicate<Table extends AnyTableSpec> = {
  readonly [StdbPredicateTypeId]: Table
}

export type StdbColumnExpr<
  Table extends AnyTableSpec,
  Col extends keyof TableRow<Table> & string,
> = {
  readonly eq: (
    value: TableRow<Table>[Col] & StdbLiteralColumn,
  ) => StdbPredicate<Table>
  readonly ne: (
    value: TableRow<Table>[Col] & StdbLiteralColumn,
  ) => StdbPredicate<Table>
  readonly lt: (
    value: TableRow<Table>[Col] & StdbLiteralColumn,
  ) => StdbPredicate<Table>
  readonly lte: (
    value: TableRow<Table>[Col] & StdbLiteralColumn,
  ) => StdbPredicate<Table>
  readonly gt: (
    value: TableRow<Table>[Col] & StdbLiteralColumn,
  ) => StdbPredicate<Table>
  readonly gte: (
    value: TableRow<Table>[Col] & StdbLiteralColumn,
  ) => StdbPredicate<Table>
}

export type StdbRowExpr<Table extends AnyTableSpec> = {
  readonly [Col in keyof TableRow<Table> &
    string as TableRow<Table>[Col] extends StdbLiteralColumn
    ? Col
    : never]: StdbColumnExpr<Table, Col>
}

export type TypedQueryRelation<Table extends AnyTableSpec> = QueryRelation<
  TableRow<Table>
> & {
  readonly where: (
    predicate: (row: StdbRowExpr<Table>) => StdbPredicate<Table>,
  ) => TypedQueryRelation<Table>
}

export type QueryRowOfType<Value extends AnyValueType> =
  Value extends ArrayValueType<infer Item>
    ? TypeOf<Item>
    : Value extends OptionValueType<infer Item>
      ? TypeOf<Item>
      : never

type QueryRelationOfTable<Table extends AnyTableSpec> =
  TypedQueryRelation<Table>

type ServerQueryRelationOfTable<Table extends AnyTableSpec> =
  QueryRelationOfTable<Table> & {
    readonly build: () => TypedQuery<TableRow<Table>>
  }

export type ServerQueryRoot<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["tables"] & string]: ServerQueryRelationOfTable<
    Module["tables"][Key]
  >
}

export type ClientQueryRoot<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["tables"] &
    string as Module["tables"][Key]["public"] extends true
    ? Key
    : never]: QueryRelationOfTable<Module["tables"][Key]>
}

export type ViewQueryResult<View extends AnyViewSpec> = TypedQuery<
  QueryRowOfType<View["returns"]>
>

export type ViewRow<View extends AnyViewSpec> = QueryRowOfType<View["returns"]>
