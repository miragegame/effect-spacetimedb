import * as Data from "effect/Data"
import type { ColumnReferences } from "./column-reference.ts"
import type { ConstraintSpec } from "./constraint.ts"
import { makeStdbDiagnostic, StdbValidationError } from "./diagnostic.ts"
import {
  type AnyFieldType,
  type FieldOptionsOf,
  type FieldType,
  fieldOptions,
} from "./field.ts"
import { OutboxResultValue } from "./outbox-result.ts"
import type { AnyRemoteInterface, ReceiverKeysOf } from "./remote-interface.ts"
import { type AnyTableSpec, makeTable, type TableSpec } from "./table.ts"
import type { IndexAlgorithm, IndexSpec } from "./table-index.ts"
import * as Type from "./type.ts"

/**
 * Outbox rows are sent whole, as one HTTP body each. SpacetimeDB's standalone
 * keeps its route's default 2 MiB body limit, and a row over it is retried
 * forever, wedging its stream. The default bound fits ids and digests with room
 * to spare; the ceiling stays at half the route limit.
 */
export const outboxRowBytesMaxDefault = 64 * 1024
export const outboxRowBytesMaxCeiling = 1024 * 1024

/**
 * An outbox insert whose encoded row exceeds the outbox's `rowBytesMax`.
 * Nothing was inserted, and the transaction may still commit without the call.
 * The row may carry caller input, so the sender handles it: drops the call,
 * or refuses its own caller with a declared error of its own.
 */
export class OutboxRowTooLarge extends Data.TaggedError("OutboxRowTooLarge")<{
  readonly table: string
  readonly rowBytes: number
  readonly rowBytesMax: number
}> {}

/** The read-only index every outbox carries for stuck-stream inspection. */
export const outboxTargetIndexName = "byTarget"

/** Column names an outbox fills itself; local columns may not reuse them. */
export const outboxReservedColumnNames: ReadonlySet<string> = new Set([
  "msgId",
  "target",
  "enqueuedAt",
])

const outboxReservedNativeColumnNames: ReadonlySet<string> = new Set([
  "msg_id",
  "target",
  "enqueued_at",
])

export type OutboxMetadata<
  Interface extends AnyRemoteInterface = AnyRemoteInterface,
  Reducer extends string = string,
> = {
  readonly interface: Interface
  readonly reducer: Reducer
  readonly rowBytesMax: number
}

export type AnyOutboxTableSpec = AnyTableSpec & {
  readonly outbox: OutboxMetadata
}

export const outboxMetadataOf = (
  table: unknown,
): OutboxMetadata | undefined => {
  if (typeof table !== "object" || table === null || !("outbox" in table)) {
    return undefined
  }
  const outbox = (table as { readonly outbox?: unknown }).outbox
  return typeof outbox === "object" && outbox !== null
    ? (outbox as OutboxMetadata)
    : undefined
}

export const isOutboxTable = (table: unknown): table is AnyOutboxTableSpec =>
  outboxMetadataOf(table) !== undefined

// Private copies of `table.ts`'s column and index helpers. They must stay
// unexported: a consumer's declaration emit inlines an unexported alias, but
// reports TS2883 for an exported one it cannot name from the package root.
type Expand<T> = {
  readonly [K in keyof T]: T[K]
}

type InheritedColumnOptions<Field extends Type.AnyValueType> =
  Field extends FieldType<Type.AnyValueType, infer Options>
    ? Options
    : Field extends Type.StructFieldType<Type.AnyValueType, infer Options>
      ? Options extends { readonly optional: true }
        ? { readonly optional: true }
        : {}
      : {}

type ColumnsFromInputs<Fields extends Type.StructFields> = {
  readonly [Key in keyof Fields]: FieldType<
    Fields[Key],
    InheritedColumnOptions<Fields[Key]>
  >
}

type FieldIndexUnion<Fields extends Record<string, AnyFieldType>> = {
  readonly [Key in keyof Fields & string]: Exclude<
    FieldOptionsOf<Fields[Key]>["index"],
    undefined
  > extends infer Algorithm extends IndexAlgorithm
    ? [Algorithm] extends [never]
      ? never
      : IndexSpec<Key, readonly [Key], Algorithm>
    : never
}[keyof Fields & string]

type IndexesWithFieldIndexes<
  Fields extends Record<string, AnyFieldType>,
  Indexes extends ReadonlyArray<IndexSpec>,
> = [FieldIndexUnion<Fields>] extends [never]
  ? Indexes
  : ReadonlyArray<FieldIndexUnion<Fields> | Indexes[number]>

type IndexesOfCallback<Options> = Options extends {
  readonly indexes: (...args: never[]) => infer Indexes
}
  ? Indexes extends ReadonlyArray<IndexSpec>
    ? Indexes
    : readonly []
  : readonly []

type ConstraintsOfCallback<Options> = Options extends {
  readonly constraints: (...args: never[]) => infer Constraints
}
  ? Constraints extends ReadonlyArray<ConstraintSpec>
    ? Constraints
    : readonly []
  : readonly []

type OutboxIdValueType = Type.U64ValueType<bigint, bigint>

type OutboxLeadingColumnInputs = {
  readonly msgId: FieldType<
    OutboxIdValueType,
    { readonly primaryKey: true; readonly autoInc: true }
  >
  readonly target: ReturnType<typeof Type.identity>
}

type OutboxTrailingColumnInputs = {
  readonly enqueuedAt: ReturnType<typeof Type.timestamp>
}

type ReceiverParamFieldsOf<
  Interface extends AnyRemoteInterface,
  Reducer extends ReceiverKeysOf<Interface>,
> = Type.StructFieldsOf<Interface["receivers"][Reducer]["params"]>

type OutboxColumnInputs<
  ParamFields extends Type.StructFields,
  Columns extends Type.StructFields,
> = Expand<
  OutboxLeadingColumnInputs & ParamFields & Columns & OutboxTrailingColumnInputs
>

type OutboxTargetIndex = IndexSpec<
  typeof outboxTargetIndexName,
  readonly ["target", "msgId"],
  "btree"
>

type RejectOutboxColumnCollisions<Columns, ParamFields> = [
  keyof Columns & ("msgId" | "target" | "enqueuedAt"),
] extends [never]
  ? [keyof Columns & keyof ParamFields] extends [never]
    ? unknown
    : {
        readonly [Key in keyof Columns &
          keyof ParamFields &
          string as `outboxTable column ${Key} collides with the receiver parameter of the same name`]: never
      }
  : {
      readonly [Key in keyof Columns &
        (
          | "msgId"
          | "target"
          | "enqueuedAt"
        ) as `outboxTable columns cannot include reserved column ${Key}`]: never
    }

type OutboxTableCallbackOptions<Fields extends Record<string, AnyFieldType>> = {
  readonly indexes?: (
    columns: ColumnReferences<Fields>,
  ) => ReadonlyArray<IndexSpec>
  readonly constraints?: (
    columns: ColumnReferences<Fields>,
  ) => ReadonlyArray<ConstraintSpec>
}

type OutboxFieldsOf<
  Interface extends AnyRemoteInterface,
  Reducer extends ReceiverKeysOf<Interface>,
  Columns extends Type.StructFields,
> = ColumnsFromInputs<
  OutboxColumnInputs<ReceiverParamFieldsOf<Interface, Reducer>, Columns>
>

export type OutboxTableSpec<
  Name extends string,
  Interface extends AnyRemoteInterface,
  Reducer extends ReceiverKeysOf<Interface>,
  Columns extends Type.StructFields,
  Indexes extends ReadonlyArray<IndexSpec>,
  Constraints extends ReadonlyArray<ConstraintSpec>,
> = TableSpec<
  OutboxFieldsOf<Interface, Reducer, Columns>,
  Name,
  false,
  false,
  IndexesWithFieldIndexes<
    OutboxFieldsOf<Interface, Reducer, Columns>,
    readonly [OutboxTargetIndex, ...Indexes]
  >,
  Constraints,
  false,
  OutboxColumnInputs<ReceiverParamFieldsOf<Interface, Reducer>, Columns>
> & {
  readonly outbox: OutboxMetadata<Interface, Reducer>
}

const invalidOutboxTable = (
  name: string,
  path: ReadonlyArray<string | number>,
  message: string,
): StdbValidationError =>
  new StdbValidationError({
    diagnostics: [
      makeStdbDiagnostic(
        "InvalidOutboxTable",
        ["tables", name, ...path],
        message,
      ),
    ],
  })

/**
 * A table each row of which is one call to `reducer` of `interface` in the
 * database named by the row's `target`.
 *
 * The row carries `msgId` (filled on insert), `target`, the receiver's
 * parameters under their own names, any local `columns` (never sent), and
 * `enqueuedAt` (the sending transaction's time). Inserting it in a transaction
 * sends the call once that transaction is durable; its settle reducer
 * (`StdbFn.outboxResult`) runs when the receiver answers, and the row is then
 * deleted. The table is always private and insert-only.
 */
export function outboxTable<
  const Name extends string,
  const Interface extends AnyRemoteInterface,
  const Reducer extends ReceiverKeysOf<Interface>,
  const Columns extends Type.StructFields = {},
  const Options extends OutboxTableCallbackOptions<
    OutboxFieldsOf<Interface, Reducer, Columns>
  > = OutboxTableCallbackOptions<OutboxFieldsOf<Interface, Reducer, Columns>>,
>(
  name: Name,
  options: {
    readonly interface: Interface
    readonly reducer: Reducer
    readonly columns?: Columns
    /** Encoded row size bound in bytes; see `outboxRowBytesMaxDefault`. */
    readonly rowBytesMax?: number
  } & Options &
    RejectOutboxColumnCollisions<
      Columns,
      ReceiverParamFieldsOf<Interface, Reducer>
    >,
): OutboxTableSpec<
  Name,
  Interface,
  Reducer,
  Columns,
  IndexesOfCallback<Options>,
  ConstraintsOfCallback<Options>
>
export function outboxTable(
  name: string,
  options: {
    readonly interface: AnyRemoteInterface
    readonly reducer: string
    readonly columns?: Type.StructFields
    readonly rowBytesMax?: number
    readonly indexes?: (columns: never) => ReadonlyArray<IndexSpec>
    readonly constraints?: (columns: never) => ReadonlyArray<ConstraintSpec>
  },
): AnyOutboxTableSpec {
  const receiver = options.interface.receivers[options.reducer]
  if (receiver === undefined) {
    throw new StdbValidationError({
      diagnostics: [
        makeStdbDiagnostic(
          "OutboxReceiverUnknown",
          ["tables", name, "outbox", "reducer"],
          `Outbox ${name} targets ${options.reducer}, which remote interface ${options.interface.name} does not declare.`,
        ),
      ],
    })
  }

  const paramFields = Type.structFields(receiver.params) ?? {}
  const localColumns = options.columns ?? {}
  for (const [columnName, column] of Object.entries(localColumns)) {
    if (outboxReservedColumnNames.has(columnName)) {
      throw invalidOutboxTable(
        name,
        ["columns", columnName],
        `outboxTable columns cannot include reserved column ${columnName}`,
      )
    }
    if (Object.hasOwn(paramFields, columnName)) {
      throw invalidOutboxTable(
        name,
        ["columns", columnName],
        `outboxTable column ${columnName} collides with the receiver parameter of the same name`,
      )
    }
    const nativeName = fieldOptions(column).name
    if (
      nativeName !== undefined &&
      outboxReservedNativeColumnNames.has(nativeName)
    ) {
      throw invalidOutboxTable(
        name,
        ["columns", columnName],
        `outboxTable column ${columnName} cannot use reserved native column name ${nativeName}`,
      )
    }
  }

  const userIndexes = options.indexes as
    | ((columns: unknown) => ReadonlyArray<IndexSpec>)
    | undefined
  const table = makeTable({
    name,
    public: false,
    columns: {
      msgId: Type.u64().primaryKey().autoInc(),
      target: Type.identity(),
      ...paramFields,
      ...localColumns,
      enqueuedAt: Type.timestamp(),
    },
    indexes: (columns: unknown) => [
      {
        name: outboxTargetIndexName,
        algorithm: "btree",
        columns: ["target", "msgId"],
      } satisfies IndexSpec,
      ...(userIndexes?.(columns) ?? []),
    ],
    ...(options.constraints === undefined
      ? {}
      : { constraints: options.constraints }),
  })

  return {
    ...table,
    outbox: {
      interface: options.interface,
      reducer: options.reducer,
      rowBytesMax: options.rowBytesMax ?? outboxRowBytesMaxDefault,
    },
  }
}

/** The settle reducer's params for `table`: the outbox row and its outcome. */
export const outboxResultParams = <Table extends AnyTableSpec>(table: Table) =>
  Type.struct({ row: table.row, result: OutboxResultValue })

export type OutboxResultMetadata<
  Table extends AnyOutboxTableSpec = AnyOutboxTableSpec,
> = {
  readonly table: Table
}

export const outboxResultMetadataOf = (
  spec: unknown,
): OutboxResultMetadata | undefined => {
  if (typeof spec !== "object" || spec === null || !("outboxResult" in spec)) {
    return undefined
  }
  const metadata = (spec as { readonly outboxResult?: unknown }).outboxResult
  return typeof metadata === "object" &&
    metadata !== null &&
    "table" in metadata
    ? (metadata as OutboxResultMetadata)
    : undefined
}
