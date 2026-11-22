import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type { AnyModuleSpec } from "../contract/module.ts"
import type {
  MountRecord,
  ModuleMount,
  NativeMount,
  MountsOf,
} from "../contract/mount.ts"
import { prefixId } from "../utils.ts"
import type { ModuleBrand } from "../identity-brand.ts"
import * as Server from "./context.ts"
import { senderErrorMessage } from "./host-abi-runtime.ts"
import { SpacetimeHostError } from "./host-errors.ts"
import { StdbSenderError, toHostFailure, type HostFailure } from "./services.ts"
import type {
  BaseReducerCtx,
  HttpHandlerCtxLike,
  ProcedureCtxLike,
  ViewCtxLike,
} from "./runtime-types.ts"
import type { ServerQueryRoot } from "../query/types.ts"
import { makeDbHandleFactory } from "./db-handle-factory.ts"

export const mountedQueries = Symbol("effect-spacetimedb/MountQueries")
export interface MountQueries {
  readonly from: ServerQueryRoot<AnyModuleSpec> | undefined
  readonly children: Readonly<Record<string, MountQueries>>
}

export type NativeKind = "mutation" | "procedure" | "http"
type FrameKind =
  | "reducer"
  | "tx"
  | "httpTx"
  | "procedure"
  | "http"
  | "sender"
  | "anonymous"
type MountFrame = { readonly kind: FrameKind; readonly ctx: unknown }
export class CurrentMountFrame extends Context.Service<
  CurrentMountFrame,
  MountFrame
>()(prefixId("Server/CurrentMountFrame")) {}

class MountContextDefect extends Data.TaggedError("MountContextDefect")<{
  readonly namespace: string
  readonly kind: FrameKind
  readonly expected?: NativeKind
}> {
  override readonly message =
    this.expected === undefined
      ? `Missing scoped context for ${this.namespace} in a ${this.kind} handler`
      : `Native mount "${this.namespace}" requested a ${this.expected} context in a ${this.kind} handler`
}

export type Rebrand<
  R,
  Parent extends AnyModuleSpec,
  S = Server.AnyServerContextRequirements,
> = S extends Server.AnyServerContextRequirements
  ? R extends S
    ? Server.ModuleScopedRequirement<Parent, S>
    : never
  : never

/** Translate a library effect's context requirements to the corresponding parent services. Other Effect requirements stay with the caller. */
export type MountedRequirements<
  Parent extends AnyModuleSpec,
  Child extends AnyModuleSpec,
  R,
> = R extends ModuleBrand<Child["name"]> & Server.Env
  ? never
  : R extends ModuleBrand<Child["name"]> & Server.AnyServerContextRequirements
    ? Rebrand<R, Parent>
    : R

/** A handler's entry point for running Effect code against one mounted module. */
export type ModuleMountAccessor<
  Parent extends AnyModuleSpec,
  Child extends AnyModuleSpec,
> = {
  /** Run a library effect with the mounted module's services inside the current handler or transaction. The parent must provide a handler context that supports those services. */
  readonly run: <A, E, R>(
    effect: Effect.Effect<A, E, R> &
      Server.EffectWithoutForbiddenRequirements<
        Effect.Effect<A, E, R>,
        Server.ModuleScopedAllowedRequirements<
          Child,
          Server.AnyServerContextRequirements
        >
      >,
  ) => Effect.Effect<A, E, MountedRequirements<Parent, Child, R>>
}

export type NativeMethod<K extends NativeKind> = K extends "mutation"
  ? "reducer"
  : K extends "procedure"
    ? "procedure"
    : "httpHandler"
/** The SDK alias passed to a native mount callback for this handler kind. It is inferred from the library's default schema and omits the standalone environment reader. */
export type NativeMountCtx<Lib, Kind extends NativeKind> = Lib extends {
  readonly default: Record<
    NativeMethod<Kind>,
    (...args: never[]) => infer Handler
  >
}
  ? Handler extends (ctx: infer Ctx, ...args: never[]) => unknown
    ? Omit<Ctx, "env">
    : never
  : never
export type NativeResult<
  Parent extends AnyModuleSpec,
  A,
  K extends NativeKind,
> = Effect.Effect<
  A,
  HostFailure | StdbSenderError,
  Server.ModuleScopedRequirement<
    Parent,
    K extends "mutation"
      ? Server.Db
      : K extends "procedure"
        ? Server.ProcedureCtx
        : Server.HttpHandlerCtx
  >
>
/** A handler's entry point for invoking helpers from one mounted SDK library. */
export type NativeMountAccessor<Parent extends AnyModuleSpec, Lib> = {
  /** Call a synchronous helper with the library's native alias. The default mutation kind applies in reducers and transactions. Choose procedure or http outside their transactions. */
  readonly use: {
    <A>(
      fn: (ctx: NativeMountCtx<Lib, "mutation">) => A,
    ): NativeResult<Parent, A, "mutation">
    <A>(
      kind: "mutation",
      fn: (ctx: NativeMountCtx<Lib, "mutation">) => A,
    ): NativeResult<Parent, A, "mutation">
    <A>(
      kind: "procedure",
      fn: (ctx: NativeMountCtx<Lib, "procedure">) => A,
    ): NativeResult<Parent, A, "procedure">
    <A>(
      kind: "http",
      fn: (ctx: NativeMountCtx<Lib, "http">) => A,
    ): NativeResult<Parent, A, "http">
  }
}

/** Per-namespace handler accessors inferred from the module's mount declarations. */
export type MountAccessors<Parent extends AnyModuleSpec> = {
  readonly [K in keyof MountsOf<Parent>]: MountsOf<Parent>[K] extends ModuleMount<
    infer Child
  >
    ? ModuleMountAccessor<Parent, Child>
    : MountsOf<Parent>[K] extends NativeMount<infer Lib>
      ? NativeMountAccessor<Parent, Lib>
      : never
}

type RawMountContext = {
  readonly as?: Readonly<Record<string, unknown>>
  readonly db?: Readonly<Record<string, unknown>>
  readonly [mountedQueries]?: MountQueries
}
const aliasOf = (frame: MountFrame, namespace: string) => {
  const alias = (frame.ctx as RawMountContext).as?.[namespace]
  if (alias == null)
    throw new MountContextDefect({ namespace, kind: frame.kind })
  return alias
}

const nativeFrameKind = {
  reducer: "mutation",
  tx: "mutation",
  httpTx: "mutation",
  procedure: "procedure",
  http: "http",
  sender: undefined,
  anonymous: undefined,
} as const satisfies Record<FrameKind, NativeKind | undefined>

const nativeAccessor = (namespace: string) => ({
  use: <A>(
    kindOrFn: NativeKind | ((ctx: unknown) => A),
    callback?: (ctx: unknown) => A,
  ) =>
    Effect.flatMap(CurrentMountFrame, (frame) =>
      Effect.suspend<A, HostFailure | StdbSenderError, never>(() => {
        const expected = typeof kindOrFn === "function" ? "mutation" : kindOrFn
        if (nativeFrameKind[frame.kind] !== expected)
          return Effect.die(
            new MountContextDefect({ namespace, kind: frame.kind, expected }),
          )
        const fn = typeof kindOrFn === "function" ? kindOrFn : callback!
        const ctx = aliasOf(frame, namespace)
        try {
          return Effect.succeed(fn(ctx))
        } catch (cause) {
          const message = senderErrorMessage(cause)
          if (message !== undefined)
            return Effect.fail(new StdbSenderError({ value: message }))
          if (cause instanceof SpacetimeHostError)
            return Effect.fail(toHostFailure(namespace, cause))
          return Effect.die(cause)
        }
      }),
    ),
})

const scopedAccessor = (namespace: string, child: AnyModuleSpec) => {
  const handles = makeDbHandleFactory(child)
  const run = <A, E, R>(body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.contextWith((services: Context.Context<R>) => {
      const frame = Context.getUnsafe(services, CurrentMountFrame)
      const raw = frame.ctx as RawMountContext
      let scoped = services.pipe(Context.add(Server.Env, {}))
      const enter = (ctx: unknown) =>
        Context.add(scoped, CurrentMountFrame, { kind: frame.kind, ctx })
      if (frame.kind === "sender" || frame.kind === "anonymous") {
        const queries = raw[mountedQueries]?.children[namespace]
        if (queries?.from === undefined)
          return Effect.die(
            new MountContextDefect({ namespace, kind: frame.kind }),
          )
        const parent = frame.ctx as ViewCtxLike<AnyModuleSpec>
        const rawDb = raw.db?.[namespace] as typeof parent.db | undefined
        // 2.16.1 omits descendant tables and aliases when it dispatches a
        // submodule view directly. Its query builder still supports them.
        const db =
          rawDb ??
          new Proxy(Object.create(null), {
            get() {
              throw new MountContextDefect({ namespace, kind: frame.kind })
            },
          })
        const ctx = {
          ...parent,
          sender: parent.sender,
          db,
          from: queries.from,
          [mountedQueries]: queries,
        }
        scoped = enter({ ...ctx, db: rawDb }).pipe(
          Context.add(Server.From, ctx.from),
          Context.add(
            Server.ReadonlyDb,
            rawDb === undefined ? db : handles.readonly(rawDb),
          ),
        )
        scoped =
          frame.kind === "sender"
            ? Context.add(scoped, Server.ViewCtx, ctx)
            : Context.add(scoped, Server.AnonymousViewCtx, ctx)
      } else {
        const alias = aliasOf(frame, namespace)
        scoped = enter(alias)
        switch (frame.kind) {
          case "procedure": {
            const runner = Context.getUnsafe(services, Server.TxRunner)
            scoped = scoped.pipe(
              Context.add(
                Server.ProcedureCtx,
                alias as ProcedureCtxLike<AnyModuleSpec>,
              ),
              Context.add(Server.TxRunner, {
                run: scopeTransaction(runner.run),
              }),
            )
            break
          }
          case "http": {
            const runner = Context.getUnsafe(services, Server.HttpTxRunner)
            const ctx = alias as HttpHandlerCtxLike<AnyModuleSpec> & {
              readonly identity: HttpHandlerCtxLike<AnyModuleSpec>["databaseIdentity"]
            }
            scoped = scoped.pipe(
              Context.add(Server.HttpHandlerCtx, {
                ...ctx,
                databaseIdentity: ctx.identity,
              }),
              Context.add(Server.HttpTxRunner, {
                run: scopeTransaction(runner.run),
              }),
            )
            break
          }
          default: {
            const ctx = alias as BaseReducerCtx<AnyModuleSpec>
            scoped = Context.add(
              scoped,
              Server.Db,
              handles.readwrite(
                ctx.db,
                frame.kind === "httpTx" ? undefined : ctx,
              ),
            )
            if (frame.kind !== "httpTx") {
              scoped = Context.add(scoped, Server.MutationCtx, ctx)
              scoped =
                frame.kind === "tx"
                  ? Context.add(scoped, Server.TxCtx, ctx)
                  : Context.add(scoped, Server.ReducerCtx, ctx)
            }
          }
        }
      }
      return Effect.provideContext(body, scoped)
    }).pipe(
      Effect.annotateLogs("mount", namespace),
      Effect.withSpan("mount." + namespace),
    )
  // The public runner checks branded requirements at its call site. Wrapping
  // the body only changes which namespace supplies those services in the tx.
  const scopeTransaction = <
    T extends
      | Server.TxRunnerService<AnyModuleSpec>["run"]
      | Server.HttpTxRunnerService<AnyModuleSpec>["run"],
  >(
    parent: T,
  ): T => {
    const invoke = <A, E>(body: Effect.Effect<A, E>) =>
      parent<A, E, never>(run(body))
    return invoke as unknown as T
  }
  return { run }
}

export const makeMountAccessors = <Module extends AnyModuleSpec>(
  mounts: MountRecord,
): MountAccessors<Module> =>
  Object.fromEntries(
    Object.entries(mounts).map(([namespace, mount]) => [
      namespace,
      mount.kind === "moduleMount"
        ? scopedAccessor(namespace, mount.module)
        : nativeAccessor(namespace),
    ]),
  ) as unknown as MountAccessors<Module>
