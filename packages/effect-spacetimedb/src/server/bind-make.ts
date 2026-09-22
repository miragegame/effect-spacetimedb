import type { AnyModuleSpec } from "../contract/module.ts"
import { makeModulePlan } from "../module-plan.ts"
import { makeFromModulePlan } from "./bind-from-module-plan.ts"
import type { InternalServerInstance, MakeOptions } from "./handler-types.ts"
import { serverRuntimeModeDefault } from "./runtime-layer.ts"

export function make<Module extends AnyModuleSpec>(
  options: MakeOptions<Module> & { readonly runtime?: undefined },
): InternalServerInstance<Module>
export function make<Module extends AnyModuleSpec, RuntimeR>(
  options: MakeOptions<Module, RuntimeR> & {
    readonly runtime: MakeOptions<Module, RuntimeR>["runtime"]
  },
): InternalServerInstance<Module, RuntimeR>
export function make<Module extends AnyModuleSpec, RuntimeR = never>(
  options: MakeOptions<Module, RuntimeR>,
): InternalServerInstance<Module> | InternalServerInstance<Module, RuntimeR> {
  const runtimeMode = options.runtimeMode ?? serverRuntimeModeDefault
  return (
    options.runtime === undefined
      ? makeFromModulePlan({
          onDefect: options.onDefect,
          plan: makeModulePlan(options.module),
          runtimeMode,
        })
      : makeFromModulePlan({
          onDefect: options.onDefect,
          plan: makeModulePlan(options.module),
          runtime: options.runtime,
          runtimeMode,
        })
  ) as InternalServerInstance<Module, RuntimeR>
}
