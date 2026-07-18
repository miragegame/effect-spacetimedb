import { pascalCaseName } from "./canonical-name.ts"
import type { ColumnReferences } from "./column-reference.ts"
import * as ColumnReference from "./column-reference.ts"
import type { ConstraintSpec } from "./constraint.ts"
import {
  type AnyFieldType,
  Field,
  type FieldOptionsOf,
  type FieldType,
  type FieldValue,
  fieldOptions,
} from "./field.ts"
import type { IndexAlgorithm, IndexSpec } from "./table-index.ts"
import { makeStructValueType } from "./type/constructors.ts"
import * as Type from "./type.ts"

type Expand<T> = {
  readonly [K in keyof T]: T[K]
}

type ScheduledColumnName =
  | "scheduledId"
  | "scheduledAt"
  | "scheduled_id"
  | "scheduled_at"

type RejectScheduledColumnCollisions<Columns> = [
  keyof Columns & ScheduledColumnName,
] extends [never]
  ? unknown
  : {
      readonly [Key in keyof Columns &
        ScheduledColumnName as `scheduledTable columns cannot include reserved column ${Key}`]: never
    }

type ScheduledIdValueType = Type.U64ValueType<bigint, bigint>

type ScheduledAutoColumnInputs<ScheduledId extends ScheduledIdValueType> = {
  readonly scheduledId: FieldType<
    ScheduledId,
    { readonly primaryKey: true; readonly autoInc: true }
  >
  readonly scheduledAt: ReturnType<typeof Type.scheduleAt>
}

type ScheduledTableColumnInputs<
  Columns extends Type.StructFields,
  ScheduledId extends ScheduledIdValueType,
> = Expand<Columns & ScheduledAutoColumnInputs<ScheduledId>>

export type TableSpec<
  Fields extends Record<string, AnyFieldType> = Record<string, AnyFieldType>,
  Name extends string = string,
  Public extends boolean = boolean,
  Event extends boolean = boolean,
  Indexes extends ReadonlyArray<IndexSpec> = ReadonlyArray<IndexSpec>,
  Constraints extends
    ReadonlyArray<ConstraintSpec> = ReadonlyArray<ConstraintSpec>,
  Scheduled extends boolean = boolean,
  RowFields extends Type.StructFields = Fields,
> = {
  readonly kind: "table"
  readonly name: Name
  readonly public: Public
  readonly event: Event
  readonly columns: Fields
  readonly row: Type.StructValueType<RowFields>
  readonly indexes: Indexes
  readonly constraints: Constraints
  readonly scheduled: Scheduled
}

export type AnyTableSpec = TableSpec<
  Record<string, AnyFieldType>,
  string,
  boolean,
  boolean,
  ReadonlyArray<IndexSpec>,
  ReadonlyArray<ConstraintSpec>,
  boolean,
  Record<string, Type.AnyValueType>
>

export type AnyScheduledTableSpec = TableSpec<
  Record<string, AnyFieldType>,
  string,
  boolean,
  false,
  ReadonlyArray<IndexSpec>,
  ReadonlyArray<ConstraintSpec>,
  true,
  Record<string, Type.AnyValueType>
>

export type TableRow<Table extends AnyTableSpec> = {
  readonly [K in keyof Table["columns"]]: FieldValue<Table["columns"][K]>
}

export const rowType = <Table extends AnyTableSpec>(
  table: Table,
): Table["row"] => table.row

const TableRowSourceSymbol: unique symbol = Symbol.for(
  "effect-spacetimedb/TableRowSource",
) as never

const markTableRowSource = <Row extends Type.StructValueType>(
  row: Row,
): Row => {
  Object.defineProperty(row, TableRowSourceSymbol, {
    value: row,
    enumerable: false,
  })
  return row
}

export const tableRowSource = (
  value: Type.AnyValueType,
): Type.AnyValueType | undefined => {
  const source = Reflect.get(value, TableRowSourceSymbol)
  return source === undefined ? undefined : (source as Type.AnyValueType)
}

type RuntimeTableDefineOptions = {
  readonly name: string
  readonly public?: boolean
  readonly event?: boolean
  readonly columns: Record<string, Type.AnyValueType>
  readonly indexes?: unknown
  readonly constraints?: unknown
  readonly scheduled?: boolean
}

type PublicOf<Options extends { readonly public?: boolean }> = Options extends {
  readonly public: infer Public extends boolean
}
  ? Public
  : false
type EventOf<Options extends { readonly event?: boolean }> = Options extends {
  readonly event: infer Event extends boolean
}
  ? Event
  : false
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

const normalizeColumns = <
  const Columns extends Record<string, Type.AnyValueType>,
>(
  columns: Columns,
): ColumnsFromInputs<Columns> =>
  Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [
      key,
      Field(value, Type.fieldOptionsObject(fieldOptions(value))),
    ]),
  ) as ColumnsFromInputs<Columns>

const singleColumnIndex = (
  columnName: string,
  algorithm: IndexAlgorithm = "btree",
): IndexSpec => ({
  name: columnName,
  algorithm,
  columns: [columnName],
})

const indexesFromFields = (
  columns: Record<string, AnyFieldType>,
): ReadonlyArray<IndexSpec> =>
  Object.entries(columns).flatMap(([columnName, column]) => {
    const options = fieldOptions(column)
    switch (options.index) {
      case undefined:
        return []
      case "btree":
      case "hash":
      case "direct":
        return [singleColumnIndex(columnName, options.index)]
      default:
        const _exhaustive: never = options.index
        return _exhaustive
    }
  })

const canonicalColumnSet = (columns: ReadonlyArray<string>): string =>
  columns.slice().sort().join("\u0000")

const uniqueBackingIndexesFromFields = (
  columns: Record<string, AnyFieldType>,
  indexes: ReadonlyArray<IndexSpec>,
): ReadonlyArray<IndexSpec> => {
  const effectiveIndexColumnSets = new Set(
    indexes.map((index) => canonicalColumnSet(index.columns)),
  )

  for (const [columnName, column] of Object.entries(columns)) {
    if (fieldOptions(column).primaryKey) {
      effectiveIndexColumnSets.add(canonicalColumnSet([columnName]))
    }
  }

  return Object.entries(columns).flatMap(([columnName, column]) => {
    const options = fieldOptions(column)
    if (!options.unique) {
      return []
    }

    const columnSet = canonicalColumnSet([columnName])
    return effectiveIndexColumnSets.has(columnSet)
      ? []
      : [singleColumnIndex(columnName, "btree")]
  })
}

const constraintsFromFields = (
  columns: Record<string, AnyFieldType>,
): ReadonlyArray<ConstraintSpec> =>
  Object.entries(columns).flatMap(([columnName, column]) =>
    fieldOptions(column).unique
      ? [
          {
            kind: "unique" as const,
            name: `${columnName}_unique`,
            columns: [columnName],
          },
        ]
      : [],
  )

const makeTable = (options: RuntimeTableDefineOptions): AnyTableSpec => {
  const columns = normalizeColumns(options.columns)
  const columnReferences = ColumnReference.referencesFor(columns)
  const fieldIndexes = indexesFromFields(columns)
  const explicitIndexes =
    typeof options.indexes === "function"
      ? (
          options.indexes as (
            columns: typeof columnReferences,
          ) => ReadonlyArray<IndexSpec>
        )(columnReferences)
      : ((options.indexes ?? []) as ReadonlyArray<IndexSpec>)
  const indexesWithFieldIndexes = [...fieldIndexes, ...explicitIndexes]
  const indexes = [
    ...indexesWithFieldIndexes,
    ...uniqueBackingIndexesFromFields(columns, indexesWithFieldIndexes),
  ]
  const fieldConstraints = constraintsFromFields(columns)
  const explicitConstraints =
    typeof options.constraints === "function"
      ? (
          options.constraints as (
            columns: typeof columnReferences,
          ) => ReadonlyArray<ConstraintSpec>
        )(columnReferences)
      : ((options.constraints ?? []) as ReadonlyArray<ConstraintSpec>)
  const constraints = [...fieldConstraints, ...explicitConstraints]
  const uniqueDefaultColumns = new Set(
    constraints.flatMap((constraint) =>
      constraint.columns.filter((column) => {
        const field = columns[column]
        return field !== undefined && fieldOptions(field).hasDefault
      }),
    ),
  )

  if (uniqueDefaultColumns.size > 0) {
    throw new Error(
      `A field default cannot be combined with unique constraints: ${[
        ...uniqueDefaultColumns,
      ].join(", ")}`,
    )
  }

  const row = markTableRowSource(
    makeStructValueType(options.columns, pascalCaseName(options.name)),
  )

  const table = {
    kind: "table" as const,
    name: options.name,
    public: options.public ?? false,
    event: options.event ?? false,
    columns,
    row,
    indexes,
    constraints,
    scheduled: options.scheduled ?? false,
  }

  return table
}

type TableCallbackOptions<Fields extends Record<string, AnyFieldType>> = {
  readonly public?: boolean
  readonly event?: boolean
  readonly scheduled?: never
  readonly indexes?: (
    columns: ColumnReferences<Fields>,
  ) => ReadonlyArray<IndexSpec>
  readonly constraints?: (
    columns: ColumnReferences<Fields>,
  ) => ReadonlyArray<ConstraintSpec>
}

type TableArrayOptions<
  Columns extends Type.StructFields,
  Public extends boolean | undefined,
  Event extends boolean | undefined,
  Indexes extends ReadonlyArray<IndexSpec>,
  Constraints extends ReadonlyArray<ConstraintSpec>,
> = {
  readonly public?: Public
  readonly event?: Event
  readonly scheduled?: never
  readonly columns: Columns
  readonly indexes?: Indexes
  readonly constraints?: Constraints
}

type ScheduledTableCallbackOptions<
  Fields extends Record<string, AnyFieldType>,
  ScheduledId extends ScheduledIdValueType,
> = {
  readonly public?: boolean
  readonly event?: never
  readonly scheduled?: never
  readonly scheduledId?: ScheduledId
  readonly indexes?: (
    columns: ColumnReferences<Fields>,
  ) => ReadonlyArray<IndexSpec>
  readonly constraints?: (
    columns: ColumnReferences<Fields>,
  ) => ReadonlyArray<ConstraintSpec>
}

type ScheduledTableArrayOptions<
  Columns extends Type.StructFields,
  Public extends boolean | undefined,
  Indexes extends ReadonlyArray<IndexSpec>,
  Constraints extends ReadonlyArray<ConstraintSpec>,
  ScheduledId extends ScheduledIdValueType,
> = {
  readonly public?: Public
  readonly event?: never
  readonly scheduled?: never
  readonly scheduledId?: ScheduledId
  readonly columns: Columns
  readonly indexes?: Indexes
  readonly constraints?: Constraints
}

export function table<
  const Name extends string,
  const Columns extends Type.StructFields,
  const Options extends TableCallbackOptions<
    ColumnsFromInputs<Columns>
  > = TableCallbackOptions<ColumnsFromInputs<Columns>>,
>(
  name: Name,
  options: {
    readonly columns: Columns
  } & Options,
): TableSpec<
  ColumnsFromInputs<Columns>,
  Name,
  PublicOf<Options>,
  EventOf<Options>,
  IndexesWithFieldIndexes<
    ColumnsFromInputs<Columns>,
    IndexesOfCallback<Options>
  >,
  ConstraintsOfCallback<Options>,
  false,
  Columns
>
export function table<
  const Name extends string,
  const Columns extends Type.StructFields,
  const Public extends boolean | undefined = undefined,
  const Event extends boolean | undefined = undefined,
  const Indexes extends ReadonlyArray<IndexSpec> = readonly [],
  const Constraints extends ReadonlyArray<ConstraintSpec> = readonly [],
>(
  name: Name,
  options: TableArrayOptions<Columns, Public, Event, Indexes, Constraints>,
): TableSpec<
  ColumnsFromInputs<Columns>,
  Name,
  Public extends boolean ? Public : false,
  Event extends boolean ? Event : false,
  IndexesWithFieldIndexes<ColumnsFromInputs<Columns>, Indexes>,
  Constraints,
  false,
  Columns
>
export function table(
  name: string,
  options: Omit<RuntimeTableDefineOptions, "name">,
): AnyTableSpec {
  const tableOptions: {
    name: string
    public?: boolean
    event?: boolean
    columns: Record<string, Type.AnyValueType>
    indexes?: unknown
    constraints?: unknown
  } = {
    name,
    columns: options.columns,
  }

  if (options.public === true) {
    tableOptions.public = true
  } else if (options.public === false) {
    tableOptions.public = false
  } else if (options.public === undefined) {
    // Keep the default false value inside makeTable.
  }

  if (options.event === true) {
    tableOptions.event = true
  } else if (options.event === false) {
    tableOptions.event = false
  } else if (options.event === undefined) {
    // Keep the default false value inside makeTable.
  }

  if (options.indexes !== undefined) {
    tableOptions.indexes = options.indexes
  }
  if (options.constraints !== undefined) {
    tableOptions.constraints = options.constraints
  }

  return makeTable(tableOptions)
}

const scheduledColumns = <ScheduledId extends ScheduledIdValueType>(
  scheduledId: ScheduledId | undefined,
): ScheduledAutoColumnInputs<ScheduledId> => {
  const idType = scheduledId ?? (Type.u64() as ScheduledId)
  const info = Type.typeInfo(idType)
  if (info?.kind !== "u64") {
    throw new Error("scheduledId override must be a u64 value type")
  }

  return {
    scheduledId: idType.primaryKey().autoInc().name("scheduled_id"),
    scheduledAt: Type.scheduleAt().name("scheduled_at"),
  }
}

const reservedScheduledNativeColumn = (
  columns: Record<string, Type.AnyValueType>,
):
  | {
      readonly columnName: string
      readonly nativeName: string
    }
  | undefined => {
  for (const [columnName, column] of Object.entries(columns)) {
    const nativeName = fieldOptions(column).name ?? columnName
    if (nativeName === "scheduled_id" || nativeName === "scheduled_at") {
      return {
        columnName,
        nativeName,
      }
    }
  }

  return undefined
}

export function scheduledTable<
  const Name extends string,
  const Columns extends Type.StructFields,
  const ScheduledId extends ScheduledIdValueType = Type.U64ValueType,
  const Options extends ScheduledTableCallbackOptions<
    ColumnsFromInputs<ScheduledTableColumnInputs<Columns, ScheduledId>>,
    ScheduledId
  > = ScheduledTableCallbackOptions<
    ColumnsFromInputs<ScheduledTableColumnInputs<Columns, ScheduledId>>,
    ScheduledId
  >,
>(
  name: Name,
  options: {
    readonly columns: Columns
  } & Options &
    RejectScheduledColumnCollisions<Columns>,
): TableSpec<
  ColumnsFromInputs<ScheduledTableColumnInputs<Columns, ScheduledId>>,
  Name,
  PublicOf<Options>,
  false,
  IndexesWithFieldIndexes<
    ColumnsFromInputs<ScheduledTableColumnInputs<Columns, ScheduledId>>,
    IndexesOfCallback<Options>
  >,
  ConstraintsOfCallback<Options>,
  true,
  ScheduledTableColumnInputs<Columns, ScheduledId>
>
export function scheduledTable<
  const Name extends string,
  const Columns extends Type.StructFields,
  const Public extends boolean | undefined = undefined,
  const Indexes extends ReadonlyArray<IndexSpec> = readonly [],
  const Constraints extends ReadonlyArray<ConstraintSpec> = readonly [],
  const ScheduledId extends ScheduledIdValueType = Type.U64ValueType,
>(
  name: Name,
  options: ScheduledTableArrayOptions<
    Columns,
    Public,
    Indexes,
    Constraints,
    ScheduledId
  > &
    RejectScheduledColumnCollisions<Columns>,
): TableSpec<
  ColumnsFromInputs<ScheduledTableColumnInputs<Columns, ScheduledId>>,
  Name,
  Public extends boolean ? Public : false,
  false,
  IndexesWithFieldIndexes<
    ColumnsFromInputs<ScheduledTableColumnInputs<Columns, ScheduledId>>,
    Indexes
  >,
  Constraints,
  true,
  ScheduledTableColumnInputs<Columns, ScheduledId>
>
export function scheduledTable(
  name: string,
  options: Omit<RuntimeTableDefineOptions, "name" | "event"> & {
    readonly scheduledId?: ScheduledIdValueType
  },
): AnyScheduledTableSpec {
  const reservedColumn =
    "scheduledId" in options.columns
      ? "scheduledId"
      : "scheduledAt" in options.columns
        ? "scheduledAt"
        : undefined
  if (reservedColumn !== undefined) {
    throw new Error(
      `scheduledTable columns cannot include reserved column ${reservedColumn}`,
    )
  }
  const reservedNativeColumn = reservedScheduledNativeColumn(options.columns)
  if (reservedNativeColumn !== undefined) {
    throw new Error(
      `scheduledTable column ${reservedNativeColumn.columnName} cannot use reserved native column name ${reservedNativeColumn.nativeName}`,
    )
  }

  const columns = {
    ...scheduledColumns(options.scheduledId),
    ...options.columns,
  }

  return makeTable({
    name,
    columns,
    public: options.public ?? false,
    indexes: options.indexes,
    constraints: options.constraints,
    scheduled: true,
  }) as AnyScheduledTableSpec
}
