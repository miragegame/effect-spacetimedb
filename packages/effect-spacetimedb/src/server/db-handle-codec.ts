
import { StdbDecodeError } from "../decode-error.ts"

import { rowType, type AnyTableSpec } from "../contract/table.ts"

import * as Type from "../contract/type.ts"
import { encodeHostValue } from "../contract/type/host-codec.ts"
import {
  indexValueCodecOf,
  type IndexValueCodecOptions,
} from "../index-value-codec.ts"

import {
  hasUniqueConstraintFor,
  primaryKeyColumnsOf,
  uniqueConstraintColumnsOf,
} from "./db-handle-runtime.ts"

import type { LookupPlan, TableCodec } from "./db-handle-runtime.ts"

export type ServerRangeFactory = NonNullable<
  IndexValueCodecOptions["makeRange"]
>

let compilerRangeFactory: ServerRangeFactory | undefined

export const installServerRangeFactory = (
  makeRange: ServerRangeFactory,
): void => {
  compilerRangeFactory = makeRange
}

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
  makeRange: ServerRangeFactory | undefined = compilerRangeFactory,
): TableCodec => {
  const rowCodec = Type.dbCodec<unknown, unknown>(
    rowType(table) as Type.AnyValueType,
  )
  const context = { table: table.name, op: tableOp } as const
  const indexCodec = indexValueCodecOf(table, tableOp, {
    ...(makeRange === undefined ? {} : { makeRange }),
    rejectFullWidthCompositeRange: true,
  })

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
    encodeLookupPoint: indexCodec.encodePoint,
    encodeLookupRange: indexCodec.encodeRange,
  }
}

export type DbCapabilityMode = "readonly" | "readwrite"
