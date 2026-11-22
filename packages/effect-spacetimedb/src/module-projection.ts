import type { MembersByPath } from "./member-path.ts"
import type { AnyModuleSpec } from "./contract/module.ts"
import { outboxResultMetadataOf } from "./contract/outbox-table.ts"
import type { AnyViewSpec } from "./contract/view.ts"
import type {
  ArrayValueType,
  EncodedOf,
  OptionValueType,
  TypeOf,
} from "./contract/type.ts"

export type ScheduleBinding = {
  readonly tableKey: string
  readonly tableName: string
  readonly targetKey: string
  readonly targetKind: "reducer" | "procedure"
  readonly allowExternalCallers: boolean
}

/** An outbox table and the settle reducer the host runs for its rows. */
export type OutboxResultBinding = {
  readonly tableKey: string
  readonly tableName: string
  readonly settleKey: string
}

export type PublicPersistentTables<Module extends AnyModuleSpec> = {
  readonly [Key in keyof MembersByPath<Module, "tables"> &
    string as MembersByPath<Module, "tables">[Key]["public"] extends true
    ? MembersByPath<Module, "tables">[Key]["event"] extends true
      ? never
      : Key
    : never]: MembersByPath<Module, "tables">[Key]
}

export type PublicEventTables<Module extends AnyModuleSpec> = {
  readonly [Key in keyof MembersByPath<Module, "tables"> &
    string as MembersByPath<Module, "tables">[Key]["public"] extends true
    ? MembersByPath<Module, "tables">[Key]["event"] extends true
      ? Key
      : never
    : never]: MembersByPath<Module, "tables">[Key]
}

export type PublicViews<Module extends AnyModuleSpec> = {
  readonly [Key in keyof MembersByPath<Module, "views"> &
    string]: MembersByPath<Module, "views">[Key]
}

export type PublicViewKeys<Module extends AnyModuleSpec> =
  keyof PublicViews<Module> & string

/** A view's arguments: `{}` for a view that declares no params. */
export type ViewCallArgsOf<View extends AnyViewSpec> = TypeOf<View["params"]>

/** Whether a client must pass arguments to subscribe to the view. */
export type ViewTakesArgs<View extends AnyViewSpec> = [
  keyof ViewCallArgsOf<View>,
] extends [never]
  ? false
  : true

export type ViewItemOf<View extends AnyViewSpec> =
  View["returns"] extends ArrayValueType<infer Item>
    ? Item
    : View["returns"] extends OptionValueType<infer Item>
      ? Item
      : never

export type ViewRowOf<View extends AnyViewSpec> = TypeOf<ViewItemOf<View>>

export type WsViewRowOf<View extends AnyViewSpec> = EncodedOf<ViewItemOf<View>>

/**
 * Functions the host itself runs: the target of a schedule and the settle
 * reducer of an outbox. A typed client never offers them. Lifecycle reducers
 * need no entry here because they live outside `reducers`.
 */
export type HostInvokedFunction =
  | { readonly scheduled: unknown }
  | { readonly outboxResult: unknown }

export type PublicReducers<Module extends AnyModuleSpec> = {
  readonly [Key in keyof MembersByPath<Module, "reducers"> &
    string as MembersByPath<Module, "reducers">[Key] extends HostInvokedFunction
    ? never
    : Key]: MembersByPath<Module, "reducers">[Key]
}

export type PublicProcedures<Module extends AnyModuleSpec> = {
  readonly [Key in keyof MembersByPath<Module, "procedures"> &
    string as MembersByPath<
    Module,
    "procedures"
  >[Key] extends HostInvokedFunction
    ? never
    : Key]: MembersByPath<Module, "procedures">[Key]
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

export const isScheduledFunction = (spec: unknown): boolean =>
  scheduledMetadataOf(spec) !== undefined

export const isHostInvoked = (spec: unknown): boolean =>
  isScheduledFunction(spec) || outboxResultMetadataOf(spec) !== undefined

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

/** Twin of `resolveScheduleBindings` for settle reducers and their outboxes. */
export const resolveOutboxResultBindings = <Module extends AnyModuleSpec>(
  module: Module,
): ReadonlyArray<OutboxResultBinding> => {
  const bindings: Array<OutboxResultBinding> = []

  for (const [settleKey, reducer] of Object.entries(module.reducers)) {
    const metadata = outboxResultMetadataOf(reducer)
    if (metadata === undefined) {
      continue
    }

    const entry = Object.entries(module.tables).find(
      ([, table]) => table === metadata.table,
    )
    if (entry === undefined) {
      throw new Error(
        `Settle reducer ${settleKey} references an outbox table that is not registered on module ${module.name}`,
      )
    }
    bindings.push({
      tableKey: entry[0],
      tableName: entry[1].name,
      settleKey,
    })
  }

  return bindings
}

export const projectPublicPersistentTables = <Module extends AnyModuleSpec>(
  tables: MembersByPath<Module, "tables">,
): PublicPersistentTables<Module> =>
  Object.fromEntries(
    Object.entries(tables).filter(
      ([, tableSpec]) => tableSpec.public && !tableSpec.event,
    ),
  ) as PublicPersistentTables<Module>

export const projectPublicEventTables = <Module extends AnyModuleSpec>(
  tables: MembersByPath<Module, "tables">,
): PublicEventTables<Module> =>
  Object.fromEntries(
    Object.entries(tables).filter(
      ([, tableSpec]) => tableSpec.public && tableSpec.event,
    ),
  ) as PublicEventTables<Module>

export const projectPublicReducers = <Module extends AnyModuleSpec>(
  reducers: MembersByPath<Module, "reducers">,
): PublicReducers<Module> =>
  Object.fromEntries(
    Object.entries(reducers).filter(
      ([, reducerSpec]) => !isHostInvoked(reducerSpec),
    ),
  ) as PublicReducers<Module>

export const projectPublicProcedures = <Module extends AnyModuleSpec>(
  procedures: MembersByPath<Module, "procedures">,
): PublicProcedures<Module> =>
  Object.fromEntries(
    Object.entries(procedures).filter(
      ([, procedureSpec]) => !isHostInvoked(procedureSpec),
    ),
  ) as PublicProcedures<Module>

export const projectHttpHandlers = <Module extends AnyModuleSpec>(
  module: Module,
): HttpHandlers<Module> => module.httpHandlers as HttpHandlers<Module>
