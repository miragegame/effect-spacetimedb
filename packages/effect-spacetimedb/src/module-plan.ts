import { specsByPath, type MembersByPath } from "./member-path.ts"
import {
  type HttpHandlerCallableDescriptor,
  httpHandlerCallable,
  type ProcedureCallableDescriptor,
  procedureCallable,
  type ReducerCallableDescriptor,
  reducerCallable,
} from "./callable-protocol.ts"
import type { AnyModuleSpec } from "./contract/module.ts"
import { assertValid } from "./contract/module-validation.ts"
import {
  type HttpHandlers,
  type PublicEventTables,
  type PublicPersistentTables,
  type PublicProcedures,
  type PublicReducers,
  type PublicViews,
  projectHttpHandlers,
  projectPublicEventTables,
  projectPublicPersistentTables,
  projectPublicProcedures,
  projectPublicReducers,
  type OutboxResultBinding,
  resolveOutboxResultBindings,
  resolveScheduleBindings,
  type ScheduleBinding,
} from "./module-projection.ts"
import type { ProjectedSubscriptionTargets } from "./subscription-target.ts"
import { makeTargetsFromModule } from "./subscription-target.ts"
import {
  nestedTargets,
  type FlatSubscriptionTargets,
} from "./subscription-target.ts"

export type PlannedMember = {
  readonly accessorPath: readonly string[]
  readonly wireName: string
  readonly owner: AnyModuleSpec
  readonly key: string
}

export type PlanSection = "tables" | "views" | "reducers" | "procedures"
const planSections = ["tables", "views", "reducers", "procedures"] as const

/** Path keys address members in a projection without changing the local spec or table identity. */
const planMembers = (
  module: AnyModuleSpec,
  mounts: Readonly<Record<string, ModulePlan>>,
) => {
  const members = {
    tables: {},
    views: {},
    reducers: {},
    procedures: {},
  } satisfies Record<PlanSection, unknown>
  for (const section of planSections) {
    const entries: Record<string, PlannedMember> = Object.create(null)
    const names =
      module.wireNames[
        section === "reducers" || section === "procedures"
          ? "functions"
          : section
      ]
    for (const key of Object.keys(module[section])) {
      entries[key] = {
        accessorPath: [key],
        wireName: names[key] ?? key,
        owner: module,
        key,
      }
    }
    for (const [namespace, plan] of Object.entries(mounts)) {
      const mount = module.mounts![namespace]!
      for (const [path, member] of Object.entries(plan.members[section])) {
        entries[namespace + "." + path] = {
          ...member,
          accessorPath: [namespace, ...member.accessorPath],
          wireName: mount.wireNamespace + "." + member.wireName,
        }
      }
    }
    members[section] = entries
  }
  return members as Readonly<
    Record<PlanSection, Readonly<Record<string, PlannedMember>>>
  >
}

export type ModulePlan<Module extends AnyModuleSpec = AnyModuleSpec> = {
  readonly mounts: Readonly<Record<string, ModulePlan>>
  readonly members: Readonly<
    Record<PlanSection, Readonly<Record<string, PlannedMember>>>
  >
  readonly module: Module
  readonly reducerCallables: {
    readonly [Key in keyof MembersByPath<Module, "reducers"> &
      string]: ReducerCallableDescriptor<MembersByPath<Module, "reducers">[Key]>
  }
  readonly procedureCallables: {
    readonly [Key in keyof MembersByPath<Module, "procedures"> &
      string]: ProcedureCallableDescriptor<
      MembersByPath<Module, "procedures">[Key]
    >
  }
  readonly httpHandlerCallables: {
    readonly [Key in keyof Module["httpHandlers"] &
      string]: HttpHandlerCallableDescriptor<Module["httpHandlers"][Key]>
  }
  readonly scheduleBindings: ReadonlyArray<ScheduleBinding>
  readonly outboxResultBindings: ReadonlyArray<OutboxResultBinding>
  readonly publicTables: PublicPersistentTables<Module>
  readonly publicEventTables: PublicEventTables<Module>
  readonly publicViews: PublicViews<Module>
  readonly publicReducers: PublicReducers<Module>
  readonly publicProcedures: PublicProcedures<Module>
  readonly projectedHttpHandlers: HttpHandlers<Module>
  readonly tables: MembersByPath<Module, "tables">
  readonly flatTargets: FlatSubscriptionTargets<Module>
  readonly targets: ProjectedSubscriptionTargets<Module>
}

const buildModulePlan = <Module extends AnyModuleSpec>(
  module: Module,
): ModulePlan<Module> => {
  assertValid(module)

  const mounts = Object.fromEntries(
    Object.entries(module.mounts ?? {}).flatMap(([key, mount]) =>
      mount.kind === "moduleMount"
        ? [[key, makeModulePlan(mount.module)] as const]
        : [],
    ),
  )
  const members = planMembers(module, mounts)
  const tables = specsByPath<Module, "tables">(members.tables, "tables")
  const publicTables = projectPublicPersistentTables<Module>(tables)
  const publicEventTables = projectPublicEventTables<Module>(tables)
  const publicViews = specsByPath<Module, "views">(members.views, "views")
  const reducers = specsByPath<Module, "reducers">(members.reducers, "reducers")
  const procedures = specsByPath<Module, "procedures">(
    members.procedures,
    "procedures",
  )
  const reducerCallables = Object.entries(members.reducers).map(
    ([path, { owner, key, wireName }]) =>
      [path, reducerCallable(wireName, owner.reducers[key]!, path)] as const,
  )
  const procedureCallables = Object.entries(members.procedures).map(
    ([path, { owner, key, wireName }]) =>
      [
        path,
        procedureCallable(wireName, owner.procedures[key]!, path),
      ] as const,
  )
  const httpHandlerCallables = Object.entries(module.httpHandlers).map(
    ([key, spec]) =>
      [
        key,
        httpHandlerCallable(module.wireNames.functions[key] ?? key, spec, key),
      ] as const,
  )
  const flatTargets = makeTargetsFromModule<Module>({
    members,
    publicTables,
    publicEventTables,
    publicViews,
  })
  return {
    mounts,
    members,
    tables,
    flatTargets,
    module,
    reducerCallables: Object.fromEntries(
      reducerCallables,
    ) as ModulePlan<Module>["reducerCallables"],
    procedureCallables: Object.fromEntries(
      procedureCallables,
    ) as ModulePlan<Module>["procedureCallables"],
    httpHandlerCallables: Object.fromEntries(
      httpHandlerCallables,
    ) as ModulePlan<Module>["httpHandlerCallables"],
    scheduleBindings: resolveScheduleBindings(module),
    outboxResultBindings: resolveOutboxResultBindings(module),
    publicTables,
    publicEventTables,
    publicViews,
    publicReducers: projectPublicReducers<Module>(reducers),
    publicProcedures: projectPublicProcedures<Module>(procedures),
    projectedHttpHandlers: projectHttpHandlers(module),
    targets: nestedTargets(flatTargets),
  }
}

const plansByModule = new WeakMap<AnyModuleSpec, unknown>()

/**
 * The plan of `module`, validated and built once per module. A module spec
 * never changes once made, and a client is cheap only if this is: a server may
 * build one per request, and a large contract takes tens of milliseconds to
 * validate. A module that fails validation is not remembered, so it throws
 * every time.
 */
export const makeModulePlan = <Module extends AnyModuleSpec>(
  module: Module,
): ModulePlan<Module> => {
  const existing = plansByModule.get(module)
  if (existing !== undefined) {
    return existing as ModulePlan<Module>
  }
  const plan = buildModulePlan(module)
  plansByModule.set(module, plan)
  return plan
}
