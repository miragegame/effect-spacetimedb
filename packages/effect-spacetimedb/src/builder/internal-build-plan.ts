import type { AnyModuleSpec } from "../contract/module.ts"
import type * as Server from "../server/bind.ts"

import type { StdbBuildPlan } from "./handler-types.ts"

export const InternalStdbBuildPlanSymbol = Symbol(
  "effect-spacetimedb/InternalStdbBuildPlan",
)

export type InternalStdbBuildPlan<
  Module extends AnyModuleSpec = AnyModuleSpec,
  RuntimeR = never,
> = StdbBuildPlan<Module, RuntimeR> & {
  readonly [InternalStdbBuildPlanSymbol]: {
    readonly server: Server.InternalServerInstance<Module, RuntimeR>
  }
}

export const attachInternalStdbBuildPlan = <
  Module extends AnyModuleSpec,
  RuntimeR,
>(
  plan: StdbBuildPlan<Module, RuntimeR>,
  server: Server.InternalServerInstance<Module, RuntimeR>,
): InternalStdbBuildPlan<Module, RuntimeR> => {
  Object.defineProperty(plan, InternalStdbBuildPlanSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { server },
  })
  return plan as InternalStdbBuildPlan<Module, RuntimeR>
}

export const internalStdbBuildPlan = <Module extends AnyModuleSpec, RuntimeR>(
  plan: StdbBuildPlan<Module, RuntimeR>,
): InternalStdbBuildPlan<Module, RuntimeR> =>
  plan as InternalStdbBuildPlan<Module, RuntimeR>
