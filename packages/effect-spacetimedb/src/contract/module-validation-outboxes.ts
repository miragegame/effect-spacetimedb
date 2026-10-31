import type { StdbDiagnostic } from "./diagnostic.ts"
import type { AnyModuleSpec } from "./module.ts"
import { pushDiagnostic } from "./module-validation-common.ts"
import { OutboxResultValue } from "./outbox-result.ts"
import {
  outboxMetadataOf,
  outboxReservedColumnNames,
  outboxResultMetadataOf,
  outboxRowBytesMaxCeiling,
} from "./outbox-table.ts"
import { isReceiverSpec } from "./remote-interface.ts"
import type { AnyTableSpec } from "./table.ts"
import { structFields } from "./type.ts"

const validateOutboxTable = (
  diagnostics: Array<StdbDiagnostic>,
  tableKey: string,
  table: AnyTableSpec,
): void => {
  const outbox = outboxMetadataOf(table)
  if (outbox === undefined) {
    return
  }

  const path = ["tables", tableKey]
  if (table.public) {
    pushDiagnostic(
      diagnostics,
      "InvalidOutboxTable",
      [...path, "public"],
      `Outbox ${tableKey} must be private: its rows are calls in flight, not data for clients.`,
    )
  }
  if (table.event || table.scheduled) {
    pushDiagnostic(
      diagnostics,
      "InvalidOutboxTable",
      path,
      `Outbox ${tableKey} cannot be a scheduled or event table.`,
    )
  }
  for (const columnName of outboxReservedColumnNames) {
    if (!Object.hasOwn(table.columns, columnName)) {
      pushDiagnostic(
        diagnostics,
        "InvalidOutboxTable",
        [...path, "columns", columnName],
        `Outbox ${tableKey} is missing its ${columnName} column; declare it with Stdb.outboxTable(...).`,
      )
    }
  }
  if (
    !Number.isSafeInteger(outbox.rowBytesMax) ||
    outbox.rowBytesMax <= 0 ||
    outbox.rowBytesMax > outboxRowBytesMaxCeiling
  ) {
    pushDiagnostic(
      diagnostics,
      "OutboxRowBytesMaxOutOfRange",
      [...path, "outbox", "rowBytesMax"],
      `Outbox ${tableKey} rowBytesMax ${String(outbox.rowBytesMax)} must be a positive integer of at most ${outboxRowBytesMaxCeiling} bytes, half the host's 2 MiB request limit.`,
    )
  }

  const receiver = outbox.interface.receivers[outbox.reducer]
  if (receiver === undefined) {
    pushDiagnostic(
      diagnostics,
      "OutboxReceiverUnknown",
      [...path, "outbox", "reducer"],
      `Outbox ${tableKey} targets ${outbox.reducer}, which remote interface ${outbox.interface.name} does not declare.`,
    )
    return
  }
  for (const paramName of Object.keys(structFields(receiver.params) ?? {})) {
    if (!Object.hasOwn(table.columns, paramName)) {
      pushDiagnostic(
        diagnostics,
        "InvalidOutboxTable",
        [...path, "columns", paramName],
        `Outbox ${tableKey} has no column for receiver parameter ${paramName}.`,
      )
    }
  }
}

const validateSettleParams = (
  diagnostics: Array<StdbDiagnostic>,
  key: string,
  spec: { readonly params: unknown },
  table: AnyTableSpec,
): void => {
  const fields = structFields(spec.params as Parameters<typeof structFields>[0])
  if (
    fields === undefined ||
    Object.keys(fields).length !== 2 ||
    fields.row !== table.row ||
    fields.result !== OutboxResultValue
  ) {
    pushDiagnostic(
      diagnostics,
      "InvalidOutboxResult",
      ["reducers", key, "params"],
      `Settle reducer ${key} params must be exactly the outbox row and its OutboxResult; declare it with StdbFn.outboxResult(...).`,
    )
  }
}

/**
 * Outbox rules: every outbox is private, neither scheduled nor an event table,
 * bounded at most at the ceiling, targets a receiver its interface declares,
 * and has exactly one settle reducer. A settle reducer is private, references a
 * registered outbox, and takes exactly that outbox's row and its outcome.
 */
export const validateOutboxes = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
): void => {
  const outboxKeys = new Map<AnyTableSpec, string>()
  for (const [tableKey, table] of Object.entries(module.tables)) {
    if (outboxMetadataOf(table) === undefined) {
      continue
    }
    outboxKeys.set(table, tableKey)
    validateOutboxTable(diagnostics, tableKey, table)
  }

  const settleKeys = new Map<AnyTableSpec, Array<string>>()
  for (const [key, reducer] of Object.entries(module.reducers)) {
    const metadata = outboxResultMetadataOf(reducer)
    if (metadata === undefined) {
      continue
    }

    const path = ["reducers", key]
    const tableKey = outboxKeys.get(metadata.table)
    if (tableKey === undefined) {
      pushDiagnostic(
        diagnostics,
        "InvalidOutboxResult",
        [...path, "outboxResult", "table"],
        `Settle reducer ${key} references a table that is not an outbox registered on this module.`,
      )
      continue
    }
    if (reducer.public !== false) {
      pushDiagnostic(
        diagnostics,
        "InvalidOutboxResult",
        [...path, "public"],
        `Settle reducer ${key} must be private: only the host settles an outbox row.`,
      )
    }
    if (
      isReceiverSpec(reducer) ||
      (reducer as { readonly scheduled?: unknown }).scheduled !== undefined
    ) {
      pushDiagnostic(
        diagnostics,
        "InvalidOutboxResult",
        path,
        `Settle reducer ${key} cannot also be a receiver or a scheduled target.`,
      )
    }
    validateSettleParams(diagnostics, key, reducer, metadata.table)

    const keys = settleKeys.get(metadata.table) ?? []
    keys.push(key)
    settleKeys.set(metadata.table, keys)
  }

  for (const [table, tableKey] of outboxKeys) {
    const keys = settleKeys.get(table) ?? []
    if (keys.length === 0) {
      pushDiagnostic(
        diagnostics,
        "OutboxWithoutResult",
        ["tables", tableKey, "outbox"],
        `Outbox ${tableKey} must have a settle reducer declared with StdbFn.outboxResult(...); an unsettled refusal would be lost.`,
      )
    } else if (keys.length > 1) {
      pushDiagnostic(
        diagnostics,
        "DuplicateOutboxResult",
        ["tables", tableKey, "outbox"],
        `Outbox ${tableKey} has more than one settle reducer: ${keys.join(", ")}.`,
      )
    }
  }
}
