import {
  type AnyStdbModule,
  type GroupImpl,
  type StdbBuildPlan,
  StdbBuilder,
} from "../builder.ts"
import {
  InternalStdbBuildPlanSymbol,
  internalStdbBuildPlan,
} from "../builder/internal-build-plan.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import * as Server from "../server/bind.ts"
import { runInTestHarnessTransaction } from "./transaction.ts"

type BoundCallable = {
  readonly invoke: (ctx: unknown, args: unknown) => unknown
}

type BoundCallableRecord = Readonly<Record<string, BoundCallable>>

type CallableWithInvoke = {
  readonly invoke: (...args: ReadonlyArray<never>) => unknown
}

const wrapMutationCallables = <
  Callables extends Readonly<Record<string, CallableWithInvoke>>,
>(
  callables: Callables,
): BoundCallableRecord =>
  Object.fromEntries(
    Object.entries(callables).map(([key, callable]) => [
      key,
      {
        ...callable,
        invoke: (ctx: unknown, args: unknown) =>
          runInTestHarnessTransaction(ctx, () =>
            Reflect.apply(callable.invoke, callable, [ctx, args]),
          ),
      },
    ]),
  )

type RawHandlerRecord = Readonly<Record<string, unknown>>

type HandlerSection =
  | "reducers"
  | "procedures"
  | "httpHandlers"
  | "views"
  | "lifecycle"

type RawSectionedHandlers = Partial<Record<HandlerSection, RawHandlerRecord>>

type HandlerInput =
  | RawSectionedHandlers
  | RawHandlerRecord
  | ReadonlyArray<GroupImpl<string, unknown>>

const hasSection = (
  value: RawHandlerRecord,
  section: HandlerSection,
): boolean => Object.hasOwn(value, section)

const isSectionedHandlers = (
  value: RawHandlerRecord,
): value is RawSectionedHandlers =>
  hasSection(value, "reducers") ||
  hasSection(value, "procedures") ||
  hasSection(value, "httpHandlers") ||
  hasSection(value, "views") ||
  hasSection(value, "lifecycle")

const sectionHandlers = (
  module: AnyStdbModule,
  handlers: RawHandlerRecord,
): RawSectionedHandlers => {
  const reducers: Record<string, unknown> = {}
  const procedures: Record<string, unknown> = {}
  const httpHandlers: Record<string, unknown> = {}
  const views: Record<string, unknown> = {}
  const lifecycle: Record<string, unknown> = {}

  for (const [name, handler] of Object.entries(handlers)) {
    if (Object.hasOwn(module.spec.reducers, name)) {
      reducers[name] = handler
    }
    if (Object.hasOwn(module.spec.procedures, name)) {
      procedures[name] = handler
    }
    if (Object.hasOwn(module.spec.httpHandlers, name)) {
      httpHandlers[name] = handler
    }
    if (Object.hasOwn(module.spec.views, name)) {
      views[name] = handler
    }
    if (Object.hasOwn(module.spec.lifecycle, name)) {
      lifecycle[name] = handler
    }
  }

  return { httpHandlers, lifecycle, procedures, reducers, views }
}

const handlersFromGroups = (
  module: AnyStdbModule,
  groups: ReadonlyArray<GroupImpl<string, unknown>>,
): RawSectionedHandlers => {
  const handlers: Record<string, unknown> = {}

  for (const group of groups) {
    Object.assign(handlers, StdbBuilder.handlersOf(module, group as never))
  }

  return sectionHandlers(module, handlers)
}

const normalizeHandlers = (
  module: AnyStdbModule,
  input: HandlerInput,
): RawSectionedHandlers => {
  if (Array.isArray(input)) {
    return handlersFromGroups(module, input)
  }

  const handlers = input as RawHandlerRecord
  return isSectionedHandlers(handlers)
    ? handlers
    : sectionHandlers(module, handlers)
}

const bindCallableSections = <Module extends AnyModuleSpec, RuntimeR>(
  server: Server.InternalServerInstance<Module, RuntimeR>,
  handlers: Server.Handlers<Module, RuntimeR>,
): BoundCallableRecord => {
  const reducers =
    handlers.reducers === undefined
      ? {}
      : wrapMutationCallables(server.reducers(handlers.reducers))
  const procedures =
    handlers.procedures === undefined
      ? {}
      : server.procedures(handlers.procedures)
  const httpHandlers =
    handlers.httpHandlers === undefined
      ? {}
      : server.httpHandlers(handlers.httpHandlers)
  const views = handlers.views === undefined ? {} : server.views(handlers.views)
  const lifecycle =
    handlers.lifecycle === undefined ? {} : server.lifecycle(handlers.lifecycle)
  return Object.freeze({
    ...reducers,
    ...procedures,
    ...httpHandlers,
    ...views,
    ...wrapMutationCallables(lifecycle),
  }) as BoundCallableRecord
}

export function bindCallables<Module extends AnyModuleSpec, RuntimeR = never>(
  plan: StdbBuildPlan<Module, RuntimeR>,
): BoundCallableRecord
export function bindCallables(
  module: AnyStdbModule,
  implsOrHandlers: HandlerInput,
): BoundCallableRecord
export function bindCallables(
  input: unknown,
  implsOrHandlers?: HandlerInput,
): BoundCallableRecord {
  if (implsOrHandlers === undefined) {
    // Public overloads preserve Module/RuntimeR; this testing-only runtime
    // dispatcher erases them after the plan has already been constructed.
    const plan = internalStdbBuildPlan(input as StdbBuildPlan)
    return bindCallableSections(
      plan[InternalStdbBuildPlanSymbol].server,
      plan.handlers,
    )
  }

  const module = input as AnyStdbModule
  const server = Server.make({ module: module.spec })
  const handlers = server.handlers(
    normalizeHandlers(module, implsOrHandlers) as never,
  )
  return bindCallableSections(server, handlers)
}
