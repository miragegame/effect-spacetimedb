// lint-ignore: prefer-match-for-literal-union-branching - current branch logic stays local and exhaustive refactor is outside the restack fix.

import type { Bound } from "spacetimedb/server"

import { StdbDecodeError } from "../decode-error.ts"

import { rowType, type AnyTableSpec } from "../contract/table.ts"

import * as Type from "../contract/type.ts"

import { encodeHostValue } from "../contract/type/host-codec.ts"

import {
  cloneRangeLike,
  hasUniqueConstraintFor,
  isRangeLike,
  primaryKeyColumnsOf,
  uniqueConstraintColumnsOf,
} from "./db-handle-runtime.ts"

import type { LookupPlan, RawRecord, TableCodec } from "./db-handle-runtime.ts"

export const lookupPlansOf = (
  table: AnyTableSpec,
  tableOp: string,
): ReadonlyArray<LookupPlan> =>
  (() => {
    const primaryKeyColumns = primaryKeyColumnsOf(table)
    const uniqueConstraintColumns = uniqueConstraintColumnsOf(
      table,
      primaryKeyColumns,
    )

    const primaryKeyLookups = primaryKeyColumns.map((columnKey) => ({
      kind: "unique" as const,
      key: columnKey,
      columns: [columnKey],
      op: `${tableOp}.${columnKey}`,
      update: primaryKeyColumns.length === 1,
    }))

    const explicitIndexLookups = table.indexes.map((index) => {
      const unique = hasUniqueConstraintFor(
        index.columns,
        uniqueConstraintColumns,
      )
      const update =
        unique &&
        primaryKeyColumns.length === 1 &&
        index.columns.length === 1 &&
        index.columns[0] === primaryKeyColumns[0]

      if (unique) {
        return {
          kind: "unique" as const,
          key: index.name,
          columns: [...index.columns],
          op: `${tableOp}.${index.name}`,
          update,
        }
      }

      const kind: "point" | "range" =
        index.algorithm === "hash" ? "point" : "range"

      return {
        kind,
        key: index.name,
        columns: [...index.columns],
        op: `${tableOp}.${index.name}`,
      }
    })

    return [...primaryKeyLookups, ...explicitIndexLookups]
  })()

export const tableCodecOf = (
  table: AnyTableSpec,
  tableOp: string,
): TableCodec => {
  const fields = table.columns as Record<string, Type.AnyValueType>
  const rowCodec = Type.dbCodec<unknown, unknown>(
    rowType(table) as Type.AnyValueType,
  )
  const context = { table: table.name, op: tableOp } as const

  const fieldSchema = (column: string): Type.AnyValueType => {
    const schema = fields[column]
    if (schema == null) {
      throw new TypeError(`Unknown table column ${column} at ${tableOp}`)
    }
    return schema
  }

  const encodeFieldValue = (column: string, value: unknown): unknown =>
    encodeHostValue(fieldSchema(column), value)

  const encodeRangeBound = (
    column: string,
    bound: Bound<unknown>,
  ): Bound<unknown> =>
    bound.tag === "unbounded"
      ? bound
      : {
          ...bound,
          value: encodeFieldValue(column, bound.value),
        }

  const encodeTermOrRange = (column: string, value: unknown): unknown =>
    isRangeLike(value)
      ? cloneRangeLike(
          value,
          encodeRangeBound(column, value.from),
          encodeRangeBound(column, value.to),
        )
      : encodeFieldValue(column, value)

  const encodeCompositeTuple = (
    columns: ReadonlyArray<string>,
    value: unknown,
    kind: "point" | "range",
  ): ReadonlyArray<unknown> => {
    if (!Array.isArray(value)) {
      throw new TypeError(
        `${tableOp} expected an array value for a composite ${kind} lookup`,
      )
    }

    if (kind === "point" && value.length !== columns.length) {
      throw new TypeError(
        `${tableOp} expected ${columns.length} values for a composite point lookup`,
      )
    }

    if (
      kind === "range" &&
      (value.length === 0 || value.length > columns.length)
    ) {
      throw new TypeError(
        `${tableOp} expected between 1 and ${columns.length} values for a composite range lookup`,
      )
    }

    return value.map((entry, index) =>
      kind === "range" && index === value.length - 1
        ? encodeTermOrRange(columns[index]!, entry)
        : encodeFieldValue(columns[index]!, entry),
    )
  }

  const encodeCompositeObject = (
    columns: ReadonlyArray<string>,
    value: Record<PropertyKey, unknown>,
    kind: "point" | "range",
  ): ReadonlyArray<unknown> => {
    const entries: Array<unknown> = []

    for (const column of columns) {
      if (!Object.hasOwn(value, column)) {
        break
      }
      entries.push(value[column])
    }

    const unknownKeys = Object.keys(value).filter(
      (key) => !columns.includes(key),
    )
    if (unknownKeys.length > 0) {
      throw new TypeError(
        `${tableOp} received unknown composite ${kind} lookup field ${unknownKeys[0]}`,
      )
    }

    if (kind === "point" && entries.length !== columns.length) {
      throw new TypeError(
        `${tableOp} expected fields ${columns.join(", ")} for a composite point lookup`,
      )
    }

    if (kind === "range") {
      if (
        entries.length === 0 ||
        entries.length !== Object.keys(value).length
      ) {
        throw new TypeError(
          `${tableOp} expected a contiguous prefix of fields ${columns.join(", ")} for a composite range lookup`,
        )
      }
    }

    return encodeCompositeTuple(columns, entries, kind)
  }

  const encodeCompositeLookup = (
    columns: ReadonlyArray<string>,
    value: unknown,
    kind: "point" | "range",
  ): unknown =>
    Array.isArray(value)
      ? encodeCompositeTuple(columns, value, kind)
      : typeof value === "object" && value !== null
        ? encodeCompositeObject(columns, value as RawRecord, kind)
        : encodeCompositeTuple(columns, value, kind)

  return {
    context,
    encodeRow: (row) => encodeHostValue(rowType(table), row),
    decodeRow: (row) => {
      try {
        return rowCodec.decodeUnknownSync(row)
      } catch (cause) {
        throw new StdbDecodeError({
          phase: "row",
          cause,
          ...context,
        })
      }
    },
    encodeLookupPoint: (columns, value) =>
      columns.length === 1
        ? encodeFieldValue(columns[0]!, value)
        : encodeCompositeLookup(columns, value, "point"),
    encodeLookupRange: (columns, value) =>
      columns.length === 1
        ? encodeTermOrRange(columns[0]!, value)
        : encodeCompositeLookup(columns, value, "range"),
  }
}

export type DbCapabilityMode = "readonly" | "readwrite"
