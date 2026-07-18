import {
  attachInternalStdbBuildPlan,
  type InternalStdbBuildPlan,
} from "../../src/builder/internal-build-plan.ts"
import type { AnyModuleSpec } from "../../src/contract/module.ts"
import {
  compileModule as compileInternalModule,
  type CompiledModule,
} from "../../src/server/compile-module.ts"
import type * as Server from "../../src/server/bind.ts"

export const compileModule = <
  Module extends AnyModuleSpec,
  RuntimeR = never,
>(options: {
  readonly server: Server.InternalServerInstance<Module, RuntimeR>
  readonly handlers: Server.Handlers<Module, RuntimeR>
}): CompiledModule<Module> =>
  compileInternalModule(
    attachInternalStdbBuildPlan(
      {
        module: options.server.module,
        scheduleBindings: options.server.scheduleBindings,
        handlers: options.handlers,
      },
      options.server,
    ) satisfies InternalStdbBuildPlan<Module, RuntimeR>,
  )
