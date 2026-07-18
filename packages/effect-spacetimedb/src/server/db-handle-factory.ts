import type { AnyModuleSpec } from "../contract/module.ts"

import { type AnyTableSpec } from "../contract/table.ts"

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

import { buildReadonlyTable, buildReadwriteTable } from "./db-handle-table.ts"

import type { DbHandleFactory, TablePlan } from "./db-handle-runtime.ts"

export const makeDbHandleFactory = <Module extends AnyModuleSpec>(
  module: Module,
  options: {
    readonly makeRange?: ServerRangeFactory
  } = {},
): DbHandleFactory<Module> => {
  const tablePlans = Object.keys(module.tables).map((tableKey) => {
    const table = module.tables[tableKey] as AnyTableSpec
    const op = `db.${tableKey}`

    return {
      key: tableKey,
      op,
      scheduled: table.scheduled,
      codec: tableCodecOf(table, op, options.makeRange),
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
    readwrite: (rawDb) => {
      const dbRecord = validateRawDb(rawDb)
      const dbHandle = Object.create(null) as Record<string, unknown>

      for (const tablePlan of tablePlans) {
        let tableHandle: Record<string, unknown> | undefined
        Object.defineProperty(dbHandle, tablePlan.key, {
          enumerable: true,
          get: () => {
            tableHandle ??= buildReadwriteTable(
              asRecord(dbRecord[tablePlan.key]),
              tablePlan,
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
