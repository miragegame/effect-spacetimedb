import { mountLabel, type NativeMount } from "../contract/mount.ts"
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

import { bindModule } from "../server/bind.ts"

import type {
  HandlerInputDefinitions,
  Handlers,
} from "../server/handler-types.ts"

import { group, groupPrechecked, lifecycle } from "./group-builders.ts"
import {
  attachInternalStdbBuildPlan,
  internalStdbBuildPlan,
  type InternalStdbBuildPlan,
  type MountBuildPlan,
} from "./internal-build-plan.ts"
import {
  GroupImplTypeId,
  LifecycleImplTypeId,
  type MountImpl,
  type InternalMountImpl,
  type BuildImplsWithRuntime,
  type AnyBuilderImpl,
  type AnyModule,
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
  type BuildPlan,
} from "./handler-types.ts"
import {
  diagnostic,
  duplicateCallableError,
  sortedRecord,
} from "./runtime-helpers.ts"
import type { RuntimeBuilderImpl } from "./runtime-impl.ts"
import { mergeDefinitions, normalizeRuntime } from "./runtime-impl.ts"

export type MountsOfModule<M extends AnyModule> = NonNullable<
  M["spec"]["mounts"]
>
export type MountKeys<M extends AnyModule, Kind extends string> = {
  [K in keyof MountsOfModule<M> & string]: MountsOfModule<M>[K] extends {
    readonly kind: Kind
  }
    ? K
    : never
}[keyof MountsOfModule<M> & string]
export type MountedSpec<
  M extends AnyModule,
  K extends keyof MountsOfModule<M>,
> = MountsOfModule<M>[K] extends { readonly module: infer Child }
  ? Child
  : never
export type NativeLibrary<
  M extends AnyModule,
  K extends keyof MountsOfModule<M>,
> = MountsOfModule<M>[K] extends NativeMount<infer L> ? L : never

const mount = <
  Parent extends AnyModule,
  const K extends MountKeys<Parent, "moduleMount">,
  Child extends AnyModule,
  const Impls extends readonly AnyBuilderImpl[],
>(
  parent: Parent,
  namespace: K,
  implementation: {
    readonly module: Child & { readonly spec: MountedSpec<Parent, K> }
    readonly implementations: BuildImplsWithRuntime<Child, Impls>
  },
): MountImpl<K, Parent["spec"]["name"], RuntimeROfImpls<Impls>> =>
  sealMount(parent, namespace, { kind: "moduleMount", ...implementation })

const mountNative = <
  Parent extends AnyModule,
  const K extends MountKeys<Parent, "nativeMount">,
>(
  parent: Parent,
  namespace: K,
  library: NativeLibrary<Parent, K>,
): MountImpl<K, Parent["spec"]["name"]> =>
  sealMount(parent, namespace, { kind: "nativeMount", library })

const mountImplementations = new WeakSet<object>()
const sealMount = <K extends string, Parent extends AnyModule, R>(
  module: Parent,
  namespace: K,
  implementation: InternalMountImpl["implementation"],
): MountImpl<K, Parent["spec"]["name"], R> => {
  const sealed = {
    kind: "stdbMount" as const,
    module,
    namespace,
    implementation,
    definitions: {},
  }
  mountImplementations.add(sealed)
  return sealed as unknown as MountImpl<K, Parent["spec"]["name"], R>
}

export const Builder = {
  /** Implement a declared Effect mount with its module and implementations. The parent compiles a fresh child schema when built. */
  mount,
  /** Implement a declared native mount with the library's namespace import. It must resolve the same server SDK instance as the parent. */
  mountNative,
  group,
  groupPrechecked,
  lifecycle,
  handlersOf,
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
    `Builder implementation at impls[${index}] must be created by Builder.group, Builder.groupPrechecked, or Builder.lifecycle`,
  )
}

const unsealImpl = (
  impl: AnyBuilderImpl,
  index: number,
): InternalBuilderImpl => {
  if (!isRecordLike(impl)) {
    return invalidBuilderImpl(impl, index)
  }

  if (mountImplementations.has(impl)) return impl as InternalMountImpl
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
  module: AnyModule,
  impl: InternalBuilderImpl,
): void => {
  if (impl.module === module) {
    return
  }

  if ("namespace" in impl)
    throw diagnostic(
      "UndeclaredMountImpl",
      ["mounts", impl.namespace],
      `${mountLabel(impl.namespace, impl.implementation.kind === "moduleMount" ? impl.implementation.module.id : undefined)} belongs to "${impl.module.id}". Pass this implementation to that parent's build or create one for "${module.id}".`,
    )
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

function handlersOf<Module extends AnyModule, Impl extends AnyBuilderImpl>(
  module: Module,
  impl: Impl & NoImplModuleMismatches<Module, readonly [Impl]>,
): Readonly<HandlersOf<Module, Impl>>
function handlersOf(
  module: AnyModule,
  impl: AnyBuilderImpl,
): Readonly<Record<string, unknown>> {
  const unsealed = unsealImpl(impl, 0)
  assertImplBelongsToModule(module, unsealed)
  return Object.freeze(flatHandlerDefinitions(unsealed.definitions))
}

const lifecycleSpecsDefault = {
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
    init: existingLifecycle.init ?? lifecycleSpecsDefault.init,
    clientConnected:
      existingLifecycle.clientConnected ??
      lifecycleSpecsDefault.clientConnected,
    clientDisconnected:
      existingLifecycle.clientDisconnected ??
      lifecycleSpecsDefault.clientDisconnected,
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
  Module extends AnyModule,
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
    environment: base.environment ?? {},
    mounts: base.mounts ?? {},
    tables: base.tables,
    views: base.views,
    reducers: base.reducers,
    procedures: base.procedures,
    httpHandlers: base.httpHandlers,
    httpGroupNames: base.httpGroupNames,
    httpGroups: base.httpGroups,
    reducerGroups: base.reducerGroups,
    procedureGroups: base.procedureGroups,
    lifecycle: {
      ...base.lifecycle,
      ...lifecycleSpecs,
    },
  }) as BuildSpec<Module, Impls>
}

export function planModule<
  Module extends AnyModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithoutRuntime<Module, Impls>
): BuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>

export function planModule<
  Module extends AnyModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithRuntimeMode<Module, Impls>
): BuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>

export function planModule<
  Module extends AnyModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithRuntime<Module, Impls>
): BuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>

export function planModule<
  Module extends AnyModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls,
  options?: BuildOptions<RuntimeROfImpls<Impls>>,
): BuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>> {
  const mounts: Record<string, MountBuildPlan> = Object.create(null)
  const declarations = module.spec.mounts ?? {}
  const expectedGroups = new Set(module.groups.map((group) => group.id))
  const implementedGroups = new Set<string>()
  const unsealedImpls = impls.map((impl, index) => unsealImpl(impl, index))

  for (const impl of unsealedImpls) {
    assertImplBelongsToModule(module, impl)

    if ("namespace" in impl) {
      const key = impl.namespace
      const mount = declarations[key]
      const implementation = impl.implementation
      const label = mountLabel(
        key,
        implementation.kind === "moduleMount"
          ? implementation.module.id
          : undefined,
      )
      if (
        mount === undefined ||
        mount.kind !== implementation.kind ||
        (mount.kind === "moduleMount" &&
          implementation.kind === "moduleMount" &&
          mount.module !== implementation.module.spec)
      ) {
        throw diagnostic(
          "UndeclaredMountImpl",
          ["mounts", key],
          mount === undefined
            ? `${label} has no declaration on "${module.id}". Declare the mount on the parent or remove the implementation.`
            : `${label} does not match the declaration on "${module.id}". Supply ${mount.kind === "moduleMount" ? `the declared module "${mount.module.name}" to Builder.mount` : "the native library to Builder.mountNative"}.`,
        )
      }
      if (Object.hasOwn(mounts, key))
        throw diagnostic(
          "DuplicateMountImpl",
          ["mounts", key],
          `${label} has more than one implementation. Keep exactly one in the build of "${module.id}".`,
        )
      if (implementation.kind === "nativeMount") mounts[key] = implementation
      else {
        const plan = planModule(
          implementation.module,
          implementation.implementations as never,
          (options ?? {}) as never,
        )
        if (Object.keys(plan.module.lifecycle).length > 0)
          throw diagnostic(
            "MountedLifecycle",
            ["mounts", key],
            `${label} adds lifecycle hooks. Declare and implement them on the root module.`,
          )
        mounts[key] = {
          kind: "moduleMount",
          plan: internalStdbBuildPlan(plan) as unknown as InternalStdbBuildPlan<
            AnyModuleSpec,
            unknown
          >,
        }
      }
      continue
    }
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

  for (const [key, declaration] of Object.entries(declarations)) {
    if (!Object.hasOwn(mounts, key))
      throw diagnostic(
        "MountNotImplemented",
        ["mounts", key],
        `${mountLabel(key, declaration.kind === "moduleMount" ? declaration.module.name : undefined)} is missing an implementation. Add Builder.${declaration.kind === "moduleMount" ? "mount" : "mountNative"} for "${key}" to the build of "${module.id}".`,
      )
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
  const server = bindModule<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>({
    module: spec,
    onDefect: options?.onDefect,
    ...(options?.runtime === undefined
      ? {}
      : { runtime: normalizeRuntime(options.runtime) }),
    ...(options?.runtimeMode === undefined
      ? {}
      : { runtimeMode: options.runtimeMode }),
  })

  return attachInternalStdbBuildPlan(
    {
      module: server.module,
      scheduleBindings: server.scheduleBindings,
      handlers: mergeDefinitions(
        unsealedImpls as unknown as ReadonlyArray<
          RuntimeBuilderImpl<Module, RuntimeROfImpls<Impls>>
        >,
      ) as Handlers<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>,
    },
    server,
    mounts,
  )
}
