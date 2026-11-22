import type { AnyModuleSpec } from "../contract/module.ts"
import type { BoundModule } from "../server/handler-types.ts"

import type { BuildPlan } from "./handler-types.ts"

export const InternalStdbBuildPlanSymbol = Symbol(
  "effect-spacetimedb/InternalStdbBuildPlan",
)

export type MountBuildPlan =
  | { readonly kind: "nativeMount"; readonly library: unknown }
  | {
      readonly kind: "moduleMount"
      readonly plan: InternalStdbBuildPlan<AnyModuleSpec, unknown>
    }

export type InternalStdbBuildPlan<
  Module extends AnyModuleSpec = AnyModuleSpec,
  RuntimeR = never,
> = BuildPlan<Module, RuntimeR> & {
  readonly [InternalStdbBuildPlanSymbol]: {
    readonly mounts: Readonly<Record<string, MountBuildPlan>>
    readonly server: BoundModule<Module, RuntimeR>
  }
}

export const attachInternalStdbBuildPlan = <
  Module extends AnyModuleSpec,
  RuntimeR,
>(
  plan: BuildPlan<Module, RuntimeR>,
  server: BoundModule<Module, RuntimeR>,
  mounts: Readonly<Record<string, MountBuildPlan>> = {},
): InternalStdbBuildPlan<Module, RuntimeR> => {
  Object.defineProperty(plan, InternalStdbBuildPlanSymbol, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: { server, mounts },
  })
  return plan as InternalStdbBuildPlan<Module, RuntimeR>
}

export const internalStdbBuildPlan = <Module extends AnyModuleSpec, RuntimeR>(
  plan: BuildPlan<Module, RuntimeR>,
): InternalStdbBuildPlan<Module, RuntimeR> =>
  plan as InternalStdbBuildPlan<Module, RuntimeR>
