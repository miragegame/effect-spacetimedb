import type { RowTypedQuery } from "spacetimedb"
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
  readonly build: () => TypedQuery<Row>
}

export type StdbPredicate<Table extends AnyTableSpec> = unknown & {
  readonly __table?: Table
}

export type StdbColumnExpr<
  Table extends AnyTableSpec,
  Col extends keyof TableRow<Table> & string,
> = {
  readonly eq: (value: TableRow<Table>[Col]) => StdbPredicate<Table>
  readonly ne: (value: TableRow<Table>[Col]) => StdbPredicate<Table>
  readonly lt: (value: TableRow<Table>[Col]) => StdbPredicate<Table>
  readonly lte: (value: TableRow<Table>[Col]) => StdbPredicate<Table>
  readonly gt: (value: TableRow<Table>[Col]) => StdbPredicate<Table>
  readonly gte: (value: TableRow<Table>[Col]) => StdbPredicate<Table>
}

export type StdbRowExpr<Table extends AnyTableSpec> = {
  readonly [Col in keyof TableRow<Table> & string]: StdbColumnExpr<Table, Col>
}

export type TypedQueryRelation<Table extends AnyTableSpec> = QueryRelation<
  TableRow<Table>
> & {
  readonly where: (
    predicate: (row: StdbRowExpr<Table>) => StdbPredicate<Table>,
  ) => TypedQueryRelation<Table>
}

export const isQueryRelation = (
  value: unknown,
): value is QueryRelation<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "toSql" in value &&
  "build" in value &&
  typeof value.toSql === "function" &&
  typeof value.build === "function"

export const buildQueryRelation = <Row>(
  query: QueryRelation<Row>,
): TypedQuery<Row> => query.build()

export type QueryRowOfType<Value extends AnyValueType> =
  Value extends ArrayValueType<infer Item>
    ? TypeOf<Item>
    : Value extends OptionValueType<infer Item>
      ? TypeOf<Item>
      : never

type QueryRelationOfTable<Table extends AnyTableSpec> =
  TypedQueryRelation<Table>

export type ServerQueryRoot<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["tables"] & string]: QueryRelationOfTable<
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

export type QueryInput<Row = unknown> = TypedQuery<Row>

export type QueryBuilderSource<Root> =
  | QueryInput
  | ReadonlyArray<QueryInput>
  | ((root: Root) => QueryInput | ReadonlyArray<QueryInput>)
