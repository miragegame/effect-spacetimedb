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
  projectHttpHandlers,
  projectPublicEventTables,
  projectPublicPersistentTables,
  projectPublicProcedures,
  projectPublicReducers,
  resolveScheduleBindings,
  type ScheduleBinding,
} from "./module-projection.ts"
import type { ProjectedSubscriptionTargets } from "./subscription-target.ts"
import { makeTargetsFromModule } from "./subscription-target.ts"
import { reflect } from "./reflect.ts"

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
  assertValid(module)

  const publicTables = projectPublicPersistentTables(module)
  const publicEventTables = projectPublicEventTables(module)
  const reducerCallables: Array<readonly [string, unknown]> = []
  const procedureCallables: Array<readonly [string, unknown]> = []
  const httpHandlerCallables: Array<readonly [string, unknown]> = []

  reflect(module, {
    onReducer: ({ name, spec }) => {
      reducerCallables.push([
        name,
        reducerCallable(module.wireNames.functions[name] ?? name, spec, name),
      ])
    },
    onProcedure: ({ name, spec }) => {
      procedureCallables.push([
        name,
        procedureCallable(module.wireNames.functions[name] ?? name, spec, name),
      ])
    },
    onHttpHandler: ({ name, spec }) => {
      httpHandlerCallables.push([
        name,
        httpHandlerCallable(
          module.wireNames.functions[name] ?? name,
          spec,
          name,
        ),
      ])
    },
  })

  return {
    module,
    tables: module.tables,
    eventTables: publicEventTables,
    reducers: module.reducers,
    procedures: module.procedures,
    httpHandlers: module.httpHandlers,
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
    publicTables,
    publicEventTables,
    publicReducers: projectPublicReducers(module),
    publicProcedures: projectPublicProcedures(module),
    projectedHttpHandlers: projectHttpHandlers(module),
    targets: makeTargetsFromModule({
      publicTables,
      publicEventTables,
    }),
  }
}
