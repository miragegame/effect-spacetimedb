// lint-ignore: unused-files - package export map exposes this server compiler entrypoint.
// This entrypoint is intentionally separate from `effect-spacetimedb` and
// `effect-spacetimedb/server`.
//
// Importing `spacetimedb/server` in ordinary Bun/Vitest contexts pulls in the
// SpaceTimeDB module loader surface (`spacetime:sys@2.0`), which is only valid
// for actual STDB module compilation/evaluation. Keeping the compiler behind a
// dedicated subpath makes that boundary explicit.

import {
  StdbBuilder,
  type AnyBuilderImpl,
  type AnyStdbModule,
  type BuildRuntime,
  type BuildSpec,
  type CoverAllGroups,
  type CoverScheduleBindings,
  type RuntimeROfImpls,
} from "./builder.ts"
import { compileModule, type CompiledModule } from "./server/compile-module.ts"

const ServerCompilerEntrypoint = "effect-spacetimedb/server-compiler" as const
void ServerCompilerEntrypoint

export function build<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls &
    CoverAllGroups<Module, Impls> &
    CoverScheduleBindings<Module> &
    ([RuntimeROfImpls<Impls>] extends [never]
      ? unknown
      : { readonly __runtimeRequired: RuntimeROfImpls<Impls> }),
): CompiledModule<BuildSpec<Module, Impls>>
export function build<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls & CoverAllGroups<Module, Impls> & CoverScheduleBindings<Module>,
  options: { readonly runtime: BuildRuntime<RuntimeROfImpls<Impls>> },
): CompiledModule<BuildSpec<Module, Impls>>
export function build<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls,
  options?: { readonly runtime: BuildRuntime<RuntimeROfImpls<Impls>> },
): CompiledModule<BuildSpec<Module, Impls>> {
  const plan =
    options === undefined
      ? StdbBuilder.plan(module, impls as never)
      : StdbBuilder.plan(module, impls as never, options as never)

  return compileModule(plan as never)
}

export { compileModule, type CompiledModule }
