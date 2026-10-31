import type { AnyModuleSpec } from "../contract/module.ts"

import { outboxMetadataOf } from "../contract/outbox-table.ts"
import { type AnyTableSpec } from "../contract/table.ts"
import { encodeGeneratedClientValue } from "../contract/type/host-codec.ts"
import { structFieldOptions } from "../contract/type/predicates.ts"
import * as Type from "../contract/type.ts"
import type { OutboxSendContext } from "./outbox.ts"

import {
  type EffectDbView,
  type ReadonlyEffectDbView,
  StdbDbSchemaMismatchError,
} from "./services.ts"

import {
  lookupPlansOf,
  type ServerRangeFactory,
  tableCodecOf,
} from "./db-handle-codec.ts"

import { asRecord } from "./db-handle-runtime.ts"

import {
  buildOutboxTable,
  buildReadonlyTable,
  buildReadwriteTable,
} from "./db-handle-table.ts"

import type {
  DbHandleFactory,
  TableCodec,
  TablePlan,
} from "./db-handle-runtime.ts"

/**
 * An outbox row's receiver-parameter columns are the binding's builders, which
 * native codegen emits with PascalCase variant names, as it does for generated
 * clients; the rest of the row uses this module's own, authored names. Reading
 * accepts both spellings already.
 */
const outboxCodecOf = (
  codec: TableCodec,
  paramFields: Type.StructFields,
): TableCodec => ({
  ...codec,
  encodeRow: (row) => {
    const encoded = asRecord(codec.encodeRow(row))
    const input = asRecord(row)
    const next: Record<PropertyKey, unknown> = { ...encoded }
    for (const [name, field] of Object.entries(paramFields)) {
      const value = input[name]
      next[name] =
        structFieldOptions(field).optional && value === undefined
          ? undefined
          : encodeGeneratedClientValue(field, value)
    }
    return next
  },
})

export const makeDbHandleFactory = <Module extends AnyModuleSpec>(
  module: Module,
  options: {
    readonly makeRange?: ServerRangeFactory
  } = {},
): DbHandleFactory<Module> => {
  const tablePlans = Object.keys(module.tables).map((tableKey) => {
    const table = module.tables[tableKey] as AnyTableSpec
    const op = `db.${tableKey}`
    const outbox = outboxMetadataOf(table)
    const codec = tableCodecOf(table, op, options.makeRange)
    const receiver =
      outbox === undefined
        ? undefined
        : outbox.interface.receivers[outbox.reducer]

    return {
      key: tableKey,
      op,
      scheduled: table.scheduled,
      outbox:
        outbox === undefined
          ? undefined
          : {
              tableName: table.name,
              row: table.row,
              rowBytesMax: outbox.rowBytesMax,
            },
      codec:
        receiver === undefined
          ? codec
          : outboxCodecOf(codec, Type.structFields(receiver.params) ?? {}),
      lookups: lookupPlansOf(table, op),
    } satisfies TablePlan
  })

  const validateRawDb = (rawDb: unknown): Record<PropertyKey, unknown> => {
    const dbRecord = asRecord(rawDb)
    const missingTables = tablePlans
      .map((tablePlan) => tablePlan.key)
      .filter((tableKey) => !(tableKey in dbRecord))
    if (missingTables.length > 0) {
      throw new StdbDbSchemaMismatchError({
        module: module.name,
        missingTables,
        availableTables: Object.keys(dbRecord),
      })
    }
    return dbRecord
  }

  return {
    readwrite: (rawDb, send?: OutboxSendContext) => {
      const dbRecord = validateRawDb(rawDb)
      const dbHandle = Object.create(null) as Record<string, unknown>

      for (const tablePlan of tablePlans) {
        let tableHandle: Record<string, unknown> | undefined
        Object.defineProperty(dbHandle, tablePlan.key, {
          enumerable: true,
          get: () => {
            tableHandle ??=
              tablePlan.outbox === undefined
                ? buildReadwriteTable(
                    asRecord(dbRecord[tablePlan.key]),
                    tablePlan,
                  )
                : buildOutboxTable(
                    asRecord(dbRecord[tablePlan.key]),
                    tablePlan,
                    tablePlan.outbox,
                    send,
                  )
            return tableHandle
          },
        })
      }

      return Object.freeze(dbHandle) as EffectDbView<Module>
    },
    readonly: (rawDb) => {
      const dbRecord = validateRawDb(rawDb)
      const dbHandle = Object.create(null) as Record<string, unknown>

      for (const tablePlan of tablePlans) {
        let tableHandle: Record<string, unknown> | undefined
        Object.defineProperty(dbHandle, tablePlan.key, {
          enumerable: true,
          get: () => {
            tableHandle ??= buildReadonlyTable(
              asRecord(dbRecord[tablePlan.key]),
              tablePlan,
            )
            return tableHandle
          },
        })
      }

      return Object.freeze(dbHandle) as ReadonlyEffectDbView<Module>
    },
  }
}
