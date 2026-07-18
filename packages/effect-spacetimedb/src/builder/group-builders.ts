import {
  lifecycle as defineLifecycle,
  isLifecycleName,
  type LifecycleName,
  type LifecycleSpec,
} from "../contract/lifecycle.ts"

import {
  diagnostic,
  formatCandidateNames,
  makeHandlerDefinitionsFromRecord,
  sortedRecord,
} from "./runtime-helpers.ts"

import {
  GroupImplTypeId,
  LifecycleImplTypeId,
  type AnyStdbModule,
  type GroupHandlersRecord,
  type GroupImpl,
  type GroupMiddleware,
  type GroupNames,
  type InternalGroupImpl,
  type InternalLifecycleImpl,
  type LifecycleImpl,
  type ModuleNameOf,
  type RuntimeROfGroupHandlers,
  type RuntimeROfGroupMiddleware,
  type ValidateCheckedGroupHandlers,
  type ValidateGroupHandlers,
  type ValidateGroupMiddleware,
  type ValidateLifecycleHandlers,
  type ValidatePrecheckedGroupHandlers,
} from "./handler-types.ts"

export type GroupOptions<
  Module extends AnyStdbModule,
  Name extends GroupNames<Module>,
  Middleware extends GroupMiddleware | undefined,
> = {
  readonly middleware?: Middleware
} & ValidateGroupMiddleware<Module, Name, Middleware>

const makeGroupImpl = <
  Module extends AnyStdbModule,
  Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
  options?: { readonly middleware?: unknown },
): InternalGroupImpl<Name, unknown, ModuleNameOf<Module>> => {
  const group = module.groups.find((candidate) => candidate.id === name)
  if (group == null) {
    throw diagnostic(
      "UnknownGroup",
      ["groups", name],
      `Module ${module.spec.name} has no group named ${name}. Available groups: ${formatCandidateNames(module.groups.map((candidate) => candidate.id))}`,
    )
  }

  const built = makeHandlerDefinitionsFromRecord<Module, unknown>(
    group.id,
    group.endpoints,
    handlers,
    options?.middleware,
  )
  if (built.remainingNames.size > 0) {
    for (const missing of built.remainingNames) {
      throw diagnostic(
        "EndpointNotHandled",
        ["groups", group.id, missing],
        `Group ${group.id} is missing a handler for endpoint ${missing}. Available endpoints: ${formatCandidateNames(group.endpoints.map((endpoint) => endpoint.name))}`,
      )
    }
  }

  return {
    [GroupImplTypeId]: GroupImplTypeId,
    module,
    groupName: name,
    definitions: built.definitions,
  } as unknown as InternalGroupImpl<Name, unknown, ModuleNameOf<Module>>
}

export function group<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
  const Handlers extends GroupHandlersRecord<Module, Name>,
  const Middleware extends GroupMiddleware | undefined = undefined,
>(
  module: Module,
  name: Name,
  handlers: Handlers & ValidateGroupHandlers<Module, Name, Handlers>,
  options?: GroupOptions<Module, Name, Middleware>,
): GroupImpl<
  Name,
  RuntimeROfGroupHandlers<Handlers> | RuntimeROfGroupMiddleware<Middleware>,
  ModuleNameOf<Module>
>

export function group<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
  options?: { readonly middleware?: unknown },
): GroupImpl<Name, unknown, ModuleNameOf<Module>> {
  return makeGroupImpl(module, name, handlers, options)
}

export function groupChecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
  const Handlers extends Record<string, unknown>,
  const Middleware extends GroupMiddleware | undefined = undefined,
>(
  module: Module,
  name: Name,
  handlers: ValidateCheckedGroupHandlers<Module, Name, Handlers> & Handlers,
  options?: GroupOptions<Module, Name, Middleware>,
): GroupImpl<
  Name,
  RuntimeROfGroupHandlers<Handlers> | RuntimeROfGroupMiddleware<Middleware>,
  ModuleNameOf<Module>
>

export function groupChecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
  options?: { readonly middleware?: unknown },
): GroupImpl<Name, unknown, ModuleNameOf<Module>> {
  return makeGroupImpl(module, name, handlers, options)
}

// Prechecked handlers are already shape-validated at their declaration site;
// this erased entrypoint does not infer additional runtime requirements.
export function groupPrechecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
  const Handlers extends Record<string, unknown>,
  const Middleware extends GroupMiddleware | undefined = undefined,
>(
  module: Module,
  name: Name,
  handlers: ValidatePrecheckedGroupHandlers<Module, Name, Handlers> & Handlers,
  options?: GroupOptions<Module, Name, Middleware>,
): GroupImpl<Name, RuntimeROfGroupMiddleware<Middleware>, ModuleNameOf<Module>>

export function groupPrechecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
  options?: { readonly middleware?: unknown },
): GroupImpl<Name, unknown, ModuleNameOf<Module>> {
  return makeGroupImpl(module, name, handlers, options)
}

const makeLifecycleImpl = <Module extends AnyStdbModule>(
  module: Module,
  handlers: Record<string, unknown>,
): InternalLifecycleImpl<LifecycleName, unknown, ModuleNameOf<Module>> => {
  const lifecycleEntries: Array<readonly [string, unknown]> = []
  const specEntries: Array<readonly [string, LifecycleSpec]> = []

  for (const [name, handler] of Object.entries(handlers)) {
    if (!isLifecycleName(name)) {
      throw diagnostic(
        "UnknownEndpoint",
        ["lifecycle", name],
        `StdbBuilder.lifecycle received unknown lifecycle hook ${name}`,
      )
    }

    lifecycleEntries.push([name, handler])
    specEntries.push([name, defineLifecycle(name)])
  }

  return {
    [LifecycleImplTypeId]: LifecycleImplTypeId,
    kind: "stdbLifecycle",
    module,
    lifecycleSpecs: sortedRecord(specEntries),
    definitions:
      lifecycleEntries.length > 0
        ? { lifecycle: sortedRecord(lifecycleEntries) }
        : {},
  } as unknown as InternalLifecycleImpl<
    LifecycleName,
    unknown,
    ModuleNameOf<Module>
  >
}

export function lifecycle<Module extends AnyStdbModule, const Handlers>(
  module: Module,
  handlers: Handlers & ValidateLifecycleHandlers<Module, Handlers>,
): LifecycleImpl<
  keyof Handlers & LifecycleName,
  RuntimeROfGroupHandlers<Handlers>,
  ModuleNameOf<Module>
>

export function lifecycle<Module extends AnyStdbModule>(
  module: Module,
  handlers: Record<string, unknown>,
): LifecycleImpl<LifecycleName, unknown, ModuleNameOf<Module>> {
  return makeLifecycleImpl(module, handlers)
}
