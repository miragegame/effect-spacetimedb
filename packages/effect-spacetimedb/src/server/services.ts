import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import * as Duration from "effect/Duration"
import { TimeDuration } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import type { OutboxMetadata } from "../contract/outbox-table.ts"
import type {
  AnyRemoteInterface,
  PeerIdentity,
} from "../contract/remote-interface.ts"
import type { OutboxRowTooLargeError } from "../contract/outbox-table.ts"
import type { BodyInit, Headers } from "../http-primitives.ts"
import type {
  ColumnKey,
  PrimaryKeyNames,
  SinglePrimaryKeyName,
} from "../contract/table-keys.ts"
import type { FieldOptionsOf } from "../contract/field.ts"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"
import { errorName, hostErrorName, HostErrorNames } from "./host-abi-runtime.ts"
import type {
  ExplicitIndexSpec,
  IndexPoint,
  IndexRange,
  IsUniqueIndexColumns,
  TableRow,
} from "../table-index-typing.ts"
import {
  type HostFailure,
  StdbHostCallError,
  StdbUniqueAlreadyExistsError,
  StdbAutoIncOverflowError,
  StdbNoSuchRowError,
  StdbScheduleDelayTooLongError,
} from "../host-failure.ts"
export {
  type HostFailure,
  isStdbHostFailure,
  StdbSenderError,
  StdbHostCallError,
  StdbUniqueAlreadyExistsError,
  StdbAutoIncOverflowError,
  StdbNoSuchRowError,
  StdbScheduleDelayTooLongError,
} from "../host-failure.ts"

export const toHostFailure = (op: string, cause: unknown): HostFailure => {
  const knownHostError = hostErrorName(cause)
  if (knownHostError !== undefined) {
    if (knownHostError === HostErrorNames.UniqueAlreadyExists) {
      return new StdbUniqueAlreadyExistsError({ op, cause })
    }
    if (knownHostError === HostErrorNames.AutoIncOverflow) {
      return new StdbAutoIncOverflowError({ op, cause })
    }
    if (knownHostError === HostErrorNames.NoSuchRow) {
      return new StdbNoSuchRowError({ op, cause })
    }
    if (knownHostError === HostErrorNames.ScheduleAtDelayTooLong) {
      return new StdbScheduleDelayTooLongError({ op, cause })
    }
  }

  const unknownHostErrorName = errorName(cause)
  if (unknownHostErrorName !== undefined) {
    return new StdbHostCallError({
      op,
      cause,
      hostErrorName: unknownHostErrorName,
    })
  }

  return new StdbHostCallError({ op, cause })
}

export class StdbTableOperationDefect extends Data.TaggedError(
  "StdbTableOperationDefect",
)<{
  readonly table: string
  readonly op: string
  readonly cause: unknown
}> {
  override readonly message =
    `SpaceTimeDB table ${this.table} failed at ${this.op}`
}

const HandlerAsyncNotAllowedDefectTypeId = errorTypeId(
  "HandlerAsyncNotAllowedDefect",
)
export class HandlerAsyncNotAllowedDefect extends Data.TaggedError(
  "HandlerAsyncNotAllowedDefect",
) {
  readonly [HandlerAsyncNotAllowedDefectTypeId] =
    HandlerAsyncNotAllowedDefectTypeId
  static is = hasErrorTypeId<HandlerAsyncNotAllowedDefect>(
    HandlerAsyncNotAllowedDefectTypeId,
  )

  override readonly message =
    "Asynchronous work (Effect.sleep, Effect.promise, timers) is not available in SpaceTimeDB reducers, procedures and views: a handler runs to completion inside one synchronous host call." as const
}

export class RuntimeLayerAsyncDefect extends Data.TaggedError(
  "RuntimeLayerAsyncDefect",
) {
  override readonly message =
    "The server runtime layer requires asynchronous initialization, which is unsupported by the synchronous SpaceTimeDB host." as const
}

export class CallableInterruptedDefect extends Data.TaggedError(
  "CallableInterruptedDefect",
)<{
  readonly kind: "reducer" | "procedure" | "view" | "lifecycle"
  readonly cause: unknown
}> {
  override readonly message =
    `SpaceTimeDB ${this.kind} invocation was interrupted`
}

export class StdbDbSchemaMismatchDefect extends Data.TaggedError(
  "StdbDbSchemaMismatchDefect",
)<{
  readonly module: string
  readonly missingTables: ReadonlyArray<string>
  readonly availableTables: ReadonlyArray<string>
}> {
  override readonly message =
    `SpaceTimeDB database schema mismatch for module ${this.module}: missing table(s): ${this.missingTables.join(", ")}; available table(s): ${
      this.availableTables.length === 0
        ? "(none)"
        : this.availableTables.join(", ")
    }`
}

export class HandlerGlobalRandomNotAllowedDefect extends Data.TaggedError(
  "HandlerGlobalRandomNotAllowedDefect",
) {
  override readonly message =
    "Global Math.random is not available in deterministic SpaceTimeDB handlers. Use Effect.Random or ctx.random instead." as const
}

export class HandlerWallClockNotAllowedDefect extends Data.TaggedError(
  "HandlerWallClockNotAllowedDefect",
) {
  override readonly message =
    "Wall-clock time (Date.now / new Date()) is not available in deterministic SpaceTimeDB handlers. Use ctx.timestamp, or Effect Clock/DateTime (wired to the transaction timestamp), instead." as const
}

export class StdbDeclaredErrorEncodingError extends Data.TaggedError(
  "StdbDeclaredErrorEncodingError",
)<{
  readonly callable: "reducer" | "procedure"
  readonly cause: unknown
}> {
  override readonly message =
    `A ${this.callable}'s declared error could not be encoded`
}

export type HttpResponseLike = {
  readonly status: number
  readonly text: () => string
  readonly json: () => unknown
  readonly bytes: () => Uint8Array
}

export type ProcedureHttpHeadersInit =
  | Array<[string, string]>
  | Record<string, string>
  | Headers

export type ProcedureHttpRequestOptions = {
  readonly body?: BodyInit | null
  readonly headers?: ProcedureHttpHeadersInit
  readonly method?: string
  readonly timeout?: Duration.Input
}

export type NativeProcedureHttpRequestOptions = Omit<
  ProcedureHttpRequestOptions,
  "timeout"
> & {
  readonly timeout?: TimeDuration
}

export type RawProcedureHttp = {
  readonly fetch: (
    url: string,
    init?: NativeProcedureHttpRequestOptions,
  ) => HttpResponseLike
}

export type EffectHttpClient = {
  readonly fetch: (
    url: string,
    init?: ProcedureHttpRequestOptions,
  ) => Effect.Effect<HttpResponseLike, StdbHostCallError>
  readonly text: (
    response: HttpResponseLike,
  ) => Effect.Effect<string, StdbHostCallError>
  readonly json: <A = unknown>(
    response: HttpResponseLike,
  ) => Effect.Effect<A, StdbHostCallError>
  readonly bytes: (
    response: HttpResponseLike,
  ) => Effect.Effect<Uint8Array, StdbHostCallError>
}

/** Recoverable host rejections across table writes. */
export type DbFailure = Exclude<HostFailure, StdbHostCallError>
export type InsertFailure<Table extends AnyTableSpec> =
  | (true extends Table["scheduled"] ? StdbScheduleDelayTooLongError : never)
  | (string extends ColumnKey<Table>
      ? StdbAutoIncOverflowError | StdbUniqueAlreadyExistsError
      : {
          [K in ColumnKey<Table>]:
            | (FieldOptionsOf<Table["columns"][K]>["autoInc"] extends true
                ? StdbAutoIncOverflowError
                : never)
            | (FieldOptionsOf<Table["columns"][K]> extends
                | { primaryKey: true }
                | { unique: true }
                ? StdbUniqueAlreadyExistsError
                : never)
        }[ColumnKey<Table>])
  | (Table["constraints"][number] extends never
      ? never
      : StdbUniqueAlreadyExistsError)

export type DbEffect<A> = Effect.Effect<A>
export type DbStream<A> = Stream.Stream<A>
export type ScheduledInsertRow<Table extends AnyTableSpec> = Omit<
  TableRow<Table>,
  "scheduledId"
>

type UniqueAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Readonly extends boolean,
> = {
  readonly find: (
    value: IndexPoint<Table, Columns, true>,
  ) => DbEffect<TableRow<Table> | undefined>
  readonly exists: (
    value: IndexPoint<Table, Columns, true>,
  ) => DbEffect<boolean>
  readonly findOrFail: <E>(
    value: IndexPoint<Table, Columns, true>,
    makeError: (value: IndexPoint<Table, Columns, true>) => E,
  ) => Effect.Effect<TableRow<Table>, E>
} & (Readonly extends true
  ? {}
  : {
      readonly delete: (
        value: IndexPoint<Table, Columns, true>,
      ) => DbEffect<boolean>
    })

type PrimaryKeyAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Readonly extends boolean,
> = UniqueAccessorFromColumns<Table, Columns, Readonly> &
  (Readonly extends true
    ? {}
    : {
        readonly update: (
          row: TableRow<Table>,
        ) => Effect.Effect<
          TableRow<Table>,
          InsertFailure<Table> | StdbNoSuchRowError
        >
      })

type ImplicitPrimaryKeyAccessor<
  Table extends AnyTableSpec,
  Name extends PrimaryKeyNames<Table>,
  Readonly extends boolean,
> = Name extends SinglePrimaryKeyName<Table>
  ? PrimaryKeyAccessorFromColumns<Table, readonly [Name], Readonly>
  : UniqueAccessorFromColumns<Table, readonly [Name], Readonly>

type RangeAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Readonly extends boolean,
> = {
  readonly filterToArray: (
    range: IndexRange<Table, Columns, "structural", true>,
  ) => DbEffect<ReadonlyArray<TableRow<Table>>>
  readonly filterStream: (
    range: IndexRange<Table, Columns, "structural", true>,
  ) => DbStream<TableRow<Table>>
  readonly unsafe: {
    readonly filter: (
      range: IndexRange<Table, Columns, "structural", true>,
    ) => DbEffect<Iterable<TableRow<Table>>>
  }
} & (Readonly extends true
  ? {}
  : {
      readonly delete: (
        range: IndexRange<Table, Columns, "structural", true>,
      ) => DbEffect<number>
    })

type PointAccessorFromColumns<
  Table extends AnyTableSpec,
  Columns extends readonly ColumnKey<Table>[],
  Readonly extends boolean,
> = {
  readonly filterToArray: (
    value: IndexPoint<Table, Columns, true>,
  ) => DbEffect<ReadonlyArray<TableRow<Table>>>
  readonly filterStream: (
    value: IndexPoint<Table, Columns, true>,
  ) => DbStream<TableRow<Table>>
  readonly unsafe: {
    readonly filter: (
      value: IndexPoint<Table, Columns, true>,
    ) => DbEffect<Iterable<TableRow<Table>>>
  }
} & (Readonly extends true
  ? {}
  : {
      readonly delete: (
        value: IndexPoint<Table, Columns, true>,
      ) => DbEffect<number>
    })

type ExplicitIndexAccessor<
  Table extends AnyTableSpec,
  Index extends ExplicitIndexSpec<Table>,
  Readonly extends boolean,
> = Index extends {
  readonly columns: infer Columns extends readonly ColumnKey<Table>[]
  readonly algorithm: infer Algorithm
}
  ? IsUniqueIndexColumns<Table, Columns> extends true
    ? Columns extends readonly [SinglePrimaryKeyName<Table>]
      ? PrimaryKeyAccessorFromColumns<Table, Columns, Readonly>
      : UniqueAccessorFromColumns<Table, Columns, Readonly>
    : Algorithm extends "hash"
      ? PointAccessorFromColumns<Table, Columns, Readonly>
      : RangeAccessorFromColumns<Table, Columns, Readonly>
  : never

export type TableAccessors<
  Table extends AnyTableSpec,
  Readonly extends boolean,
> = {
  readonly [Name in PrimaryKeyNames<Table>]: ImplicitPrimaryKeyAccessor<
    Table,
    Name,
    Readonly
  >
} & {
  readonly [Index in ExplicitIndexSpec<Table> as Index["name"] &
    string]: ExplicitIndexAccessor<Table, Index, Readonly>
}

/**
 * What a sender passes to an outbox insert: the target peer, the receiver's
 * parameters and any local columns. `msgId` and `enqueuedAt` are filled in.
 */
export type OutboxInsertRow<
  Table extends AnyTableSpec,
  Interface extends AnyRemoteInterface,
> = Omit<TableRow<Table>, "msgId" | "enqueuedAt" | "target"> & {
  readonly target: PeerIdentity<Interface>
}

/**
 * An outbox: insert-only, with reads and read-only lookups (`byTarget` among
 * them) for inspection. The host deletes a row when its settle reducer runs.
 */
export type OutboxTableHandle<
  Table extends AnyTableSpec,
  Interface extends AnyRemoteInterface,
  Readonly extends boolean,
> = {
  readonly count: () => DbEffect<bigint>
  readonly first: () => DbEffect<TableRow<Table> | undefined>
  readonly toArray: () => DbEffect<ReadonlyArray<TableRow<Table>>>
  readonly stream: () => DbStream<TableRow<Table>>
  readonly unsafe: {
    readonly iter: () => DbEffect<Iterable<TableRow<Table>>>
  }
} & (Readonly extends true
  ? {}
  : {
      readonly insert: (
        row: OutboxInsertRow<Table, Interface>,
      ) => Effect.Effect<
        TableRow<Table>,
        OutboxRowTooLargeError | InsertFailure<Table>
      >
    }) &
  TableAccessors<Table, true>

export type EffectTableHandle<
  Table extends AnyTableSpec,
  Readonly extends boolean,
> = {
  readonly count: () => DbEffect<bigint>
  readonly first: () => DbEffect<TableRow<Table> | undefined>
  readonly toArray: () => DbEffect<ReadonlyArray<TableRow<Table>>>
  readonly stream: () => DbStream<TableRow<Table>>
  readonly unsafe: {
    readonly iter: () => DbEffect<Iterable<TableRow<Table>>>
  }
} & (Readonly extends true
  ? {}
  : {
      readonly insert: (
        row: TableRow<Table>,
      ) => Effect.Effect<TableRow<Table>, InsertFailure<Table>>
    } & (Table["scheduled"] extends true
      ? {
          readonly schedule: (
            row: ScheduledInsertRow<Table>,
          ) => Effect.Effect<TableRow<Table>, InsertFailure<Table>>
        }
      : {}) & {
        readonly insertAll: (
          rows: Iterable<TableRow<Table>>,
        ) => Effect.Effect<ReadonlyArray<TableRow<Table>>, InsertFailure<Table>>
        readonly delete: (row: TableRow<Table>) => DbEffect<boolean>
        readonly clear: () => DbEffect<bigint>
      }) &
  TableAccessors<Table, Readonly>

/** An outbox's handle, or the ordinary handle of any other table. */
export type TableHandleFor<
  Table extends AnyTableSpec,
  Readonly extends boolean,
> = Table extends {
  readonly outbox: OutboxMetadata<infer Interface>
}
  ? OutboxTableHandle<Table, Interface, Readonly>
  : EffectTableHandle<Table, Readonly>

export type DbHandleFor<Tables extends Record<string, AnyTableSpec>> = {
  readonly [Key in keyof Tables]-?: TableHandleFor<Tables[Key], false>
}

export type ReadonlyDbHandleFor<Tables extends Record<string, AnyTableSpec>> = {
  readonly [Key in keyof Tables]-?: TableHandleFor<Tables[Key], true>
}

/** Each db.<key> for an Effect mount exposes its child's table handles with the enclosing database's access mode. */
export type MountedDb<
  Module extends AnyModuleSpec,
  ReadOnly extends boolean,
> = {
  readonly [Key in keyof NonNullable<Module["mounts"]> as NonNullable<
    Module["mounts"]
  >[Key] extends { readonly kind: "moduleMount" }
    ? Key
    : never]: NonNullable<Module["mounts"]>[Key] extends {
    readonly module: infer Child extends AnyModuleSpec
  }
    ? ReadOnly extends true
      ? ReadonlyEffectDbView<Child>
      : EffectDbView<Child>
    : never
}
/** Writable handles for local tables and nested Effect module mounts in this transaction. */
export type EffectDbView<Module extends AnyModuleSpec> = keyof NonNullable<
  Module["mounts"]
> extends never
  ? DbHandleFor<Module["tables"]>
  : DbHandleFor<Module["tables"]> & MountedDb<Module, false>

/** Read-only handles for local tables and Effect module mounts visible to this view. */
export type ReadonlyEffectDbView<Module extends AnyModuleSpec> =
  keyof NonNullable<Module["mounts"]> extends never
    ? ReadonlyDbHandleFor<Module["tables"]>
    : ReadonlyDbHandleFor<Module["tables"]> & MountedDb<Module, true>

export const wrapHttp = (ctx: unknown): EffectHttpClient => {
  const http = ctx as RawProcedureHttp

  return {
    fetch: (url, init) =>
      Effect.try({
        try: () => {
          if (init === undefined) return http.fetch(url)
          const { timeout, ...request } = init
          if (timeout === undefined) return http.fetch(url, request)
          const duration = Duration.fromInputUnsafe(timeout)
          if (Duration.equals(duration, Duration.infinity))
            return http.fetch(url, request)
          return http.fetch(url, {
            ...request,
            timeout: new TimeDuration(
              Duration.toNanosUnsafe(duration) / 1_000n,
            ),
          })
        },
        catch: (cause) => new StdbHostCallError({ op: "http.fetch", cause }),
      }),
    text: (response) =>
      Effect.try({
        try: () => response.text(),
        catch: (cause) => new StdbHostCallError({ op: "http.text", cause }),
      }),
    json: <A = unknown>(response: HttpResponseLike) =>
      Effect.try({
        try: () => response.json() as A,
        catch: (cause) => new StdbHostCallError({ op: "http.json", cause }),
      }),
    bytes: (response) =>
      Effect.try({
        try: () => response.bytes(),
        catch: (cause) => new StdbHostCallError({ op: "http.bytes", cause }),
      }),
  }
}
