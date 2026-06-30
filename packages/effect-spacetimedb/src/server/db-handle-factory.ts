import type { AnyModuleSpec } from "../contract/module.ts"

import { type AnyTableSpec } from "../contract/table.ts"

import { type EffectDbView, type ReadonlyEffectDbView } from "./services.ts"

import { lookupPlansOf, tableCodecOf } from "./db-handle-codec.ts"

import { asRecord } from "./db-handle-runtime.ts"

import { buildReadonlyTable, buildReadwriteTable } from "./db-handle-table.ts"

import type { DbHandleFactory, TablePlan } from "./db-handle-runtime.ts"

export const makeDbHandleFactory = <Module extends AnyModuleSpec>(
  module: Module,
): DbHandleFactory<Module> => {
  const tablePlans = Object.keys(module.tables).map((tableKey) => {
    const table = module.tables[tableKey] as AnyTableSpec
    const op = `db.${tableKey}`

    return {
      key: tableKey,
      op,
      scheduled: table.scheduled,
      codec: tableCodecOf(table, op),
      lookups: lookupPlansOf(table, op),
    } satisfies TablePlan
  })

  return {
    readwrite: (rawDb) => {
      const dbRecord = asRecord(rawDb)
      const dbHandle = Object.create(null) as Record<string, unknown>

      for (const tablePlan of tablePlans) {
        dbHandle[tablePlan.key] = buildReadwriteTable(
          asRecord(dbRecord[tablePlan.key]),
          tablePlan,
        )
      }

      return dbHandle as EffectDbView<Module>
    },
    readonly: (rawDb) => {
      const dbRecord = asRecord(rawDb)
      const dbHandle = Object.create(null) as Record<string, unknown>

      for (const tablePlan of tablePlans) {
        dbHandle[tablePlan.key] = buildReadonlyTable(
          asRecord(dbRecord[tablePlan.key]),
          tablePlan,
        )
      }

      return dbHandle as ReadonlyEffectDbView<Module>
    },
  }
}
