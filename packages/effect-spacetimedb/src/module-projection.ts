import type { AnyModuleSpec } from "./contract/module.ts"
import { typedEntries, typedFromEntries } from "./utils.ts"

export type ScheduleBinding = {
  readonly tableKey: string
  readonly tableName: string
  readonly targetKey: string
  readonly targetKind: "reducer" | "procedure"
  readonly allowExternalCallers: boolean
}

export type PublicPersistentTables<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["tables"] &
    string as Module["tables"][Key]["public"] extends true
    ? Module["tables"][Key]["event"] extends true
      ? never
      : Key
    : never]: Module["tables"][Key]
}

export type PublicEventTables<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["tables"] &
    string as Module["tables"][Key]["public"] extends true
    ? Module["tables"][Key]["event"] extends true
      ? Key
      : never
    : never]: Module["tables"][Key]
}

export type PublicReducers<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["reducers"] &
    string as Module["reducers"][Key]["public"] extends false
    ? never
    : Key]: Module["reducers"][Key]
}

export type PublicProcedures<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["procedures"] &
    string as Module["procedures"][Key]["public"] extends false
    ? never
    : Key]: Module["procedures"][Key]
}

export type HttpHandlers<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["httpHandlers"] &
    string]: Module["httpHandlers"][Key]
}

const scheduledMetadataOf = (
  spec: unknown,
):
  | {
      readonly table: unknown
      readonly allowExternalCallers: boolean
    }
  | undefined => {
  if (typeof spec !== "object" || spec === null || !("scheduled" in spec)) {
    return undefined
  }

  const scheduled = (spec as { readonly scheduled?: unknown }).scheduled
  if (
    typeof scheduled !== "object" ||
    scheduled === null ||
    !("table" in scheduled)
  ) {
    return undefined
  }

  return {
    table: (scheduled as { readonly table: unknown }).table,
    allowExternalCallers:
      (scheduled as { readonly allowExternalCallers?: unknown })
        .allowExternalCallers === true,
  }
}

const resolveScheduledTable = (
  module: AnyModuleSpec,
  targetKey: string,
  targetTable: unknown,
): { readonly tableKey: string; readonly tableName: string } => {
  for (const [tableKey, table] of Object.entries(module.tables)) {
    if (table === targetTable) {
      return { tableKey, tableName: table.name }
    }
  }

  const candidates = Object.values(module.tables).map((table) => table.name)
  throw new Error(
    candidates.length === 0
      ? `Scheduled target ${targetKey} references an unregistered table; this module does not declare tables`
      : `Scheduled target ${targetKey} references an unregistered table; expected one of ${candidates.join(", ")}`,
  )
}

export const resolveScheduleBindings = <Module extends AnyModuleSpec>(
  module: Module,
): ReadonlyArray<ScheduleBinding> => {
  const bindings: Array<ScheduleBinding> = []

  for (const [targetKey, reducer] of Object.entries(module.reducers)) {
    const scheduled = scheduledMetadataOf(reducer)
    if (scheduled === undefined) {
      continue
    }

    const table = resolveScheduledTable(module, targetKey, scheduled.table)
    bindings.push({
      ...table,
      targetKey,
      targetKind: "reducer",
      allowExternalCallers: scheduled.allowExternalCallers,
    })
  }

  for (const [targetKey, procedure] of Object.entries(module.procedures)) {
    const scheduled = scheduledMetadataOf(procedure)
    if (scheduled === undefined) {
      continue
    }

    const table = resolveScheduledTable(module, targetKey, scheduled.table)
    bindings.push({
      ...table,
      targetKey,
      targetKind: "procedure",
      allowExternalCallers: scheduled.allowExternalCallers,
    })
  }

  return bindings
}

export const projectPublicPersistentTables = <Module extends AnyModuleSpec>(
  module: Module,
): PublicPersistentTables<Module> =>
  typedFromEntries(
    typedEntries(module.tables).flatMap(([key, tableSpec]) =>
      tableSpec.public && !tableSpec.event ? ([[key, tableSpec]] as const) : [],
    ),
  ) as PublicPersistentTables<Module>

export const projectPublicEventTables = <Module extends AnyModuleSpec>(
  module: Module,
): PublicEventTables<Module> =>
  typedFromEntries(
    typedEntries(module.tables).flatMap(([key, tableSpec]) =>
      tableSpec.public && tableSpec.event ? ([[key, tableSpec]] as const) : [],
    ),
  ) as PublicEventTables<Module>

export const projectPublicReducers = <Module extends AnyModuleSpec>(
  module: Module,
): PublicReducers<Module> =>
  typedFromEntries(
    typedEntries(module.reducers).flatMap(([key, reducerSpec]) =>
      reducerSpec.public ? ([[key, reducerSpec]] as const) : [],
    ),
  ) as PublicReducers<Module>

export const projectPublicProcedures = <Module extends AnyModuleSpec>(
  module: Module,
): PublicProcedures<Module> =>
  typedFromEntries(
    typedEntries(module.procedures).flatMap(([key, procedureSpec]) =>
      procedureSpec.public ? ([[key, procedureSpec]] as const) : [],
    ),
  ) as PublicProcedures<Module>

export const projectHttpHandlers = <Module extends AnyModuleSpec>(
  module: Module,
): HttpHandlers<Module> => module.httpHandlers as HttpHandlers<Module>
