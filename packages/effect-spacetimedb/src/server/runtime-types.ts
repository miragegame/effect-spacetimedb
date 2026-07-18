import type { ConnectionId, Identity, Timestamp, Uuid } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import type {
  ColumnKey,
  PrimaryKeyNames,
  SinglePrimaryKeyName,
} from "../contract/table-keys.ts"
import type { ServerQueryRoot } from "../query/types.ts"
import type {
  ExplicitIndexSpec,
  IndexPoint,
  IndexRange,
  IsUniqueIndexColumns,
  TableRow,
} from "../table-index-typing.ts"

export type { TableRow } from "../table-index-typing.ts"

export type TableKey<Module extends AnyModuleSpec> = keyof Module["tables"] &
  string

export type TableSpecOf<
  Module extends AnyModuleSpec,
  Key extends TableKey<Module>,
> = Module["tables"][Key]

type UniqueAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = {
  readonly find: (
    value: IndexPoint<Table, Columns, false>,
  ) => TableRow<Table> | undefined
  readonly delete: (value: IndexPoint<Table, Columns, false>) => boolean
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

type RangeAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = {
  readonly filter: (
    range: IndexRange<Table, Columns, "native", false, false>,
  ) => Iterable<TableRow<Table>>
  readonly delete: (
    range: IndexRange<Table, Columns, "native", false, false>,
  ) => number
}

type PointAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
> = {
  readonly filter: (
    value: IndexPoint<Table, Columns, false>,
  ) => Iterable<TableRow<Table>>
  readonly delete: (value: IndexPoint<Table, Columns, false>) => number
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

export interface ServerSender extends Identity {}
export interface ServerIdentity extends Identity {}
export interface ServerTimestamp extends Timestamp {}
export type ServerConnectionId = ConnectionId | null
export interface ServerDatabaseIdentity extends Identity {}
export interface ServerUuid extends Uuid {}

type ServerJsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<ServerJsonValue>
  | { readonly [key: string]: ServerJsonValue }

export type ServerJwtClaims = {
  readonly rawPayload: string
  readonly subject: string
  readonly issuer: string
  readonly audience: ReadonlyArray<string>
  readonly identity: Identity
  readonly fullPayload: { readonly [key: string]: ServerJsonValue }
}

export type ServerSenderAuth = Readonly<{
  readonly isInternal: boolean
  readonly hasJWT: boolean
  readonly jwt: ServerJwtClaims | null
}>

type IntArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array

export type ServerRandom = {
  (): number
  fill<T extends IntArray>(array: T): T
  uint32(): number
  integerInRange(min: number, max: number): number
  bigintInRange(min: bigint, max: bigint): bigint
}

type BaseCallableCtx = {
  readonly sender: ServerSender
  readonly databaseIdentity: ServerDatabaseIdentity
  /** @deprecated Use `databaseIdentity` instead. */
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

type NativeProcedureHttp = {
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
