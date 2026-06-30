import {
  type LifecycleSpec,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"
import { define as defineModule } from "../contract/module.ts"

import * as Server from "../server/bind.ts"

import type { HandlerInputDefinitions } from "../server/handler-types.ts"

import { defaultServerRuntimeMode } from "../server/runtime-layer.ts"

import {
  group,
  groupChecked,
  groupPrechecked,
  lifecycle,
} from "./group-builders.ts"
import type {
  AnyBuilderImpl,
  AnyGroupImpl,
  AnyLifecycleImpl,
  AnyStdbModule,
  BuildOptions,
  BuildRuntime,
  BuildSpec,
  CoverAllGroups,
  CoverScheduleBindings,
  RuntimeROfImpls,
  StdbBuildPlan,
} from "./handler-types.ts"
import {
  diagnostic,
  duplicateCallableError,
  sortedRecord,
} from "./runtime-helpers.ts"
import type { RuntimeBuilderImpl } from "./runtime-impl.ts"
import { mergeDefinitions, normalizeRuntime } from "./runtime-impl.ts"

export const StdbBuilder = {
  group,
  groupChecked,
  groupPrechecked,
  lifecycle,
  plan: planModule,
}

const isRecordLike = (value: unknown): value is Record<PropertyKey, unknown> =>
  (typeof value === "object" && value !== null) || typeof value === "function"

const isGroupImpl = (impl: AnyBuilderImpl): impl is AnyGroupImpl =>
  isRecordLike(impl) && "groupName" in impl

const isLifecycleImpl = (impl: AnyBuilderImpl): impl is AnyLifecycleImpl => {
  if (!isRecordLike(impl) || !("kind" in impl)) {
    return false
  }

  return impl.kind === "stdbLifecycle"
}

const assertImplBelongsToModule = (
  module: AnyStdbModule,
  impl: AnyBuilderImpl,
): void => {
  if (!isRecordLike(impl) || !("module" in impl)) {
    return
  }

  if (impl.module === module) {
    return
  }

  if (isLifecycleImpl(impl)) {
    throw diagnostic(
      "UnknownEndpoint",
      ["lifecycle"],
      "Lifecycle implementation was built for a different module",
    )
  }

  if (isGroupImpl(impl)) {
    throw diagnostic(
      "UndeclaredGroupImpl",
      ["groups", impl.groupName],
      `Group ${impl.groupName} implementation was built for a different module`,
    )
  }
}

const collectLifecycleSpecs = (
  impls: ReadonlyArray<AnyBuilderImpl>,
): LifecycleSpecs => {
  const entries: Array<readonly [string, LifecycleSpec]> = []
  const seen = new Set<string>()

  for (const impl of impls) {
    if (!isLifecycleImpl(impl)) {
      continue
    }

    const lifecycleImpl = impl as unknown as {
      readonly lifecycleSpecs: LifecycleSpecs
    }
    for (const [name, spec] of Object.entries(lifecycleImpl.lifecycleSpecs)) {
      if (seen.has(name)) {
        throw duplicateCallableError(
          ["lifecycle", name],
          `Lifecycle hook implemented more than once: ${name}`,
        )
      }
      seen.add(name)
      entries.push([name, spec])
    }
  }

  return sortedRecord(entries)
}

const moduleSpecWithLifecycle = <
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
>(
  module: Module,
  impls: ReadonlyArray<AnyBuilderImpl>,
): BuildSpec<Module, Impls> => {
  const lifecycleSpecs = collectLifecycleSpecs(impls)
  if (Object.keys(lifecycleSpecs).length === 0) {
    return module.spec as BuildSpec<Module, Impls>
  }

  const base = module.spec
  return defineModule({
    name: base.name,
    settings: base.settings,
    tables: base.tables,
    views: base.views,
    reducers: base.reducers,
    procedures: base.procedures,
    httpHandlers: base.httpHandlers,
    lifecycle: {
      ...base.lifecycle,
      ...lifecycleSpecs,
    },
  }) as BuildSpec<Module, Impls>
}

function planModule<
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
): StdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>

function planModule<
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
  options: BuildOptions<RuntimeROfImpls<Impls>> & {
    readonly runtime?: undefined
    readonly runtimeMode: NonNullable<
      BuildOptions<RuntimeROfImpls<Impls>>["runtimeMode"]
    >
  },
): StdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>

function planModule<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls & CoverAllGroups<Module, Impls> & CoverScheduleBindings<Module>,
  options: BuildOptions<RuntimeROfImpls<Impls>> & {
    readonly runtime: BuildRuntime<RuntimeROfImpls<Impls>>
  },
): StdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>

function planModule<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls,
  options?: BuildOptions<RuntimeROfImpls<Impls>>,
): StdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>> {
  const expectedGroups = new Set(module.groups.map((group) => group.id))
  const implementedGroups = new Set<string>()
  for (const impl of impls) {
    assertImplBelongsToModule(module, impl)

    if (!isGroupImpl(impl)) {
      continue
    }
    if (!expectedGroups.has(impl.groupName)) {
      throw diagnostic(
        "UndeclaredGroupImpl",
        ["groups", impl.groupName],
        `Group ${impl.groupName} is not declared by module`,
      )
    }
    if (implementedGroups.has(impl.groupName)) {
      throw diagnostic(
        "DuplicateGroupImpl",
        ["groups", impl.groupName],
        `Group implemented more than once: ${impl.groupName}`,
      )
    }
    implementedGroups.add(impl.groupName)
  }

  for (const group of expectedGroups) {
    if (!implementedGroups.has(group)) {
      throw diagnostic(
        "GroupNotImplemented",
        ["groups", group],
        `Group not implemented: ${group}`,
      )
    }
  }

  const spec = moduleSpecWithLifecycle<Module, Impls>(module, impls)
  const runtime =
    options?.runtime === undefined
      ? undefined
      : normalizeRuntime(options.runtime)
  const runtimeMode = options?.runtimeMode ?? defaultServerRuntimeMode
  const server =
    runtime === undefined
      ? Server.make({
          module: spec,
          runtimeMode,
        })
      : Server.make({
          module: spec,
          runtime,
          runtimeMode,
        })
  const typedServer = server as unknown as Server.ServerInstance<
    BuildSpec<Module, Impls>,
    RuntimeROfImpls<Impls>
  >
  const handlers = typedServer.handlers(
    mergeDefinitions(
      impls as unknown as ReadonlyArray<
        RuntimeBuilderImpl<Module, RuntimeROfImpls<Impls>>
      >,
    ) as HandlerInputDefinitions<
      BuildSpec<Module, Impls>,
      RuntimeROfImpls<Impls>
    >,
  )

  return {
    server: typedServer,
    handlers,
  }
}
