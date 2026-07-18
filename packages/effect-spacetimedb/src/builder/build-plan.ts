import {
  lifecycle as defineLifecycle,
  type LifecycleName,
  type LifecycleSpec,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"
import {
  type AnyModuleSpec,
  define as defineModule,
} from "../contract/module.ts"

import * as Server from "../server/bind.ts"

import type { HandlerInputDefinitions } from "../server/handler-types.ts"

import { defaultServerRuntimeMode } from "../server/runtime-layer.ts"

import {
  group,
  groupChecked,
  groupPrechecked,
  lifecycle,
} from "./group-builders.ts"
import { attachInternalStdbBuildPlan } from "./internal-build-plan.ts"
import {
  GroupImplTypeId,
  LifecycleImplTypeId,
  type AnyBuilderImpl,
  type AnyStdbModule,
  type BuildArgsWithoutRuntime,
  type BuildArgsWithRuntime,
  type BuildArgsWithRuntimeMode,
  type BuildOptions,
  type BuildSpec,
  type HandlersOf,
  type InternalBuilderImpl,
  type InternalGroupImpl,
  type InternalLifecycleImpl,
  type NoImplModuleMismatches,
  type RuntimeROfImpls,
  type StdbBuildPlan,
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
  handlersOf,
  plan: planModule,
}

const isRecordLike = (value: unknown): value is Record<PropertyKey, unknown> =>
  (typeof value === "object" && value !== null) || typeof value === "function"

const hasTypeId = (impl: unknown, typeId: string, expected: string): boolean =>
  isRecordLike(impl) && impl[typeId] === expected

const isGroupImpl = (
  impl: InternalBuilderImpl,
): impl is InternalGroupImpl<string, unknown> =>
  hasTypeId(impl, GroupImplTypeId, GroupImplTypeId)

const isLifecycleImpl = (
  impl: InternalBuilderImpl,
): impl is InternalLifecycleImpl<LifecycleName, unknown> =>
  hasTypeId(impl, LifecycleImplTypeId, LifecycleImplTypeId)

const invalidBuilderImplPath = (
  impl: unknown,
  index: number,
): ReadonlyArray<string | number> => {
  if (isRecordLike(impl)) {
    if (typeof impl.groupName === "string") {
      return ["groups", impl.groupName]
    }
    if (impl.kind === "stdbLifecycle") {
      return ["lifecycle"]
    }
  }

  return ["impls", index]
}

const invalidBuilderImpl = (impl: unknown, index: number): never => {
  throw diagnostic(
    "InvalidBuilderImpl",
    invalidBuilderImplPath(impl, index),
    `Builder implementation at impls[${index}] must be created by StdbBuilder.group, StdbBuilder.groupChecked, StdbBuilder.groupPrechecked, or StdbBuilder.lifecycle`,
  )
}

const unsealImpl = (
  impl: AnyBuilderImpl,
  index: number,
): InternalBuilderImpl => {
  if (!isRecordLike(impl)) {
    return invalidBuilderImpl(impl, index)
  }

  const record = impl as Record<PropertyKey, unknown>
  if (hasTypeId(impl, GroupImplTypeId, GroupImplTypeId)) {
    if (
      "module" in record &&
      "definitions" in record &&
      typeof record.groupName === "string"
    ) {
      return impl as unknown as InternalGroupImpl<string, unknown>
    }

    return invalidBuilderImpl(impl, index)
  }

  if (hasTypeId(impl, LifecycleImplTypeId, LifecycleImplTypeId)) {
    if (
      "module" in record &&
      "definitions" in record &&
      "lifecycleSpecs" in record &&
      record.kind === "stdbLifecycle"
    ) {
      return impl as unknown as InternalLifecycleImpl<LifecycleName, unknown>
    }

    return invalidBuilderImpl(impl, index)
  }

  return invalidBuilderImpl(impl, index)
}

const assertImplBelongsToModule = (
  module: AnyStdbModule,
  impl: InternalBuilderImpl,
): void => {
  if (impl.module === module) {
    return
  }

  if (isLifecycleImpl(impl)) {
    throw diagnostic(
      "UndeclaredLifecycleImpl",
      ["lifecycle"],
      `Lifecycle implementation was built for module "${impl.module.id}" but passed to build of "${module.id}"`,
    )
  }

  if (isGroupImpl(impl)) {
    throw diagnostic(
      "UndeclaredGroupImpl",
      ["groups", impl.groupName],
      `Group "${impl.groupName}" implementation was built for module "${impl.module.id}" but passed to build of "${module.id}"`,
    )
  }
}

const flatHandlerDefinitions = (
  definitions: Partial<HandlerInputDefinitions<AnyModuleSpec, unknown>>,
): Record<string, unknown> =>
  sortedRecord<unknown>([
    ...Object.entries(definitions.reducers ?? {}),
    ...Object.entries(definitions.procedures ?? {}),
    ...Object.entries(definitions.httpHandlers ?? {}),
    ...Object.entries(definitions.views ?? {}),
    ...Object.entries(definitions.lifecycle ?? {}),
  ])

function handlersOf<Module extends AnyStdbModule, Impl extends AnyBuilderImpl>(
  module: Module,
  impl: Impl & NoImplModuleMismatches<Module, readonly [Impl]>,
): Readonly<HandlersOf<Module, Impl>>
function handlersOf(
  module: AnyStdbModule,
  impl: AnyBuilderImpl,
): Readonly<Record<string, unknown>> {
  const unsealed = unsealImpl(impl, 0)
  assertImplBelongsToModule(module, unsealed)
  return Object.freeze(flatHandlerDefinitions(unsealed.definitions))
}

const defaultLifecycleSpecs = {
  init: defineLifecycle("init"),
  clientConnected: defineLifecycle("clientConnected"),
  clientDisconnected: defineLifecycle("clientDisconnected"),
} satisfies Required<LifecycleSpecs>

const collectLifecycleSpecs = (
  impls: ReadonlyArray<InternalBuilderImpl>,
  existingLifecycle: LifecycleSpecs,
  declaredLifecycle: LifecycleSpecs,
): LifecycleSpecs => {
  const entries: Array<readonly [string, LifecycleSpec]> = []
  const implemented = new Set<string>()
  const lifecycleSpecsByName: Readonly<
    Record<string, LifecycleSpec | undefined>
  > = {
    init: existingLifecycle.init ?? defaultLifecycleSpecs.init,
    clientConnected:
      existingLifecycle.clientConnected ??
      defaultLifecycleSpecs.clientConnected,
    clientDisconnected:
      existingLifecycle.clientDisconnected ??
      defaultLifecycleSpecs.clientDisconnected,
  }

  const addImplementation = (name: string, spec: LifecycleSpec): void => {
    if (implemented.has(name)) {
      throw duplicateCallableError(
        ["lifecycle", name],
        `Lifecycle hook implemented more than once: ${name}`,
      )
    }
    implemented.add(name)
    entries.push([name, spec])
  }

  for (const impl of impls) {
    if (isLifecycleImpl(impl)) {
      for (const [name, spec] of Object.entries(impl.lifecycleSpecs)) {
        addImplementation(name, spec)
      }
      continue
    }

    if (isGroupImpl(impl)) {
      for (const name of Object.keys(impl.definitions.lifecycle ?? {})) {
        const spec = lifecycleSpecsByName[name]
        if (spec != null) {
          addImplementation(name, spec)
        }
      }
    }
  }

  for (const name of Object.keys(declaredLifecycle)) {
    if (implemented.has(name)) {
      continue
    }
    throw diagnostic(
      "LifecycleNotImplemented",
      ["lifecycle", name],
      `Lifecycle hook not implemented: ${name}`,
    )
  }

  return sortedRecord(entries)
}

const moduleSpecWithLifecycle = <
  Module extends AnyStdbModule,
  Impls extends ReadonlyArray<unknown>,
>(
  module: Module,
  impls: ReadonlyArray<InternalBuilderImpl>,
): BuildSpec<Module, Impls> => {
  const base = module.spec
  const lifecycleSpecs = collectLifecycleSpecs(
    impls,
    base.lifecycle,
    module.lifecycle,
  )
  if (Object.keys(lifecycleSpecs).length === 0) {
    return module.spec as BuildSpec<Module, Impls>
  }

  return defineModule({
    name: base.name,
    settings: base.settings,
    tables: base.tables,
    views: base.views,
    reducers: base.reducers,
    procedures: base.procedures,
    httpHandlers: base.httpHandlers,
    httpGroups: base.httpGroups,
    reducerGroups: base.reducerGroups,
    procedureGroups: base.procedureGroups,
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
  ...args: BuildArgsWithoutRuntime<Module, Impls>
): StdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>

function planModule<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithRuntimeMode<Module, Impls>
): StdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>

function planModule<
  Module extends AnyStdbModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithRuntime<Module, Impls>
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
  const unsealedImpls = impls.map((impl, index) => unsealImpl(impl, index))

  for (const impl of unsealedImpls) {
    assertImplBelongsToModule(module, impl)

    if (!isGroupImpl(impl)) {
      continue
    }
    if (!expectedGroups.has(impl.groupName)) {
      throw diagnostic(
        "UndeclaredGroupImpl",
        ["groups", impl.groupName],
        `Group ${impl.groupName} is not declared by module ${module.spec.name}`,
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

  const spec = moduleSpecWithLifecycle<Module, Impls>(module, unsealedImpls)
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
  const typedServer = server as unknown as Server.InternalServerInstance<
    BuildSpec<Module, Impls>,
    RuntimeROfImpls<Impls>
  >
  const handlers = typedServer.handlers(
    mergeDefinitions(
      unsealedImpls as unknown as ReadonlyArray<
        RuntimeBuilderImpl<Module, RuntimeROfImpls<Impls>>
      >,
    ) as HandlerInputDefinitions<
      BuildSpec<Module, Impls>,
      RuntimeROfImpls<Impls>
    >,
  )

  return attachInternalStdbBuildPlan(
    {
      module: typedServer.module,
      scheduleBindings: typedServer.scheduleBindings,
      handlers,
    },
    typedServer,
  )
}
