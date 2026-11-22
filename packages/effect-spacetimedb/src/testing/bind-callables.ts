import { mountedQueries, type MountQueries } from "../server/mount-context.ts"
import { planModule } from "../builder/build-plan.ts"
import { readMember } from "../member-path.ts"
import type { ModuleMount, MountsOf } from "../contract/mount.ts"
import * as Effect from "effect/Effect"
import type * as Cause from "effect/Cause"
import {
  type AnyModule,
  type GroupImpl,
  type AnyBuilderImpl,
  type BuildPlan,
  Builder,
} from "../builder.ts"
import {
  InternalStdbBuildPlanSymbol,
  type InternalStdbBuildPlan,
  internalStdbBuildPlan,
} from "../builder/internal-build-plan.ts"
import { SenderError } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import { outboxResultMetadataOf } from "../contract/outbox-table.ts"
import { identityKey } from "../server/host-abi-runtime.ts"
import { bindModule } from "../server/bind.ts"
import type { BoundModule, Handlers } from "../server/handler-types.ts"
import { runInTestHarnessTransaction } from "./transaction.ts"

export type BoundCallable = {
  readonly invoke: (ctx: unknown, args: unknown) => unknown
}

export type BoundCallableRecord = Readonly<Record<string, BoundCallable>>

export type TestCallables<M extends AnyModuleSpec> = BoundCallableRecord & {
  readonly [K in keyof MountsOf<M> as MountsOf<M>[K] extends ModuleMount
    ? K
    : never]: MountsOf<M>[K] extends ModuleMount<infer Child>
    ? TestCallables<Child>
    : never
}

type CallableWithInvoke = {
  readonly invoke: (...args: ReadonlyArray<never>) => unknown
  readonly spec?: unknown
}

/** The zero identity, which the host runs every settle reducer as. */
const settleSenderIdentityKey = "0".repeat(64)

const senderOf = (ctx: unknown): unknown =>
  typeof ctx === "object" && ctx !== null
    ? Reflect.get(ctx, "sender")
    : undefined

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
        invoke: (ctx: unknown, args: unknown) => {
          // As the compiled module does: only the host settles an outbox row.
          if (
            outboxResultMetadataOf(callable.spec) !== undefined &&
            identityKey(senderOf(ctx)) !== settleSenderIdentityKey
          ) {
            throw new SenderError(
              `Settle reducer ${key} is only invocable by the host settling its outbox`,
            )
          }
          return runInTestHarnessTransaction(ctx, () =>
            Reflect.apply(callable.invoke, callable, [ctx, args]),
          )
        },
      },
    ]),
  )

export type RawHandlerRecord = Readonly<Record<string, unknown>>

export type HandlerSection =
  | "reducers"
  | "procedures"
  | "httpHandlers"
  | "views"
  | "lifecycle"

export type RawSectionedHandlers = Partial<
  Record<HandlerSection, RawHandlerRecord>
>

export type HandlerInput =
  | RawSectionedHandlers
  | RawHandlerRecord
  | ReadonlyArray<GroupImpl<string, unknown>>

const hasSection = (
  value: RawHandlerRecord,
  section: HandlerSection,
): boolean => {
  const handlers = value[section]
  return (
    Object.hasOwn(value, section) &&
    typeof handlers === "object" &&
    handlers !== null &&
    !Effect.isEffect(handlers)
  )
}

const isSectionedHandlers = (
  value: RawHandlerRecord,
): value is RawSectionedHandlers =>
  hasSection(value, "reducers") ||
  hasSection(value, "procedures") ||
  hasSection(value, "httpHandlers") ||
  hasSection(value, "views") ||
  hasSection(value, "lifecycle")

const sectionHandlers = (
  module: AnyModule,
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
  module: AnyModule,
  groups: ReadonlyArray<GroupImpl<string, unknown>>,
): RawSectionedHandlers => {
  const handlers: Record<string, unknown> = {}

  for (const group of groups) {
    Object.assign(handlers, Builder.handlersOf(module, group as never))
  }

  return sectionHandlers(module, handlers)
}

const normalizeHandlers = (
  module: AnyModule,
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
  server: BoundModule<Module, RuntimeR>,
  handlers: Handlers<Module, RuntimeR>,
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

export type BindCallablesOptions = {
  /**
   * As `BuildOptions.onDefect`. A procedure answers an undeclared failure with
   * a fixed `err`, as on the host, so this is how a test reads its cause.
   */
  readonly onDefect?: ((cause: Cause.Cause<unknown>) => void) | undefined
}

/** View dispatch has a namespaced db and query builder but no native as alias. */
const callableContext = (
  ctx: unknown,
  path: readonly string[],
  owner: AnyModuleSpec,
  key: string,
): unknown => {
  if (!Object.hasOwn(owner.views, key))
    return readMember(
      ctx,
      path.flatMap((key) => ["as", key]),
    )
  const root = ctx as {
    db: object
    sender?: unknown
    [mountedQueries]: MountQueries
  }
  const queries = path.reduce(
    (tree, key) => tree.children[key]!,
    root[mountedQueries],
  )
  // The 2.16.1 host dispatches child views with local tables only. Their
  // query builders can still reach descendant tables by canonical name.
  const local = readMember(root.db, path)
  return {
    ...(root.sender === undefined ? {} : { sender: root.sender }),
    db: Object.fromEntries(
      Object.keys(owner.tables).map((key) => [key, readMember(local, [key])]),
    ),
    from: queries.from,
    [mountedQueries]: queries,
  }
}

const bindPlan = (root: InternalStdbBuildPlan<AnyModuleSpec, unknown>) => {
  const wire: Record<string, BoundCallable> = Object.create(null)
  const visit = (
    plan: typeof root,
    path: readonly string[],
    prefix: string,
  ): object => {
    const internal = plan[InternalStdbBuildPlanSymbol]
    const callables = bindCallableSections(internal.server, plan.handlers)
    const result: Record<string, unknown> = Object.create(null)
    for (const [key, callable] of Object.entries(callables)) {
      const bound =
        path.length === 0
          ? callable
          : {
              ...callable,
              invoke: (ctx: unknown, args: unknown) =>
                callable.invoke(
                  callableContext(ctx, path, plan.module, key),
                  args,
                ),
            }
      result[key] = bound
      if (path.length > 0) {
        const names = plan.module.wireNames
        wire[prefix + (names.functions[key] ?? names.views[key] ?? key)] = bound
      }
    }
    for (const [key, mount] of Object.entries(internal.mounts)) {
      if (mount.kind === "moduleMount") {
        result[key] = visit(
          mount.plan,
          [...path, key],
          prefix + plan.module.mounts![key]!.wireNamespace + ".",
        )
      }
    }
    return result
  }
  return Object.freeze(Object.assign(visit(root, [], ""), wire))
}

export function bindCallables<Module extends AnyModuleSpec, RuntimeR = never>(
  plan: BuildPlan<Module, RuntimeR>,
): TestCallables<Module>
export function bindCallables(
  module: AnyModule,
  implsOrHandlers: HandlerInput,
  options?: BindCallablesOptions,
): Partial<BoundCallableRecord>
/** Bind the parent's implementations and those of its module mounts. Invoke mounted handlers by nested accessor or qualified wire name. */
export function bindCallables<M extends AnyModule>(
  module: M,
  implsOrHandlers: readonly AnyBuilderImpl[],
  options?: BindCallablesOptions,
): TestCallables<M["spec"]>
export function bindCallables(
  input: unknown,
  implsOrHandlers?: HandlerInput | readonly AnyBuilderImpl[],
  options?: BindCallablesOptions,
): object {
  if (implsOrHandlers === undefined) {
    // Public overloads preserve Module/RuntimeR; this testing-only runtime
    // dispatcher erases them after the plan has already been constructed.
    const plan = internalStdbBuildPlan(input as BuildPlan)
    return bindPlan(plan)
  }

  const module = input as AnyModule
  if (
    Array.isArray(implsOrHandlers) &&
    implsOrHandlers.some((impl) => impl.kind === "stdbMount")
  ) {
    const plan = planModule(module, implsOrHandlers as never, options ?? {})
    return bindPlan(internalStdbBuildPlan(plan))
  }
  return bindCallableSections(
    bindModule({ module: module.spec, onDefect: options?.onDefect }),
    normalizeHandlers(module, implsOrHandlers as HandlerInput) as never,
  )
}
