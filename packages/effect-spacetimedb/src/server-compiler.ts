// This entrypoint is intentionally separate from `effect-spacetimedb` and
// `effect-spacetimedb/server`.
//
// Importing `spacetimedb/server` in ordinary Bun/Vitest contexts pulls in the
// SpaceTimeDB module loader surface (`spacetime:sys@2.0`), which is only valid
// for actual STDB module compilation/evaluation. Keeping the compiler behind a
// dedicated subpath makes that boundary explicit.

import "./server-polyfills.ts"
import { internalStdbBuildPlan } from "./builder/internal-build-plan.ts"
import {
  type AnyBuilderImpl,
  type AnyStdbModule,
  type BuildArgsWithoutRuntime,
  type BuildArgsWithRuntime,
  type BuildArgsWithRuntimeMode,
  type BuildOptions,
  type BuildSpec,
  type RuntimeROfImpls,
  StdbBuilder,
  type StdbBuildPlan,
} from "./builder.ts"
import { type CompiledModule, compileModule } from "./server/compile-module.ts"
import {
  assertCompilerHostAbiCapabilities,
  CaseConversionPolicy,
  isRowTypedQuery,
  Range,
  Router,
  SenderError,
  schema,
  t,
  table,
} from "./server/host-abi-compiler.ts"
import { installServerRangeFactory } from "./server/db-handle-codec.ts"

installServerRangeFactory((from, to) => new Range(from, to))

assertCompilerHostAbiCapabilities({
  CaseConversionPolicy,
  isRowTypedQuery,
  Range,
  Router,
  schema,
  SenderError,
  t,
  table,
})

export function build<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithoutRuntime<Module, Impls>
): CompiledModule<BuildSpec<Module, Impls>>
export function build<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithRuntimeMode<Module, Impls>
): CompiledModule<BuildSpec<Module, Impls>>
export function build<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithRuntime<Module, Impls>
): CompiledModule<BuildSpec<Module, Impls>>
export function build<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls,
  options?: BuildOptions<RuntimeROfImpls<Impls>>,
): CompiledModule<BuildSpec<Module, Impls>> {
  const plan =
    options === undefined
      ? StdbBuilder.plan(module, impls as never)
      : StdbBuilder.plan(module, impls as never, options as never)
  const typedPlan = plan as StdbBuildPlan<
    BuildSpec<Module, Impls>,
    RuntimeROfImpls<Impls>
  >

  return compileModule<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>(
    internalStdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>(
      typedPlan,
    ),
  )
}

export type { CompiledModule }
export type { ModuleExport as ModuleExportGroup } from "spacetimedb/server"
