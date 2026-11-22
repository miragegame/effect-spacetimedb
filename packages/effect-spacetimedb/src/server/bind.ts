import { CurrentMountFrame } from "./mount-context.ts"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import { SenderError } from "spacetimedb"
import { encodeUndeclaredFailure } from "../contract/error.ts"
import type { LifecycleName } from "../contract/lifecycle.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import { formatModuleDiagnostics } from "../contract/module-validation.ts"
import { makeModulePlan } from "../module-plan.ts"
import { isHostInvoked, isScheduledFunction } from "../module-projection.ts"
import {
  decodeHttpRequest,
  handlerSpanTraceOptions,
  type HandlerLogAnnotations,
  assertKnownHandlerKey,
  senderLogValue,
} from "./bind-support.ts"
import {
  type CallLogAnnotations,
  makeCallBoundaryFactory,
} from "./call-boundary.ts"
import {
  callRefusalMessage,
  encodeHttpResult,
  isHttpClientFault,
  isSenderRefusal,
  toHttpResponse,
  toLifecycleThrow,
  toReducerThrow,
  toViewValue,
} from "./callable-runtime.ts"
import * as ServerContext from "./context.ts"
import { makeDbHandleFactory } from "./db-handle.ts"
import { makeEnvServiceFactory } from "./environment.ts"
import {
  encodeDeclaredProcedureFailure,
  encodeDeclaredReducerFailure,
} from "./declared-errors.ts"
import type {
  AnonymousViewAllowedRequirements,
  BindOptions,
  BoundHttpHandlerExport,
  BoundLifecycleExport,
  BoundModule,
  BoundProcedureExport,
  BoundReducerExport,
  BoundViewExport,
  HandlerRequirements,
  HttpHandlerAllowedRequirements,
  HttpHandlerErrors,
  HttpHandlerHandlerRecord,
  HttpHandlerKeys,
  HttpHandlerRequestOf,
  HttpHandlerResponseOf,
  HttpTxAllowedRequirements,
  LifecycleHandlerRecord,
  ParamsOf,
  ProcedureAllowedRequirements,
  ProcedureHandlerErrors,
  ProcedureHandlerRecord,
  ProcedureKeys,
  ProcedureReply,
  ReducerAllowedRequirements,
  ReducerHandlerErrors,
  ReducerHandlerRecord,
  ReducerKeys,
  ReturnsOf,
  SenderViewAllowedRequirements,
  TxAllowedRequirements,
  ViewArgsOf,
  ViewHandlerErrors,
  ViewHandlerRecord,
  ViewKeys,
  ViewSuccessOf,
} from "./handler-types.ts"
import { isDatabaseSender } from "./host-abi-runtime.ts"
import {
  serverRuntimeModeDefault,
  provideConstrainedServerRuntime,
  provideConstrainedServerSupport,
  makeProcedureServerClock,
  makeUntimedServerClock,
  type ConstrainedServerRuntimeMode,
  type TimedRuntimeCtx,
} from "./runtime-layer.ts"
import {
  type AnonymousViewCtxLike,
  type BaseReducerCtx,
  type DbShape,
  type HttpHandlerCtxLike,
  ProcedureClockNow,
  type ProcedureCtxLike,
  type ViewCtxLike,
} from "./runtime-types.ts"
import { StdbSenderError, wrapHttp } from "./services.ts"
import {
  type SyncRunner,
  from as toSyncRunner,
  fromLayer as toSyncRunnerFromLayer,
} from "./sync-runner.ts"
import { makeDbOnlyTxRunner, makeTxRunner } from "./tx.ts"

/**
 * The fixed `err` of a procedure's undeclared failure. A caller learns that the
 * call failed and nothing else: the cause goes to the module log, which is the
 * only place a stack, a path or a defect's text may appear.
 */
const procedureFailedErr = encodeUndeclaredFailure({
  reason: "Failed",
  message: "The procedure failed. The module log has the cause.",
})

/**
 * Whether the host read a call's arguments from one of the module's own rows,
 * so that no caller answers for them. A settle reducer's always come from there.
 * A scheduled function's do only when the database itself made the call, because
 * `allowExternalCallers` lets a client reach it with arguments of its own.
 */
const argumentsAreModuleRows = (
  spec: unknown,
  ctx: { readonly sender: unknown; readonly databaseIdentity: unknown },
): boolean =>
  isHostInvoked(spec) && (!isScheduledFunction(spec) || isDatabaseSender(ctx))

export const bindModule = <Module extends AnyModuleSpec, RuntimeR = never>(
  options: BindOptions<Module, RuntimeR>,
): BoundModule<Module, RuntimeR> => {
  const plan = makeModulePlan(options.module)
  const module = plan.module
  const scheduleBindings = plan.scheduleBindings
  const dbHandles = makeDbHandleFactory(module)
  const hasMounts = Object.keys(module.mounts ?? {}).length > 0
  const mountFrame =
    (
      kind:
        | "reducer"
        | "procedure"
        | "http"
        | "sender"
        | "anonymous"
        | "tx"
        | "httpTx",
      ctx: unknown,
    ) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      hasMounts
        ? Effect.provideService(effect, CurrentMountFrame, { kind, ctx })
        : effect
  const envServiceFor = makeEnvServiceFactory(module.environment)
  const runner: SyncRunner<RuntimeR> =
    options.runtime === undefined
      ? (toSyncRunnerFromLayer(Layer.empty) as SyncRunner<RuntimeR>)
      : toSyncRunner(options.runtime)
  const runtimeMode = options.runtimeMode ?? serverRuntimeModeDefault
  // Every handler boundary provides the same runtime mode; only the context and
  // clock differ. Binding it once here keeps each call site to the part that
  // actually varies.
  const withServerSupport = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    mode: ConstrainedServerRuntimeMode = runtimeMode,
  ) => provideConstrainedServerSupport(effect, mode)
  const withServerRuntime = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    ctx: TimedRuntimeCtx,
    clock?: Clock.Clock,
  ) => provideConstrainedServerRuntime(effect, ctx, runtimeMode, clock)
  const warnings = module.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  )
  if (warnings.length > 0) {
    runner.runSync(
      withServerSupport(
        Effect.logWarning(formatModuleDiagnostics(warnings)),
        // Binding is outside a callable transaction, so there is no host
        // timestamp with which to replace the logger's wall clock.
        "runtime",
      ),
    )
  }
  const makeHandlerSpanOptions = (kind: HandlerLogAnnotations["kind"]) => ({
    attributes: {
      "effect-spacetimedb.endpoint.kind": kind,
      "effect-spacetimedb.module": module.name,
    },
  })

  const provideReducerServices = <A, E>(
    ctx: BaseReducerCtx<Module>,
    effect: Effect.Effect<
      A,
      E,
      HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
    >,
  ): Effect.Effect<A, E, RuntimeR> =>
    effect.pipe(
      Effect.provideService(ServerContext.ReducerCtx, ctx),
      mountFrame("reducer", ctx),
      Effect.provideService(ServerContext.MutationCtx, ctx),
      Effect.provideService(ServerContext.Db, dbHandles.readwrite(ctx.db, ctx)),
      Effect.provideService(ServerContext.Env, envServiceFor(ctx)),
      (provided) => withServerRuntime(provided, ctx),
    ) as Effect.Effect<A, E, RuntimeR>

  const provideProcedureRuntime = <A, E>(
    ctx: ProcedureCtxLike<Module>,
    txRunner: ReturnType<typeof makeTxRunner<RuntimeR, BaseReducerCtx<Module>>>,
    effect: Effect.Effect<
      A,
      E,
      HandlerRequirements<RuntimeR, ProcedureAllowedRequirements>
    >,
  ): Effect.Effect<A, E, RuntimeR> =>
    effect.pipe(
      Effect.provideService(ServerContext.ProcedureCtx, ctx),
      mountFrame("procedure", ctx),
      Effect.provideService(ServerContext.Http, wrapHttp(ctx.http)),
      Effect.provideService(ServerContext.Env, envServiceFor(ctx)),
      Effect.provideService(
        ServerContext.TxRunner,
        txRunner as unknown as ServerContext.TxRunnerService<AnyModuleSpec>,
      ),
      (provided) =>
        withServerRuntime(
          provided,
          ctx,
          makeProcedureServerClock(ctx[ProcedureClockNow]),
        ),
    ) as Effect.Effect<A, E, RuntimeR>

  const provideHttpHandlerRuntime = <A, E>(
    ctx: HttpHandlerCtxLike<Module>,
    txRunner: ReturnType<
      typeof makeDbOnlyTxRunner<RuntimeR, { readonly db: DbShape<Module> }>
    >,
    effect: Effect.Effect<
      A,
      E,
      HandlerRequirements<RuntimeR, HttpHandlerAllowedRequirements>
    >,
  ): Effect.Effect<A, E, RuntimeR> =>
    effect.pipe(
      Effect.provideService(ServerContext.HttpHandlerCtx, ctx),
      mountFrame("http", ctx),
      Effect.provideService(ServerContext.Http, wrapHttp(ctx.http)),
      Effect.provideService(ServerContext.Env, envServiceFor(ctx)),
      Effect.provideService(
        ServerContext.HttpTxRunner,
        txRunner as unknown as ServerContext.HttpTxRunnerService<AnyModuleSpec>,
      ),
      (provided) => withServerRuntime(provided, ctx),
    ) as Effect.Effect<A, E, RuntimeR>

  const provideViewRuntime = <A, E>(
    options:
      | {
          readonly context: "sender"
          readonly ctx: ViewCtxLike<Module>
        }
      | {
          readonly context: "anonymous"
          readonly ctx: AnonymousViewCtxLike<Module>
        },
    effect: Effect.Effect<
      A,
      E,
      HandlerRequirements<
        RuntimeR,
        SenderViewAllowedRequirements | AnonymousViewAllowedRequirements
      >
    >,
  ): Effect.Effect<A, E, RuntimeR> => {
    const provided = Match.value(options).pipe(
      Match.discriminatorsExhaustive("context")({
        sender: ({ ctx }) =>
          effect.pipe(
            Effect.provideService(ServerContext.ViewCtx, ctx),
            mountFrame("sender", ctx),
            Effect.provideService(ServerContext.From, ctx.from),
            Effect.provideService(ServerContext.Env, envServiceFor(ctx)),
            Effect.provideService(
              ServerContext.ReadonlyDb,
              dbHandles.readonly(ctx.db),
            ),
          ),
        anonymous: ({ ctx }) =>
          effect.pipe(
            Effect.provideService(ServerContext.AnonymousViewCtx, ctx),
            mountFrame("anonymous", ctx),
            Effect.provideService(ServerContext.From, ctx.from),
            Effect.provideService(ServerContext.Env, envServiceFor(ctx)),
            Effect.provideService(
              ServerContext.ReadonlyDb,
              dbHandles.readonly(ctx.db),
            ),
          ),
      }),
    )

    // Server binding boundary: view handler records erase the sender/anonymous context distinction before binding.
    const narrowed = provided as Effect.Effect<A, E, RuntimeR>

    return withServerSupport(
      Effect.provideService(narrowed, Clock.Clock, makeUntimedServerClock()),
    )
  }

  const provideTxRuntime = <
    A,
    E,
    R extends ServerContext.WithEnv<TxAllowedRequirements> | RuntimeR,
  >(
    txCtx: BaseReducerCtx<Module>,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, RuntimeR> =>
    effect.pipe(
      Effect.provideService(ServerContext.TxCtx, txCtx),
      mountFrame("tx", txCtx),
      Effect.provideService(ServerContext.MutationCtx, txCtx),
      Effect.provideService(
        ServerContext.Db,
        dbHandles.readwrite(txCtx.db, txCtx),
      ),
      Effect.provideService(ServerContext.Env, envServiceFor(txCtx)),
      (provided) => withServerRuntime(provided, txCtx),
    ) as Effect.Effect<A, E, RuntimeR>

  const provideHttpTxRuntime = <
    A,
    E,
    R extends ServerContext.WithEnv<HttpTxAllowedRequirements> | RuntimeR,
  >(
    httpCtx: HttpHandlerCtxLike<Module>,
    txCtx: { readonly db: DbShape<Module> },
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, RuntimeR> =>
    effect.pipe(
      mountFrame("httpTx", txCtx),
      // No send context: an HTTP handler never sends inter-database calls.
      Effect.provideService(ServerContext.Db, dbHandles.readwrite(txCtx.db)),
      Effect.provideService(ServerContext.Env, envServiceFor(httpCtx)),
      (provided) => withServerRuntime(provided, httpCtx),
    ) as Effect.Effect<A, E, RuntimeR>

  const boundary = makeCallBoundaryFactory(runner, options.onDefect)
  const callBoundaries = {
    reducer: (annotations: CallLogAnnotations, ctx: BaseReducerCtx<Module>) =>
      boundary(
        { ...annotations, sender: senderLogValue(ctx.sender) },
        (effect) => withServerRuntime(effect, ctx),
      ),
    procedure: (
      annotations: CallLogAnnotations,
      ctx: ProcedureCtxLike<Module>,
    ) =>
      boundary(
        { ...annotations, sender: senderLogValue(ctx.sender) },
        (effect) =>
          withServerRuntime(
            effect,
            ctx,
            makeProcedureServerClock(ctx[ProcedureClockNow]),
          ),
      ),
    httpHandler: (
      annotations: CallLogAnnotations,
      ctx: HttpHandlerCtxLike<Module>,
    ) => boundary(annotations, (effect) => withServerRuntime(effect, ctx)),
    view: (annotations: CallLogAnnotations) =>
      boundary(annotations, (effect) =>
        withServerSupport(
          Effect.provideService(effect, Clock.Clock, makeUntimedServerClock()),
        ),
      ),
  }

  const bindReducer = <Key extends ReducerKeys<Module>>(
    key: Key,
    spec: Module["reducers"][Key],
    handler: (
      args: ParamsOf<Module["reducers"][Key]>,
    ) => Effect.Effect<
      unknown,
      ReducerHandlerErrors<Module["reducers"][Key]>,
      HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
    >,
  ): BoundReducerExport<Module, Key> => {
    const logAnnotations: HandlerLogAnnotations = {
      module: module.name,
      handler: String(key),
      kind: "reducer",
    }
    const spanOptions = makeHandlerSpanOptions("reducer")

    return {
      kind: "reducer",
      key,
      spec,
      invoke: (ctx, args) => {
        const boundary = callBoundaries.reducer(logAnnotations, ctx)
        const exit = boundary.run(() =>
          provideReducerServices(
            ctx,
            encodeDeclaredReducerFailure(
              spec,
              handler(args).pipe(
                Effect.withSpan(
                  String(key),
                  spanOptions,
                  handlerSpanTraceOptions,
                ),
              ),
            ),
          ),
        )
        return toReducerThrow(boundary.settle(exit, isSenderRefusal))
      },
      rejectArguments: (ctx, cause) => {
        const refusal = argumentsAreModuleRows(spec, ctx)
          ? undefined
          : callRefusalMessage(String(key), cause)
        if (refusal !== undefined) {
          throw new SenderError(refusal)
        }

        // A module's own row, or a schema's own code that broke: either way the
        // caller is not at fault.
        callBoundaries.reducer(logAnnotations, ctx).report(Cause.die(cause))
        throw cause
      },
    }
  }

  const bindProcedure = <Key extends ProcedureKeys<Module>>(
    key: Key,
    spec: Module["procedures"][Key],
    handler: (
      args: ParamsOf<Module["procedures"][Key]>,
    ) => Effect.Effect<
      ReturnsOf<Module["procedures"][Key]>,
      ProcedureHandlerErrors<Module["procedures"][Key]>,
      HandlerRequirements<RuntimeR, ProcedureAllowedRequirements>
    >,
  ): BoundProcedureExport<Module, Key> => {
    type Reply = ProcedureReply<ReturnsOf<Module["procedures"][Key]>>

    const logAnnotations: HandlerLogAnnotations = {
      module: module.name,
      handler: String(key),
      kind: "procedure",
    }
    const spanOptions = makeHandlerSpanOptions("procedure")
    // The host requires a scheduled procedure to return unit, and it has no
    // caller to answer: a failure of one ends in the module log.
    const scheduled = isScheduledFunction(spec)
    const failed = (): Reply =>
      (scheduled ? undefined : { err: procedureFailedErr }) as Reply

    return {
      kind: "procedure",
      key,
      spec,
      invoke: (ctx, args) => {
        const boundary = callBoundaries.procedure(logAnnotations, ctx)
        const exit = boundary.run(() =>
          provideProcedureRuntime(
            ctx,
            makeTxRunner({
              ctx,
              runner,
              provideServices: provideTxRuntime,
            }),
            encodeDeclaredProcedureFailure(
              spec,
              handler(args).pipe(
                Effect.withSpan(
                  String(key),
                  spanOptions,
                  handlerSpanTraceOptions,
                ),
              ),
            ),
          ),
        )

        return Exit.match(boundary.settle(exit), {
          onFailure: failed,
          onSuccess: (reply): Reply => {
            if (!scheduled) {
              return reply as Reply
            }
            if ("err" in reply) {
              boundary.warn(
                `Scheduled procedure ${String(key)} failed: ${String(reply.err)}`,
              )
            }
            return undefined as Reply
          },
        })
      },
      rejectArguments: (ctx, cause) => {
        // The scheduler guard turned a client away. Unit is all a scheduled
        // procedure can answer, and any caller could fill a log with this.
        if (StdbSenderError.is(cause)) {
          return undefined as Reply
        }

        const refusal = argumentsAreModuleRows(spec, ctx)
          ? undefined
          : callRefusalMessage(String(key), cause)
        if (refusal === undefined) {
          callBoundaries.procedure(logAnnotations, ctx).report(Cause.die(cause))
          return failed()
        }
        if (scheduled) {
          return undefined as Reply
        }

        return {
          err: encodeUndeclaredFailure({
            reason: "BadArguments",
            message: refusal,
          }),
        } as Reply
      },
      failReply: (ctx, cause) => {
        callBoundaries.procedure(logAnnotations, ctx).report(Cause.die(cause))
        return failed()
      },
    }
  }

  const bindHttpHandler = <Key extends HttpHandlerKeys<Module>>(
    key: Key,
    spec: Module["httpHandlers"][Key],
    handler: (
      args: HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
    ) => Effect.Effect<
      HttpHandlerResponseOf<Module["httpHandlers"][Key]>,
      HttpHandlerErrors<Module["httpHandlers"][Key]>,
      HandlerRequirements<RuntimeR, HttpHandlerAllowedRequirements>
    >,
  ): BoundHttpHandlerExport<Module, Key> => {
    const logAnnotations: CallLogAnnotations = {
      module: module.name,
      handler: String(key),
      kind: "httpHandler",
      route: `${spec.method.toUpperCase()} ${spec.path}`,
    }
    const spanOptions = makeHandlerSpanOptions("httpHandler")

    return {
      kind: "httpHandler",
      key,
      spec,
      invoke: (ctx, req) => {
        const boundary = callBoundaries.httpHandler(logAnnotations, ctx)
        const exit = boundary.run(() =>
          provideHttpHandlerRuntime(
            ctx,
            makeDbOnlyTxRunner({
              ctx,
              runner,
              provideServices: (txCtx, effect) =>
                provideHttpTxRuntime(ctx, txCtx, effect),
            }),
            encodeHttpResult(spec)(
              decodeHttpRequest(spec, req).pipe(
                Effect.flatMap((args) =>
                  handler(
                    args as HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
                  ).pipe(
                    Effect.withSpan(
                      String(key),
                      spanOptions,
                      handlerSpanTraceOptions,
                    ),
                  ),
                ),
              ),
            ),
          ),
        )

        return toHttpResponse(boundary.settle(exit, isHttpClientFault))
      },
    }
  }

  const bindView = <Key extends ViewKeys<Module>>(
    key: Key,
    spec: Module["views"][Key],
    handler: (
      args: ViewArgsOf<Module["views"][Key]>,
    ) => Effect.Effect<
      ViewSuccessOf<Module["views"][Key]>,
      ViewHandlerErrors,
      HandlerRequirements<
        RuntimeR,
        SenderViewAllowedRequirements | AnonymousViewAllowedRequirements
      >
    >,
  ): BoundViewExport<Module, Key> => {
    const logAnnotations: HandlerLogAnnotations = {
      module: module.name,
      handler: String(key),
      kind: "view",
    }
    const spanOptions = makeHandlerSpanOptions("view")
    const handlerEffect = (args: ViewArgsOf<Module["views"][Key]>) =>
      handler(args).pipe(
        Effect.withSpan(String(key), spanOptions, handlerSpanTraceOptions),
      )
    const senderBoundary = (viewCtx: ViewCtxLike<Module>) =>
      callBoundaries.view({
        ...logAnnotations,
        sender: senderLogValue(viewCtx.sender),
      })

    const reportFailure: BoundViewExport<Module, Key>["reportFailure"] = (
      ctx,
      cause,
    ) => {
      const boundary =
        spec.context === "sender"
          ? senderBoundary(ctx as ViewCtxLike<Module>)
          : callBoundaries.view(logAnnotations)
      boundary.report(Cause.die(cause))
    }

    return {
      kind: "view",
      key,
      spec,
      reportFailure,
      rejectArguments: (ctx, cause) => {
        // A view's arguments always come from its caller, and any caller could
        // fill the log. Only a schema's own broken code is the module's failure.
        if (callRefusalMessage(String(key), cause) === undefined) {
          reportFailure(ctx, cause)
        }
        throw cause
      },
      invoke: (ctx, args) => {
        switch (spec.context) {
          case "sender": {
            const viewCtx = ctx as ViewCtxLike<Module>
            const boundary = senderBoundary(viewCtx)
            return toViewValue(
              boundary.settle(
                boundary.run(() =>
                  provideViewRuntime(
                    { context: "sender", ctx: viewCtx },
                    handlerEffect(args),
                  ),
                ),
              ),
            )
          }
          case "anonymous": {
            const anonymousCtx = ctx as AnonymousViewCtxLike<Module>
            const boundary = callBoundaries.view(logAnnotations)
            return toViewValue(
              boundary.settle(
                boundary.run(() =>
                  provideViewRuntime(
                    { context: "anonymous", ctx: anonymousCtx },
                    handlerEffect(args),
                  ),
                ),
              ),
            )
          }
          default:
            const _exhaustive: never = spec.context
            return _exhaustive
        }
      },
    }
  }

  const bindLifecycle = <Key extends LifecycleName, A, E>(
    key: Key,
    handler: () => Effect.Effect<
      A,
      E,
      HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
    >,
  ): BoundLifecycleExport<Module, Key> => {
    const logAnnotations: HandlerLogAnnotations = {
      module: module.name,
      handler: String(key),
      kind: "lifecycle",
    }
    const spanOptions = makeHandlerSpanOptions("lifecycle")

    return {
      kind: "lifecycle",
      key,
      invoke: (ctx) => {
        const boundary = callBoundaries.reducer(logAnnotations, ctx)
        const exit = boundary.run(() =>
          provideReducerServices(
            ctx,
            handler().pipe(
              Effect.withSpan(
                String(key),
                spanOptions,
                handlerSpanTraceOptions,
              ),
            ),
          ),
        )
        return toLifecycleThrow(boundary.settle(exit, isSenderRefusal))
      },
    }
  }

  const bindRecord = <Result>(
    section: string,
    known: Record<string, unknown>,
    handlers: Record<string, unknown>,
    bindOne: (key: string, handler: never) => unknown,
  ): Result =>
    Object.fromEntries(
      Object.entries(handlers).map(([key, handler]) => {
        assertKnownHandlerKey(section, key, known)
        return [key, bindOne(key, handler as never)]
      }),
    ) as Result

  return {
    plan,
    module,
    scheduleBindings,
    reducers: (handlers: ReducerHandlerRecord<Module, RuntimeR>) =>
      bindRecord("reducer", module.reducers, handlers, (key, handler) =>
        bindReducer(
          key as ReducerKeys<Module>,
          module.reducers[
            key as ReducerKeys<Module>
          ]! as Module["reducers"][ReducerKeys<Module>],
          handler,
        ),
      ),
    procedures: (handlers: ProcedureHandlerRecord<Module, RuntimeR>) =>
      bindRecord("procedure", module.procedures, handlers, (key, handler) =>
        bindProcedure(
          key as ProcedureKeys<Module>,
          module.procedures[
            key as ProcedureKeys<Module>
          ]! as Module["procedures"][ProcedureKeys<Module>],
          handler,
        ),
      ),
    httpHandlers: (handlers: HttpHandlerHandlerRecord<Module, RuntimeR>) =>
      bindRecord("HTTP", module.httpHandlers, handlers, (key, handler) =>
        bindHttpHandler(
          key as HttpHandlerKeys<Module>,
          module.httpHandlers[
            key as HttpHandlerKeys<Module>
          ]! as Module["httpHandlers"][HttpHandlerKeys<Module>],
          handler,
        ),
      ),
    views: (handlers: ViewHandlerRecord<Module, RuntimeR>) =>
      bindRecord("view", module.views, handlers, (key, handler) =>
        bindView(
          key as ViewKeys<Module>,
          module.views[
            key as ViewKeys<Module>
          ]! as Module["views"][ViewKeys<Module>],
          handler,
        ),
      ),
    lifecycle: (handlers: LifecycleHandlerRecord<Module, RuntimeR>) =>
      bindRecord("lifecycle", module.lifecycle, handlers, (key, handler) =>
        bindLifecycle(key as LifecycleName, handler),
      ),
  } as unknown as BoundModule<Module, RuntimeR>
}
