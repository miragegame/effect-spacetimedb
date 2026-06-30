import type {
  HandlerContext as NativeHttpHandlerCtx,
  Range,
  ReducerCtx as NativeReducerCtx,
  ProcedureCtx as NativeProcedureCtx,
  Random,
} from "spacetimedb/server"
import type { FieldOptionsOf, FieldValue } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import type { ServerQueryRoot } from "../query/types.ts"

export type TableKey<Module extends AnyModuleSpec> = keyof Module["tables"] &
  string

export type TableSpecOf<
  Module extends AnyModuleSpec,
  Key extends TableKey<Module>,
> = Module["tables"][Key]

type ColumnKey<Table extends AnyTableSpec> = keyof Table["columns"] & string

export type TableRow<Table extends AnyTableSpec> = {
  readonly [K in keyof Table["columns"]]: FieldValue<Table["columns"][K]>
}

type PrimaryKeyNames<Table extends AnyTableSpec> = {
  readonly [K in ColumnKey<Table>]: FieldOptionsOf<
    Table["columns"][K]
  >["primaryKey"] extends true
    ? K
    : never
}[ColumnKey<Table>]

type SinglePrimaryKeyName<Table extends AnyTableSpec> =
  PrimaryKeyNames<Table> extends infer Key extends string
    ? Exclude<PrimaryKeyNames<Table>, Key> extends never
      ? Key
      : never
    : never

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

type IsUniqueIndexColumns<
  Table extends AnyTableSpec,
  Columns extends readonly string[],
> = HasImplicitPrimaryKeyUniqueness<Table, Columns> extends true
  ? true
  : HasExplicitUniqueConstraint<Table, Columns>

type IndexPointTuple<
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

type CollapseSingleton<Tuple extends readonly unknown[]> =
  Tuple extends readonly [infer Only] ? Only : Tuple

type IndexPoint<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = CollapseSingleton<IndexPointTuple<Table, Columns>>

type CompositeIndexRangeBounds<
  Tuple extends readonly unknown[],
  Prefix extends readonly unknown[] = readonly [],
> = Tuple extends readonly [infer Head, ...infer Tail]
  ?
      | readonly [...Prefix, Head | Range<Head>]
      | (Tail extends readonly []
          ? never
          : CompositeIndexRangeBounds<Tail, readonly [...Prefix, Head]>)
  : never

type IndexRangeBounds<Tuple extends readonly unknown[]> =
  Tuple extends readonly [infer Term]
    ? Term | Range<Term>
    : CompositeIndexRangeBounds<Tuple>

type IndexRange<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = IndexRangeBounds<IndexPointTuple<Table, Columns>>

type UniqueAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = {
  readonly find: (
    value: IndexPoint<Table, Columns>,
  ) => TableRow<Table> | undefined
  readonly delete: (value: IndexPoint<Table, Columns>) => boolean
}

type PrimaryKeyAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = UniqueAccessorFromColumns<Table, Columns> & {
  readonly update: (row: TableRow<Table>) => TableRow<Table>
}

type ImplicitPrimaryKeyAccessor<
  Table extends AnyTableSpec,
  Name extends PrimaryKeyNames<Table>,
> = Name extends SinglePrimaryKeyName<Table>
  ? PrimaryKeyAccessorFromColumns<Table, readonly [Name]>
  : UniqueAccessorFromColumns<Table, readonly [Name]>

type ExplicitIndexSpec<Table extends AnyTableSpec> = Table["indexes"][number]

type RangeAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = {
  readonly filter: (
    range: IndexRange<Table, Columns>,
  ) => Iterable<TableRow<Table>>
  readonly delete: (range: IndexRange<Table, Columns>) => number
}

type PointAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = {
  readonly filter: (
    value: IndexPoint<Table, Columns>,
  ) => Iterable<TableRow<Table>>
  readonly delete: (value: IndexPoint<Table, Columns>) => number
}

type ExplicitIndexAccessor<
  Table extends AnyTableSpec,
  Index extends ExplicitIndexSpec<Table>,
> = Index extends {
  readonly columns: infer Columns extends readonly ColumnKey<Table>[]
  readonly algorithm: infer Algorithm
}
  ? IsUniqueIndexColumns<Table, Columns> extends true
    ? Columns extends readonly [SinglePrimaryKeyName<Table>]
      ? PrimaryKeyAccessorFromColumns<Table, Columns>
      : UniqueAccessorFromColumns<Table, Columns>
    : Algorithm extends "hash"
      ? PointAccessorFromColumns<Table, Columns>
      : RangeAccessorFromColumns<Table, Columns>
  : never

type TableHandle<Table extends AnyTableSpec> = {
  readonly count: () => bigint
  readonly iter: () => Iterable<TableRow<Table>>
  readonly insert: (row: TableRow<Table>) => TableRow<Table>
  readonly delete: (row: TableRow<Table>) => boolean
  readonly clear: () => bigint
} & {
  readonly [Name in PrimaryKeyNames<Table>]: ImplicitPrimaryKeyAccessor<
    Table,
    Name
  >
} & {
  readonly [Index in ExplicitIndexSpec<Table> as Index["name"] &
    string]: ExplicitIndexAccessor<Table, Index>
}

export type DbShape<Module extends AnyModuleSpec> = {
  readonly [Key in TableKey<Module>]-?: TableHandle<TableSpecOf<Module, Key>>
}

type NativeSchemaDef = {
  readonly tables: Record<string, never>
}

export type ServerSender = NativeReducerCtx<NativeSchemaDef>["sender"]
export type ServerIdentity = NativeReducerCtx<NativeSchemaDef>["identity"]
export type ServerTimestamp = NativeReducerCtx<NativeSchemaDef>["timestamp"]
export type ServerConnectionId =
  NativeReducerCtx<NativeSchemaDef>["connectionId"]
export type ServerSenderAuth = NativeReducerCtx<NativeSchemaDef>["senderAuth"]
export type ServerDatabaseIdentity =
  NativeHttpHandlerCtx<NativeSchemaDef>["identity"]
export type ServerRandom = Random
export type ServerUuid = ReturnType<
  NativeReducerCtx<NativeSchemaDef>["newUuidV4"]
>

type BaseCallableCtx = {
  readonly sender: ServerSender
  readonly identity: ServerIdentity
  readonly timestamp: ServerTimestamp
  readonly connectionId: ServerConnectionId
  readonly newUuidV4: () => ServerUuid
  readonly newUuidV7: () => ServerUuid
  readonly random: ServerRandom
}

export type BaseReducerCtx<Module extends AnyModuleSpec> = BaseCallableCtx & {
  readonly db: DbShape<Module>
  readonly senderAuth: ServerSenderAuth
}

type NativeProcedureHttp = NativeProcedureCtx<NativeSchemaDef> extends {
  readonly http: infer Http
}
  ? Http
  : {
      readonly fetch: (
        url: string,
        init?: unknown,
      ) => {
        readonly text: () => string
        readonly json: () => unknown
        readonly bytes: () => Uint8Array
      }
    }

export type ProcedureCtxLike<Module extends AnyModuleSpec> = BaseCallableCtx & {
  readonly http: NativeProcedureHttp
  readonly withTx: <A>(body: (ctx: BaseReducerCtx<Module>) => A) => A
}

export type HttpHandlerCtxLike<Module extends AnyModuleSpec> = {
  readonly timestamp: ServerTimestamp
  readonly http: NativeProcedureHttp
  readonly databaseIdentity: ServerDatabaseIdentity
  readonly withTx: <A>(body: (ctx: { readonly db: DbShape<Module> }) => A) => A
  readonly newUuidV4: () => ServerUuid
  readonly newUuidV7: () => ServerUuid
  readonly random: ServerRandom
}

export type ViewCtxLike<Module extends AnyModuleSpec> = {
  readonly sender: ServerSender
  readonly db: DbShape<Module>
  readonly from: ServerQueryRoot<Module>
}

export type AnonymousViewCtxLike<Module extends AnyModuleSpec> = {
  readonly db: DbShape<Module>
  readonly from: ServerQueryRoot<Module>
}

export type ServerReducerCtx<Module extends AnyModuleSpec> =
  BaseReducerCtx<Module>

export type ServerProcedureCtx<Module extends AnyModuleSpec> =
  ProcedureCtxLike<Module>

export type ServerHttpHandlerCtx<Module extends AnyModuleSpec> =
  HttpHandlerCtxLike<Module>

export type ServerSenderViewCtx<Module extends AnyModuleSpec> =
  ViewCtxLike<Module>

export type ServerAnonymousViewCtx<Module extends AnyModuleSpec> =
  AnonymousViewCtxLike<Module>
