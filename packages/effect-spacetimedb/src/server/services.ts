import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import type {
  ColumnKey,
  PrimaryKeyNames,
  SinglePrimaryKeyName,
} from "../contract/table-keys.ts"
import { StdbDecodeError } from "../decode-error.ts"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"
import { errorName, hostErrorName, HostErrorNames } from "./host-abi-runtime.ts"
import type {
  ExplicitIndexSpec,
  IndexPoint,
  IndexRange,
  IsUniqueIndexColumns,
  TableRow,
} from "../table-index-typing.ts"

const StdbHostCallErrorTypeId = errorTypeId("StdbHostCallError")
export class StdbHostCallError extends Data.TaggedError("StdbHostCallError")<{
  readonly op: string
  readonly cause: unknown
  readonly hostErrorName?: string
}> {
  readonly [StdbHostCallErrorTypeId] = StdbHostCallErrorTypeId
  static is = hasErrorTypeId<StdbHostCallError>(StdbHostCallErrorTypeId)
}

const StdbUniqueAlreadyExistsErrorTypeId = errorTypeId(
  "StdbUniqueAlreadyExistsError",
)
export class StdbUniqueAlreadyExistsError extends Data.TaggedError(
  "StdbUniqueAlreadyExistsError",
)<{
  readonly op: string
  readonly cause: unknown
}> {
  readonly [StdbUniqueAlreadyExistsErrorTypeId] =
    StdbUniqueAlreadyExistsErrorTypeId
  static is = hasErrorTypeId<StdbUniqueAlreadyExistsError>(
    StdbUniqueAlreadyExistsErrorTypeId,
  )
}

const StdbAutoIncOverflowErrorTypeId = errorTypeId("StdbAutoIncOverflowError")
export class StdbAutoIncOverflowError extends Data.TaggedError(
  "StdbAutoIncOverflowError",
)<{
  readonly op: string
  readonly cause: unknown
}> {
  readonly [StdbAutoIncOverflowErrorTypeId] = StdbAutoIncOverflowErrorTypeId
  static is = hasErrorTypeId<StdbAutoIncOverflowError>(
    StdbAutoIncOverflowErrorTypeId,
  )
}

const StdbNoSuchRowErrorTypeId = errorTypeId("StdbNoSuchRowError")
export class StdbNoSuchRowError extends Data.TaggedError("StdbNoSuchRowError")<{
  readonly op: string
  readonly cause: unknown
}> {
  readonly [StdbNoSuchRowErrorTypeId] = StdbNoSuchRowErrorTypeId
  static is = hasErrorTypeId<StdbNoSuchRowError>(StdbNoSuchRowErrorTypeId)
}

const StdbScheduleDelayTooLongErrorTypeId = errorTypeId(
  "StdbScheduleDelayTooLongError",
)
export class StdbScheduleDelayTooLongError extends Data.TaggedError(
  "StdbScheduleDelayTooLongError",
)<{
  readonly op: string
  readonly cause: unknown
}> {
  readonly [StdbScheduleDelayTooLongErrorTypeId] =
    StdbScheduleDelayTooLongErrorTypeId
  static is = hasErrorTypeId<StdbScheduleDelayTooLongError>(
    StdbScheduleDelayTooLongErrorTypeId,
  )
}

const StdbServerDisposedErrorTypeId = errorTypeId("StdbServerDisposedError")
export class StdbServerDisposedError extends Data.TaggedError(
  "StdbServerDisposedError",
)<{
  readonly module: string
  readonly handler: string
  readonly kind: "reducer" | "procedure" | "view" | "lifecycle"
}> {
  readonly [StdbServerDisposedErrorTypeId] = StdbServerDisposedErrorTypeId
  static is = hasErrorTypeId<StdbServerDisposedError>(
    StdbServerDisposedErrorTypeId,
  )
}

export type StdbHostFailure =
  | StdbHostCallError
  | StdbUniqueAlreadyExistsError
  | StdbAutoIncOverflowError
  | StdbNoSuchRowError
  | StdbScheduleDelayTooLongError

export const isStdbHostFailure = (error: unknown): error is StdbHostFailure =>
  StdbHostCallError.is(error) ||
  StdbUniqueAlreadyExistsError.is(error) ||
  StdbAutoIncOverflowError.is(error) ||
  StdbNoSuchRowError.is(error) ||
  StdbScheduleDelayTooLongError.is(error)

export const toHostFailure = (op: string, cause: unknown): StdbHostFailure => {
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

export const hostCall = <A>(
  op: string,
  run: () => A,
): Effect.Effect<A, StdbHostFailure> =>
  Effect.try({
    try: run,
    catch: (cause) => toHostFailure(op, cause),
  })

const ReducerAsyncNotAllowedErrorTypeId = errorTypeId(
  "ReducerAsyncNotAllowedError",
)
export class ReducerAsyncNotAllowedError extends Data.TaggedError(
  "ReducerAsyncNotAllowedError",
) {
  readonly [ReducerAsyncNotAllowedErrorTypeId] =
    ReducerAsyncNotAllowedErrorTypeId
  static is = hasErrorTypeId<ReducerAsyncNotAllowedError>(
    ReducerAsyncNotAllowedErrorTypeId,
  )
}

export class RuntimeLayerAsyncError extends Data.TaggedError(
  "RuntimeLayerAsyncError",
) {
  override readonly message =
    "The server runtime layer requires asynchronous initialization, which is unsupported by the synchronous SpaceTimeDB host." as const
}

export class CallableInterruptedError extends Data.TaggedError(
  "CallableInterruptedError",
)<{
  readonly kind: "reducer" | "procedure" | "view" | "lifecycle"
  readonly cause: unknown
}> {
  override get message(): string {
    return `SpaceTimeDB ${this.kind} invocation was interrupted`
  }
}

export class StdbDbSchemaMismatchError extends Data.TaggedError(
  "StdbDbSchemaMismatchError",
)<{
  readonly module: string
  readonly missingTables: ReadonlyArray<string>
  readonly availableTables: ReadonlyArray<string>
}> {
  override get message(): string {
    const missing = this.missingTables.join(", ")
    const available =
      this.availableTables.length === 0
        ? "(none)"
        : this.availableTables.join(", ")
    return `SpaceTimeDB database schema mismatch for module ${this.module}: missing table(s): ${missing}; available table(s): ${available}`
  }
}

export class ReducerGlobalRandomNotAllowedError extends Data.TaggedError(
  "ReducerGlobalRandomNotAllowedError",
) {
  override readonly message =
    "Global Math.random is not available in SpaceTimeDB reducers. Use Effect.Random or ctx.random instead." as const
}

export class ReducerWallClockNotAllowedError extends Data.TaggedError(
  "ReducerWallClockNotAllowedError",
) {
  override readonly message =
    "Wall-clock time (Date.now / new Date()) is not available in SpaceTimeDB reducers. Use ctx.timestamp, or Effect Clock/DateTime (wired to the transaction timestamp), instead." as const
}

const StdbSenderFailureTypeId = errorTypeId("StdbSenderFailure")
export class StdbSenderFailure extends Data.TaggedError("StdbSenderFailure")<{
  readonly value: string
}> {
  readonly [StdbSenderFailureTypeId] = StdbSenderFailureTypeId
  static is = hasErrorTypeId<StdbSenderFailure>(StdbSenderFailureTypeId)
}

export class StdbDeclaredErrorEncodingFailure extends Data.TaggedError(
  "StdbDeclaredErrorEncodingFailure",
)<{
  readonly callable: "reducer" | "procedure"
  readonly cause: unknown
}> {}

export type HttpResponseLike = {
  readonly text: () => string
  readonly json: () => unknown
  readonly bytes: () => Uint8Array
}

export type RawProcedureHttp = {
  readonly fetch: (url: string, init?: unknown) => HttpResponseLike
}

export type EffectHttpClient = {
  readonly fetch: (
    ...args: Parameters<RawProcedureHttp["fetch"]>
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

export type DbFailure = StdbHostFailure | StdbDecodeError
type DbEffect<A> = Effect.Effect<A, DbFailure>
type DbStream<A> = Stream.Stream<A, DbFailure>
type ScheduledInsertRow<Table extends AnyTableSpec> = Omit<
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
  ) => Effect.Effect<TableRow<Table>, E | DbFailure>
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
        readonly replace: (row: TableRow<Table>) => DbEffect<TableRow<Table>>
        readonly update: (row: TableRow<Table>) => DbEffect<TableRow<Table>>
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
    range: IndexRange<Table, Columns, "structural", true, false>,
  ) => DbEffect<ReadonlyArray<TableRow<Table>>>
  readonly filterStream: (
    range: IndexRange<Table, Columns, "structural", true, false>,
  ) => DbStream<TableRow<Table>>
  readonly unsafe: {
    readonly filter: (
      range: IndexRange<Table, Columns, "structural", true, false>,
    ) => DbEffect<Iterable<TableRow<Table>>>
  }
} & (Readonly extends true
  ? {}
  : {
      readonly delete: (
        range: IndexRange<Table, Columns, "structural", true, false>,
      ) => DbEffect<number>
      readonly deleteAll: (
        range: IndexRange<Table, Columns, "structural", true, false>,
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

type TableAccessors<Table extends AnyTableSpec, Readonly extends boolean> = {
  readonly [Name in PrimaryKeyNames<Table>]: ImplicitPrimaryKeyAccessor<
    Table,
    Name,
    Readonly
  >
} & {
  readonly [Index in ExplicitIndexSpec<Table> as Index["name"] &
    string]: ExplicitIndexAccessor<Table, Index, Readonly>
}

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
      readonly insert: (row: TableRow<Table>) => DbEffect<TableRow<Table>>
    } & (Table["scheduled"] extends true
      ? {
          readonly schedule: (
            row: ScheduledInsertRow<Table>,
          ) => DbEffect<TableRow<Table>>
        }
      : {}) & {
        readonly insertAll: (
          rows: Iterable<TableRow<Table>>,
        ) => DbEffect<ReadonlyArray<TableRow<Table>>>
        readonly delete: (row: TableRow<Table>) => DbEffect<boolean>
        readonly clear: () => DbEffect<bigint>
      }) &
  TableAccessors<Table, Readonly>

export type DbHandleFor<Tables extends Record<string, AnyTableSpec>> = {
  readonly [Key in keyof Tables]-?: EffectTableHandle<Tables[Key], false>
}

export type ReadonlyDbHandleFor<Tables extends Record<string, AnyTableSpec>> = {
  readonly [Key in keyof Tables]-?: EffectTableHandle<Tables[Key], true>
}

export type EffectDbView<Module extends AnyModuleSpec> = DbHandleFor<
  Module["tables"]
>

export type ReadonlyEffectDbView<Module extends AnyModuleSpec> =
  ReadonlyDbHandleFor<Module["tables"]>

export const wrapHttp = (ctx: unknown): EffectHttpClient => {
  const http = ctx as RawProcedureHttp

  return {
    fetch: (...args) =>
      Effect.try({
        try: () => http.fetch(...args),
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
