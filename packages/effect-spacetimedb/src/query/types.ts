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
import type {
  PublicEventTables,
  PublicPersistentTables,
  PublicViews,
} from "../module-projection.ts"

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

type PublicClientTables<Module extends AnyModuleSpec> =
  PublicPersistentTables<Module> & PublicEventTables<Module>

export type ClientTableQueryRoot<Module extends AnyModuleSpec> = {
  readonly [Key in keyof PublicClientTables<Module> &
    string]: QueryRelationOfTable<PublicClientTables<Module>[Key]>
}

/**
 * Views on the generated query-builder root, keyed the same way tables are: by
 * contract key. See `isCamelCaseCanonical` in `../contract/canonical-name.ts`
 * for why the contract key *is* the generated accessor key under every name
 * policy.
 */
export type ClientViewQueryRoot<Module extends AnyModuleSpec> = {
  readonly [Key in keyof PublicViews<Module> & string]: QueryRelation<
    ViewRow<PublicViews<Module>[Key]>
  >
}

export type ClientQueryRoot<Module extends AnyModuleSpec> =
  ClientTableQueryRoot<Module> & ClientViewQueryRoot<Module>

export type ViewQueryResult<View extends AnyViewSpec> = TypedQuery<
  QueryRowOfType<View["returns"]>
>

export type ViewRow<View extends AnyViewSpec> = QueryRowOfType<View["returns"]>
