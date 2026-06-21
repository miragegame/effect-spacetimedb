import {
  httpHandlerCallable,
  procedureCallable,
  reducerCallable,
  type HttpHandlerCallableDescriptor,
  type ProcedureCallableDescriptor,
  type ReducerCallableDescriptor,
} from "./callable-protocol.ts"
import type { ProjectedSubscriptionTargets } from "./client/subscription-target.ts"
import { makeTargetsCompanion } from "./client/subscription-target.ts"
import type { AnyModuleSpec } from "./contract/module.ts"
import { assertValidModule } from "./contract/module-validation.ts"
import {
  projectPublicEventTables,
  projectPublicPersistentTables,
  projectPublicProcedures,
  projectPublicReducers,
  projectHttpHandlers,
  type HttpHandlers,
  resolveScheduleBindings,
  type PublicEventTables,
  type PublicPersistentTables,
  type PublicProcedures,
  type PublicReducers,
  type ScheduleBinding,
} from "./module-projection.ts"

export type ModulePlan<Module extends AnyModuleSpec = AnyModuleSpec> = {
  readonly module: Module
  readonly tables: Module["tables"]
  readonly eventTables: PublicEventTables<Module>
  readonly reducers: Module["reducers"]
  readonly procedures: Module["procedures"]
  readonly httpHandlers: Module["httpHandlers"]
  readonly reducerCallables: {
    readonly [Key in keyof Module["reducers"] &
      string]: ReducerCallableDescriptor<Module["reducers"][Key]>
  }
  readonly procedureCallables: {
    readonly [Key in keyof Module["procedures"] &
      string]: ProcedureCallableDescriptor<Module["procedures"][Key]>
  }
  readonly httpHandlerCallables: {
    readonly [Key in keyof Module["httpHandlers"] &
      string]: HttpHandlerCallableDescriptor<Module["httpHandlers"][Key]>
  }
  readonly scheduleBindings: ReadonlyArray<ScheduleBinding>
  readonly publicTables: PublicPersistentTables<Module>
  readonly publicEventTables: PublicEventTables<Module>
  readonly publicReducers: PublicReducers<Module>
  readonly publicProcedures: PublicProcedures<Module>
  readonly projectedHttpHandlers: HttpHandlers<Module>
  readonly targets: ProjectedSubscriptionTargets<Module>
}

export const makeModulePlan = <Module extends AnyModuleSpec>(
  module: Module,
): ModulePlan<Module> => {
  assertValidModule(module)

  const publicTables = projectPublicPersistentTables(module)
  const publicEventTables = projectPublicEventTables(module)

  return {
    module,
    tables: module.tables,
    eventTables: publicEventTables,
    reducers: module.reducers,
    procedures: module.procedures,
    httpHandlers: module.httpHandlers,
    reducerCallables: Object.fromEntries(
      Object.entries(module.reducers).map(([key, spec]) => [
        key,
        reducerCallable(module.wireNames.functions[key] ?? key, spec, key),
      ]),
    ) as ModulePlan<Module>["reducerCallables"],
    procedureCallables: Object.fromEntries(
      Object.entries(module.procedures).map(([key, spec]) => [
        key,
        procedureCallable(module.wireNames.functions[key] ?? key, spec, key),
      ]),
    ) as ModulePlan<Module>["procedureCallables"],
    httpHandlerCallables: Object.fromEntries(
      Object.entries(module.httpHandlers).map(([key, spec]) => [
        key,
        httpHandlerCallable(module.wireNames.functions[key] ?? key, spec, key),
      ]),
    ) as ModulePlan<Module>["httpHandlerCallables"],
    scheduleBindings: resolveScheduleBindings(module),
    publicTables,
    publicEventTables,
    publicReducers: projectPublicReducers(module),
    publicProcedures: projectPublicProcedures(module),
    projectedHttpHandlers: projectHttpHandlers(module),
    targets: makeTargetsCompanion({
      publicTables,
      publicEventTables,
    }),
  }
}
