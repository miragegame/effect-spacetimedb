import {
  lifecycle as defineLifecycle,
  isLifecycleName,
  type LifecycleName,
  type LifecycleSpec,
} from "../contract/lifecycle.ts"

import {
  diagnostic,
  makeHandlerDefinitionsFromRecord,
  sortedRecord,
} from "./runtime-helpers.ts"

import type {
  AnyStdbModule,
  GroupCheckedHandlers,
  GroupHandlersRecord,
  GroupImpl,
  GroupNames,
  LifecycleImpl,
  RuntimeROfGroupHandlers,
  ValidateCheckedGroupHandlers,
  ValidateGroupHandlers,
  ValidateLifecycleHandlers,
} from "./handler-types.ts"

export const makeGroupImpl = <
  Module extends AnyStdbModule,
  Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
): GroupImpl<Module, Name, unknown> => {
  const group = module.groups.find((candidate) => candidate.id === name)
  if (group == null) {
    throw diagnostic("UnknownGroup", ["groups", name], `Unknown group ${name}`)
  }

  const built = makeHandlerDefinitionsFromRecord<Module, unknown>(
    group.id,
    group.endpoints,
    handlers,
  )
  if (built.remainingNames.size > 0) {
    for (const missing of built.remainingNames) {
      throw diagnostic(
        "EndpointNotHandled",
        ["groups", group.id, missing],
        `Endpoint not handled: ${missing}`,
      )
    }
  }

  return {
    module,
    groupName: name,
    definitions: built.definitions,
  } as GroupImpl<Module, Name, unknown>
}

export function group<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
  const Handlers extends GroupHandlersRecord<Module, Name>,
>(
  module: Module,
  name: Name,
  handlers: Handlers & ValidateGroupHandlers<Module, Name, Handlers>,
): GroupImpl<Module, Name, RuntimeROfGroupHandlers<Handlers>>

export function group<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
): GroupImpl<Module, Name, unknown> {
  return makeGroupImpl(module, name, handlers)
}

export function groupChecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
  const Handlers extends Record<string, unknown>,
>(
  module: Module,
  name: Name,
  handlers: ValidateCheckedGroupHandlers<Module, Name, Handlers> & Handlers,
): GroupImpl<Module, Name, unknown>

export function groupChecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
): GroupImpl<Module, Name, unknown> {
  return makeGroupImpl(module, name, handlers)
}

export function groupPrechecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: GroupCheckedHandlers<Module, Name>,
): GroupImpl<Module, Name, unknown>

export function groupPrechecked<
  Module extends AnyStdbModule,
  const Name extends GroupNames<Module>,
>(
  module: Module,
  name: Name,
  handlers: Record<string, unknown>,
): GroupImpl<Module, Name, unknown> {
  return makeGroupImpl(module, name, handlers)
}

export function lifecycle<Module extends AnyStdbModule, const Handlers>(
  module: Module,
  handlers: Handlers & ValidateLifecycleHandlers<Handlers>,
): LifecycleImpl<
  Module,
  keyof Handlers & LifecycleName,
  RuntimeROfGroupHandlers<Handlers>
>

export function lifecycle<Module extends AnyStdbModule>(
  module: Module,
  handlers: Record<string, unknown>,
): LifecycleImpl<Module, LifecycleName, unknown> {
  const lifecycleEntries: Array<readonly [string, unknown]> = []
  const specEntries: Array<readonly [string, LifecycleSpec]> = []

  for (const [name, handler] of Object.entries(handlers)) {
    if (!isLifecycleName(name)) {
      throw diagnostic(
        "UnknownEndpoint",
        ["lifecycle", name],
        `Unknown lifecycle hook ${name}`,
      )
    }

    lifecycleEntries.push([name, handler])
    specEntries.push([name, defineLifecycle(name)])
  }

  return {
    kind: "stdbLifecycle",
    module,
    lifecycleSpecs: sortedRecord(specEntries),
    definitions:
      lifecycleEntries.length > 0
        ? { lifecycle: sortedRecord(lifecycleEntries) }
        : {},
  } as LifecycleImpl<Module, LifecycleName, unknown>
}
