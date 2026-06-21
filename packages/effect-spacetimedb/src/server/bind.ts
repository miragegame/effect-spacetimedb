import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import type { StdbDecodeError } from "../decode-error.ts"
import type { HttpHandlerSpec } from "../contract/http-handler.ts"
import { isTypedHttpHandlerSpec } from "../contract/http-handler.ts"
import {
  Request,
  SyncResponse as NativeSyncResponse,
} from "../http-primitives.ts"
import {
  StdbValidationError,
  validateServerHandlers,
} from "../contract/module-validation.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ModulePlan } from "../module-plan.ts"
import { makeModulePlan } from "../module-plan.ts"
import { decodeEmptyHttpBody, httpWireCodec } from "../http-wire-codec.ts"
import * as ServerContext from "./context.ts"
import {
  type OwnedHandler,
  type OwnedHandlerBundle,
  HandlerBundleOwnerSymbol,
  HandlerOwnerSymbol,
  assertOwnedHandler,
  assertOwnedHandlerBundle,
  withHandlerBundleOwner,
  withServerOwner,
} from "./handler-ownership.ts"
import {
  clientConnected as makeClientConnectedHandler,
  clientDisconnected as makeClientDisconnectedHandler,
  init as makeInitHandler,
  type LifecycleHandler,
} from "./lifecycle.ts"
import {
  procedure as makeProcedureHandler,
  type ProcedureHandler,
} from "./procedure.ts"
import {
  reducer as makeReducerHandler,
  type ReducerHandler,
} from "./reducer.ts"
import {
  type StdbHostFailure,
  StdbSenderFailure,
  wrapHttp,
} from "./services.ts"
import {
  hostCall,
  HttpRequestDecodeError,
  encodeHttpResult,
  toHttpResponse,
  toProcedureValue,
  toReducerThrow,
  toViewValue,
} from "./callable-runtime.ts"
import { makeDbHandleFactory } from "./db-handle.ts"
import {
  encodeDeclaredProcedureFailure,
  encodeDeclaredReducerFailure,
} from "./declared-errors.ts"
import type {
  AnonymousViewAllowedRequirements,
  BoundLifecycleExport,
  BoundProcedureExport,
  BoundReducerExport,
  BoundViewExport,
  CallableContextFields,
  HandlerInputDefinitions,
  HandlerRequirements,
  HandlerWithoutForbiddenRequirements,
  Handlers,
  HttpHandlerAllowedRequirements,
  HttpHandlerErrors,
  HttpHandlerHandlerRecord,
  HttpHandlerKeys,
  HttpHandlerRequestOf,
  HttpHandlerResponseOf,
  HttpTransactionHelper,
  HttpTxEffectWithoutScopedSuccess,
  HttpTxAllowedRequirements,
  LifecycleHandlerRecord,
  LifecycleKeys,
  MakeOptions,
  ParamsOf,
  ProcedureAllowedRequirements,
  ProcedureHandlerErrors,
  ProcedureHandlerRecord,
  ProcedureKeys,
  ReducerAllowedRequirements,
  ReducerHandlerErrors,
  ReducerHandlerRecord,
  ReducerKeys,
  ReturnsOf,
  SenderViewAllowedRequirements,
  ServerInstance,
  TxAllowedRequirements,
  TxEffectWithoutScopedSuccess,
  ViewArgsOf,
  ViewHandlerErrors,
  ViewHandlerRecord,
  ViewKeys,
  ViewSuccessOf,
  BoundHttpHandlerExport,
} from "./handler-types.ts"
import {
  defaultServerRuntimeMode,
  provideConstrainedServerRuntime,
  provideConstrainedServerSupport,
  type ConstrainedServerRuntimeMode,
} from "./runtime-layer.ts"
import type {
  AnonymousViewCtxLike,
  BaseReducerCtx,
  DbShape,
  HttpHandlerCtxLike,
  ProcedureCtxLike,
  ViewCtxLike,
} from "./runtime-types.ts"
import {
  from as toSyncRunner,
  fromLayer as toSyncRunnerFromLayer,
  type SyncRunner,
} from "./sync-runner.ts"
import { makeDbOnlyTxRunner, makeTxRunner } from "./tx.ts"
import {
  httpHandler as makeHttpHandlerHandler,
  type HttpHandlerHandler,
} from "./http-handler.ts"
import {
  anonymousView as makeAnonymousViewHandler,
  view as makeViewHandler,
  type ViewHandler,
} from "./view.ts"

export type {
  ServerAnonymousViewCtx,
  ServerHttpHandlerCtx,
  ServerProcedureCtx,
  ServerReducerCtx,
  ServerSenderViewCtx,
} from "./runtime-types.ts"
export type {
  HandlerInputDefinitions,
  Handlers,
  LifecycleKeys,
  MakeOptions,
  ServerInstance,
} from "./handler-types.ts"

const assertHandlerRecordOwnership = <
  RecordType extends Record<string, unknown>,
>(
  owner: symbol,
  section: string,
  record: RecordType,
) => {
  for (const [key, handler] of Object.entries(record)) {
    assertOwnedHandler(owner, handler as OwnedHandler, `${section}.${key}`)
  }
}

const isOwnedHandler = (value: unknown): value is OwnedHandler =>
  typeof value === "object" && value !== null && HandlerOwnerSymbol in value

const isOwnedHandlerBundle = (value: unknown): value is OwnedHandlerBundle =>
  typeof value === "object" &&
  value !== null &&
  HandlerBundleOwnerSymbol in value

const assertKnownHandlerKey = (
  section: string,
  key: string,
  specs: Record<string, unknown>,
) => {
  if (!(key in specs)) {
    throw new Error(`Unknown ${section} handler key ${key}`)
  }
}

const decodeHttpRequest = (
  spec: HttpHandlerSpec,
  request: Request,
): Effect.Effect<unknown, HttpRequestDecodeError> => {
  if (!isTypedHttpHandlerSpec(spec)) {
    return Effect.succeed(request)
  }

  return Effect.try({
    try: () => request.text(),
    catch: (cause) => new HttpRequestDecodeError({ cause }),
  }).pipe(
    Effect.flatMap((body) => {
      if (body.length === 0) {
        return decodeEmptyHttpBody(spec.request).pipe(
          Effect.mapError((cause) => new HttpRequestDecodeError({ cause })),
        )
      }

      return Schema.decodeUnknownEffect(httpWireCodec(spec.request))(body).pipe(
        Effect.mapError((cause) => new HttpRequestDecodeError({ cause })),
      )
    }),
  )
}

const messageFromThrowable = (cause: unknown): string =>
  cause instanceof Error && cause.message.length > 0
    ? cause.message
    : String(cause)

const logHttpHandlerBoundaryFailure = <Module extends AnyModuleSpec>(
  runner: SyncRunner,
  runtimeMode: ConstrainedServerRuntimeMode,
  ctx: HttpHandlerCtxLike<Module>,
  key: string,
  spec: HttpHandlerSpec,
  cause: unknown,
): void => {
  const route = `${spec.method.toUpperCase()} ${spec.path}`
  runner.runSync(
    provideConstrainedServerRuntime(
      Effect.logError(
        `SpaceTimeDB HTTP handler ${key} (${route}) returned 500 after an uncaught host-boundary failure: ${messageFromThrowable(cause)}`,
      ),
      ctx,
      runtimeMode,
    ),
  )
}

type HandlerLogKind =
  | "reducer"
  | "procedure"
  | "httpHandler"
  | "view"
  | "lifecycle"

type HandlerLogAnnotations = {
  readonly module: string
  readonly handler: string
  readonly kind: HandlerLogKind
}

const senderLogValue = (sender: unknown): string => {
  if (
    typeof sender === "object" &&
    sender !== null &&
    typeof (sender as { readonly toHexString?: unknown }).toHexString ===
      "function"
  ) {
    const value = (
      sender as { readonly toHexString: () => unknown }
    ).toHexString()
    if (typeof value === "string") {
      return value
    }
  }

  return String(sender)
}

const makeCallableContextHelpers = <
  ContextValue extends CallableContextFields,
  Requirements,
>(
  context: Effect.Effect<ContextValue, never, Requirements>,
  opPrefix: string,
) => ({
  sender: Effect.map(context, (ctx) => ctx.sender),
  identity: Effect.map(context, (ctx) => ctx.identity),
  timestamp: Effect.map(context, (ctx) => ctx.timestamp),
  connectionId: Effect.map(context, (ctx) => ctx.connectionId),
  random: Effect.map(context, (ctx) => ctx.random),
  newUuidV4: Effect.flatMap(context, (ctx) =>
    hostCall(`${opPrefix}.newUuidV4`, () => ctx.newUuidV4()),
  ),
  newUuidV7: Effect.flatMap(context, (ctx) =>
    hostCall(`${opPrefix}.newUuidV7`, () => ctx.newUuidV7()),
  ),
})

const makeHttpHandlerContextHelpers = <
  ContextValue extends {
    readonly databaseIdentity: unknown
    readonly timestamp: unknown
    readonly random: unknown
    readonly newUuidV4: () => unknown
    readonly newUuidV7: () => unknown
  },
  Requirements,
>(
  context: Effect.Effect<ContextValue, never, Requirements>,
) => ({
  databaseIdentity: Effect.map(context, (ctx) => ctx.databaseIdentity),
  timestamp: Effect.map(context, (ctx) => ctx.timestamp),
  random: Effect.map(context, (ctx) => ctx.random),
  newUuidV4: Effect.flatMap(context, (ctx) =>
    hostCall("httpHandlerCtx.newUuidV4", () => ctx.newUuidV4()),
  ),
  newUuidV7: Effect.flatMap(context, (ctx) =>
    hostCall("httpHandlerCtx.newUuidV7", () => ctx.newUuidV7()),
  ),
})

export function makeFromModulePlan<Module extends AnyModuleSpec>(options: {
  readonly plan: ModulePlan<Module>
  readonly runtime?: undefined
}): ServerInstance<Module>
export function makeFromModulePlan<
  Module extends AnyModuleSpec,
  RuntimeR,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly runtime: MakeOptions<Module, RuntimeR>["runtime"]
}): ServerInstance<Module, RuntimeR>
export function makeFromModulePlan<
  Module extends AnyModuleSpec,
  RuntimeR = never,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly runtime?: MakeOptions<Module, RuntimeR>["runtime"]
}): ServerInstance<Module, RuntimeR> {
  const module = options.plan.module
  const scheduleBindings = options.plan.scheduleBindings
  const dbHandles = makeDbHandleFactory(module)
  const runner: SyncRunner<RuntimeR> =
    options.runtime === undefined
      ? (toSyncRunnerFromLayer(Layer.empty) as SyncRunner<RuntimeR>)
      : toSyncRunner(options.runtime)
  const runtimeMode = defaultServerRuntimeMode
  const owner = Symbol("effect-spacetimedb/ServerInstance")
  let disposed = false

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
      Effect.provideService(ServerContext.MutationCtx, ctx),
      Effect.provideService(ServerContext.Db, dbHandles.readwrite(ctx.db)),
      (provided) => provideConstrainedServerRuntime(provided, ctx, runtimeMode),
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
      Effect.provideService(ServerContext.Http, wrapHttp(ctx.http)),
      Effect.provideService(ServerContext.TxRunner, txRunner),
      (provided) => provideConstrainedServerRuntime(provided, ctx, runtimeMode),
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
      Effect.provideService(ServerContext.Http, wrapHttp(ctx.http)),
      Effect.provideService(ServerContext.HttpTxRunner, txRunner),
      (provided) => provideConstrainedServerRuntime(provided, ctx, runtimeMode),
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
            Effect.provideService(ServerContext.From, ctx.from),
            Effect.provideService(
              ServerContext.ReadonlyDb,
              dbHandles.readonly(ctx.db),
            ),
          ),
        anonymous: ({ ctx }) =>
          effect.pipe(
            Effect.provideService(ServerContext.AnonymousViewCtx, ctx),
            Effect.provideService(ServerContext.From, ctx.from),
            Effect.provideService(
              ServerContext.ReadonlyDb,
              dbHandles.readonly(ctx.db),
            ),
          ),
      }),
    )

    return provideConstrainedServerSupport(
      // Server binding boundary: view handler records erase the sender/anonymous context distinction before binding.
      // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
      provided as Effect.Effect<A, E, RuntimeR>,
      runtimeMode,
    )
  }

  const provideTxRuntime = <A, E, R extends TxAllowedRequirements | RuntimeR>(
    txCtx: BaseReducerCtx<Module>,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, RuntimeR> =>
    effect.pipe(
      Effect.provideService(ServerContext.TxCtx, txCtx),
      Effect.provideService(ServerContext.MutationCtx, txCtx),
      Effect.provideService(ServerContext.Db, dbHandles.readwrite(txCtx.db)),
      (provided) =>
        provideConstrainedServerRuntime(provided, txCtx, runtimeMode),
    ) as Effect.Effect<A, E, RuntimeR>

  const provideHttpTxRuntime = <
    A,
    E,
    R extends HttpTxAllowedRequirements | RuntimeR,
  >(
    httpCtx: HttpHandlerCtxLike<Module>,
    txCtx: { readonly db: DbShape<Module> },
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, RuntimeR> =>
    effect.pipe(
      Effect.provideService(ServerContext.Db, dbHandles.readwrite(txCtx.db)),
      (provided) =>
        provideConstrainedServerRuntime(provided, httpCtx, runtimeMode),
    ) as Effect.Effect<A, E, RuntimeR>

  const withTx = <A, E, R>(
    effect: ServerContext.EffectWithoutForbiddenRequirements<
      Effect.Effect<A, E, R>,
      TxAllowedRequirements
    >,
  ): Effect.Effect<
    A,
    E | StdbHostFailure | StdbDecodeError,
    Exclude<R, TxAllowedRequirements> | ServerContext.TxRunner
  > =>
    Effect.flatMap(ServerContext.TxRunner, (txRunner) => txRunner.run(effect))

  const tx = <EffectType extends ServerContext.AnyServerEffect>(
    body: (scope: {
      readonly ctx: ServerContext.TxCtxService<Module>
      readonly db: ServerContext.DbService<Module>
    }) => ServerContext.EffectWithoutForbiddenRequirements<
      TxEffectWithoutScopedSuccess<Module, EffectType>,
      TxAllowedRequirements
    >,
  ): Effect.Effect<
    Effect.Success<EffectType>,
    Effect.Error<EffectType> | StdbHostFailure | StdbDecodeError,
    | Exclude<Effect.Services<EffectType>, TxAllowedRequirements>
    | ServerContext.TxRunner
  > => {
    const scoped = Effect.flatMap(ServerContext.TxCtx, (ctx) =>
      Effect.flatMap(ServerContext.Db, (db) =>
        body({
          ctx: ctx as ServerContext.TxCtxService<Module>,
          db: db as ServerContext.DbService<Module>,
        }),
      ),
    )
    const constrained =
      scoped as ServerContext.EffectWithoutForbiddenRequirements<
        EffectType,
        TxAllowedRequirements
      >
    const run = withTx(constrained)
    // Server binding boundary: withTx preserves the caller channel after removing tx-scoped services.
    // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
    return run as Effect.Effect<
      Effect.Success<EffectType>,
      Effect.Error<EffectType> | StdbHostFailure | StdbDecodeError,
      | Exclude<Effect.Services<EffectType>, TxAllowedRequirements>
      | ServerContext.TxRunner
    >
  }

  const httpWithTx = <EffectType extends ServerContext.AnyServerEffect>(
    effect: ServerContext.EffectWithoutForbiddenRequirements<
      EffectType,
      HttpTxAllowedRequirements
    >,
  ): Effect.Effect<
    Effect.Success<EffectType>,
    Effect.Error<EffectType> | StdbHostFailure | StdbDecodeError,
    | Exclude<Effect.Services<EffectType>, HttpTxAllowedRequirements>
    | ServerContext.HttpTxRunner
  > => {
    const run = Effect.flatMap(ServerContext.HttpTxRunner, (txRunner) =>
      txRunner.run(effect),
    )
    // Server binding boundary: HttpTxRunner removes HTTP transaction services that the helper supplies.
    // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
    return run as Effect.Effect<
      Effect.Success<EffectType>,
      Effect.Error<EffectType> | StdbHostFailure | StdbDecodeError,
      | Exclude<Effect.Services<EffectType>, HttpTxAllowedRequirements>
      | ServerContext.HttpTxRunner
    >
  }

  const httpTx: HttpTransactionHelper<Module> = <
    EffectType extends ServerContext.AnyServerEffect,
  >(
    body: (scope: {
      readonly db: ServerContext.DbService<Module>
    }) => ServerContext.EffectWithoutForbiddenRequirements<
      HttpTxEffectWithoutScopedSuccess<Module, EffectType>,
      HttpTxAllowedRequirements
    >,
  ) =>
    httpWithTx(
      Effect.flatMap(ServerContext.Db, (db) =>
        body({
          db: db as ServerContext.DbService<Module>,
        }),
      ) as ServerContext.EffectWithoutForbiddenRequirements<
        HttpTxEffectWithoutScopedSuccess<Module, EffectType>,
        HttpTxAllowedRequirements
      >,
    )

  function reducer<Args, A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      (args: Args) => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ): ReducerHandler<Args, A, E, R>
  function reducer<Args, A, E, R>(
    handler: (args: Args) => Effect.Effect<A, E, R>,
  ): ReducerHandler<Args, A, E, R> {
    return makeReducerHandler(owner, handler)
  }

  function procedure<A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ProcedureAllowedRequirements
    >,
  ): ProcedureHandler<void, A, E, R>
  function procedure<Args, A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      (args: Args) => Effect.Effect<A, E, R>,
      ProcedureAllowedRequirements
    >,
  ): ProcedureHandler<Args, A, E, R>
  function procedure<Args, A, E, R>(
    handler:
      | ((args: Args) => Effect.Effect<A, E, R>)
      | (() => Effect.Effect<A, E, R>),
  ): ProcedureHandler<Args, A, E, R> {
    return makeProcedureHandler(
      owner,
      handler as (args: Args) => Effect.Effect<A, E, R>,
    )
  }

  function httpHandler<Args, A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      (args: Args) => Effect.Effect<A, E, R>,
      HttpHandlerAllowedRequirements
    >,
  ): HttpHandlerHandler<Args, A, E, R>
  function httpHandler<Args, A, E, R>(
    handler: (args: Args) => Effect.Effect<A, E, R>,
  ): HttpHandlerHandler<Args, A, E, R> {
    return makeHttpHandlerHandler(owner, handler)
  }

  function view<Args, A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      (args: Args) => Effect.Effect<A, E, R>,
      SenderViewAllowedRequirements
    >,
  ): ViewHandler<Args, A, E, R>
  function view<Args, A, E, R>(
    handler: (args: Args) => Effect.Effect<A, E, R>,
  ): ViewHandler<Args, A, E, R> {
    return makeViewHandler(owner, handler)
  }

  function anonymousView<Args, A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      (args: Args) => Effect.Effect<A, E, R>,
      AnonymousViewAllowedRequirements
    >,
  ): ViewHandler<Args, A, E, R>
  function anonymousView<Args, A, E, R>(
    handler: (args: Args) => Effect.Effect<A, E, R>,
  ): ViewHandler<Args, A, E, R> {
    return makeAnonymousViewHandler(owner, handler)
  }

  const init = <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ): LifecycleHandler<A, E, R> => makeInitHandler(owner, handler)

  const clientConnected = <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ): LifecycleHandler<A, E, R> => makeClientConnectedHandler(owner, handler)

  const clientDisconnected = <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ): LifecycleHandler<A, E, R> => makeClientDisconnectedHandler(owner, handler)

  type SimpleHandler = (
    args: unknown,
  ) => Effect.Effect<unknown, unknown, unknown>

  const wrapSimpleRecord =
    <Wrapped>(
      label: string,
      section: string,
      knownKeys: Record<string, unknown>,
      make: (owner: symbol, handler: SimpleHandler) => unknown,
    ) =>
    (handlerSpecs: Record<string, unknown> | undefined): Wrapped | undefined =>
      handlerSpecs != null
        ? (Object.fromEntries(
            Object.entries(handlerSpecs).map(([key, handler]) => {
              assertKnownHandlerKey(label, key, knownKeys)
              if (isOwnedHandler(handler)) {
                assertOwnedHandler(owner, handler, `${section}.${key}`)
                return [key, handler]
              }

              return [key, make(owner, handler as SimpleHandler)]
            }),
          ) as Wrapped)
        : undefined

  const wrapReducerRecord = wrapSimpleRecord<
    ReducerHandlerRecord<Module, RuntimeR>
  >("reducer", "reducers", module.reducers, makeReducerHandler)

  const wrapProcedureRecord = wrapSimpleRecord<
    ProcedureHandlerRecord<Module, RuntimeR>
  >("procedure", "procedures", module.procedures, makeProcedureHandler)

  const wrapHttpHandlerRecord = wrapSimpleRecord<
    HttpHandlerHandlerRecord<Module, RuntimeR>
  >("HTTP", "httpHandlers", module.httpHandlers, makeHttpHandlerHandler)

  const wrapViewRecord = (
    handlerSpecs: Record<string, unknown> | undefined,
  ): ViewHandlerRecord<Module, RuntimeR> | undefined =>
    handlerSpecs != null
      ? (Object.fromEntries(
          Object.entries(handlerSpecs).map(([key, handler]) => {
            assertKnownHandlerKey("view", key, module.views)
            if (isOwnedHandler(handler)) {
              assertOwnedHandler(owner, handler, `views.${key}`)
              return [key, handler]
            }

            const spec = module.views[key as ViewKeys<Module>]
            if (spec === undefined) {
              throw new Error(`Unknown view handler key ${key}`)
            }

            const raw = handler as (
              args: unknown,
            ) => Effect.Effect<unknown, unknown, unknown>

            switch (spec.context) {
              case "sender":
                return [key, makeViewHandler(owner, raw)]
              case "anonymous":
                return [key, makeAnonymousViewHandler(owner, raw)]
              default:
                const _exhaustive: never = spec.context
                return _exhaustive
            }
          }),
        ) as ViewHandlerRecord<Module, RuntimeR>)
      : undefined

  const wrapLifecycleRecord = (
    handlerSpecs: Record<string, unknown> | undefined,
  ): LifecycleHandlerRecord<Module, RuntimeR> | undefined =>
    handlerSpecs != null
      ? (Object.fromEntries(
          Object.entries(handlerSpecs).map(([key, handler]) => {
            assertKnownHandlerKey("lifecycle", key, module.lifecycle)
            if (isOwnedHandler(handler)) {
              assertOwnedHandler(owner, handler, `lifecycle.${key}`)
              return [key, handler]
            }

            const raw = handler as () => Effect.Effect<
              unknown,
              unknown,
              unknown
            >
            const wrapped =
              key === "init"
                ? makeInitHandler(owner, raw)
                : key === "clientConnected"
                  ? makeClientConnectedHandler(owner, raw)
                  : key === "clientDisconnected"
                    ? makeClientDisconnectedHandler(owner, raw)
                    : undefined

            if (wrapped == null) {
              throw new Error(`Unknown lifecycle handler key ${key}`)
            }

            return [key, wrapped]
          }),
        ) as LifecycleHandlerRecord<Module, RuntimeR>)
      : undefined

  function handlers(
    definitions: HandlerInputDefinitions<Module, RuntimeR>,
  ): Handlers<Module, RuntimeR>
  function handlers(definitions: OwnedHandlerBundle): Handlers<Module, RuntimeR>
  function handlers(
    definitions: HandlerInputDefinitions<Module, unknown> | OwnedHandlerBundle,
  ): Handlers<Module, RuntimeR> {
    if (isOwnedHandlerBundle(definitions)) {
      assertOwnedHandlerBundle(owner, definitions)
      return definitions as Handlers<Module, RuntimeR>
    }

    const reducers = wrapReducerRecord(definitions.reducers)
    const procedures = wrapProcedureRecord(definitions.procedures)
    const httpHandlers = wrapHttpHandlerRecord(definitions.httpHandlers)
    const views = wrapViewRecord(definitions.views)
    const lifecycle = wrapLifecycleRecord(definitions.lifecycle)

    const assembled = {
      ...(reducers != null ? { reducers } : {}),
      ...(procedures != null ? { procedures } : {}),
      ...(httpHandlers != null ? { httpHandlers } : {}),
      ...(views != null ? { views } : {}),
      ...(lifecycle != null ? { lifecycle } : {}),
    }
    const diagnostics = validateServerHandlers(module, assembled)
    if (diagnostics.length > 0) {
      throw new StdbValidationError({ diagnostics })
    }

    return withHandlerBundleOwner(owner, assembled) as Handlers<
      Module,
      RuntimeR
    >
  }

  const bindReducer = <Key extends ReducerKeys<Module>>(
    key: Key,
    spec: Module["reducers"][Key],
    handlerSpec: ReducerHandler<
      ParamsOf<Module["reducers"][Key]>,
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

    return {
      kind: "reducer",
      key,
      spec,
      invoke: (ctx, args) => {
        const effect = provideReducerServices(
          ctx,
          encodeDeclaredReducerFailure(spec, handlerSpec.handler(args)),
        ).pipe(
          Effect.annotateLogs({
            ...logAnnotations,
            sender: senderLogValue(ctx.sender),
          }),
        )
        const exit = runner.runSyncExit(effect)
        return toReducerThrow(exit)
      },
    }
  }

  const bindProcedure = <Key extends ProcedureKeys<Module>>(
    key: Key,
    spec: Module["procedures"][Key],
    handlerSpec: ProcedureHandler<
      ParamsOf<Module["procedures"][Key]>,
      ReturnsOf<Module["procedures"][Key]>,
      ProcedureHandlerErrors<Module["procedures"][Key]>,
      HandlerRequirements<RuntimeR, ProcedureAllowedRequirements>
    >,
  ): BoundProcedureExport<Module, Key> => {
    const logAnnotations: HandlerLogAnnotations = {
      module: module.name,
      handler: String(key),
      kind: "procedure",
    }

    return {
      kind: "procedure",
      key,
      spec,
      invoke: (ctx, args) => {
        const txRunner = makeTxRunner({
          ctx,
          runner,
          provideServices: provideTxRuntime,
        })

        const effect = provideProcedureRuntime(
          ctx,
          txRunner,
          encodeDeclaredProcedureFailure(spec, handlerSpec.handler(args)),
        ).pipe(
          Effect.annotateLogs({
            ...logAnnotations,
            sender: senderLogValue(ctx.sender),
          }),
        )
        const exit = runner.runSyncExit(effect)

        return toProcedureValue(exit)
      },
    }
  }

  const bindHttpHandler = <Key extends HttpHandlerKeys<Module>>(
    key: Key,
    spec: Module["httpHandlers"][Key],
    handlerSpec: HttpHandlerHandler<
      HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
      HttpHandlerResponseOf<Module["httpHandlers"][Key]>,
      HttpHandlerErrors<Module["httpHandlers"][Key]>,
      HandlerRequirements<RuntimeR, HttpHandlerAllowedRequirements>
    >,
  ): BoundHttpHandlerExport<Module, Key> => {
    const logAnnotations: HandlerLogAnnotations = {
      module: module.name,
      handler: String(key),
      kind: "httpHandler",
    }

    return {
      kind: "httpHandler",
      key,
      spec,
      invoke: (ctx, req) => {
        try {
          const txRunner = makeDbOnlyTxRunner({
            ctx,
            runner,
            provideServices: (txCtx, effect) =>
              provideHttpTxRuntime(ctx, txCtx, effect),
          })

          const handlerEffect = decodeHttpRequest(spec, req).pipe(
            Effect.flatMap((args) =>
              handlerSpec.handler(
                args as HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
              ),
            ),
          )

          const effect = provideHttpHandlerRuntime(
            ctx,
            txRunner,
            encodeHttpResult(spec)(handlerEffect),
          ).pipe(Effect.annotateLogs(logAnnotations))
          const exit = runner.runSyncExit(effect)

          return toHttpResponse(exit)
        } catch (cause) {
          logHttpHandlerBoundaryFailure(
            runner,
            runtimeMode,
            ctx,
            key,
            spec,
            cause,
          )
          return new NativeSyncResponse(null, { status: 500 })
        }
      },
    }
  }

  const bindView = <Key extends ViewKeys<Module>>(
    key: Key,
    spec: Module["views"][Key],
    handlerSpec: ViewHandler<
      ViewArgsOf<Module["views"][Key]>,
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

    return {
      kind: "view",
      key,
      spec,
      invoke: (ctx, args) => {
        switch (spec.context) {
          case "sender": {
            const viewCtx = ctx as ViewCtxLike<Module>
            const effect = provideViewRuntime(
              { context: "sender", ctx: viewCtx },
              handlerSpec.handler(args),
            ).pipe(
              Effect.annotateLogs({
                ...logAnnotations,
                sender: senderLogValue(viewCtx.sender),
              }),
            )

            return toViewValue(runner.runSyncExit(effect))
          }
          case "anonymous": {
            const anonymousCtx = ctx as AnonymousViewCtxLike<Module>
            const effect = provideViewRuntime(
              { context: "anonymous", ctx: anonymousCtx },
              handlerSpec.handler(args),
            ).pipe(Effect.annotateLogs(logAnnotations))

            return toViewValue(runner.runSyncExit(effect))
          }
          default:
            const _exhaustive: never = spec.context
            return _exhaustive
        }
      },
    }
  }

  const bindLifecycle = <Key extends LifecycleKeys, A, E>(
    key: Key,
    handlerSpec: LifecycleHandler<
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

    return {
      kind: "lifecycle",
      key,
      invoke: (ctx) => {
        const effect = provideReducerServices(ctx, handlerSpec.handler()).pipe(
          Effect.annotateLogs({
            ...logAnnotations,
            sender: senderLogValue(ctx.sender),
          }),
        )
        const exit = runner.runSyncExit(effect)
        return toReducerThrow(exit)
      },
    }
  }

  const ctx = {
    reducer: {
      ...makeCallableContextHelpers(ServerContext.ReducerCtx, "reducerCtx"),
      senderAuth: Effect.map(
        ServerContext.ReducerCtx,
        (reducerCtx) => reducerCtx.senderAuth,
      ),
    },
    procedure: makeCallableContextHelpers(
      ServerContext.ProcedureCtx,
      "procedureCtx",
    ),
    httpHandler: makeHttpHandlerContextHelpers(ServerContext.HttpHandlerCtx),
    tx: {
      ...makeCallableContextHelpers(ServerContext.TxCtx, "txCtx"),
      senderAuth: Effect.map(ServerContext.TxCtx, (txCtx) => txCtx.senderAuth),
    },
    view: {
      sender: Effect.map(ServerContext.ViewCtx, (viewCtx) => viewCtx.sender),
    },
  }

  const bindRecord = <Result>(
    section: string,
    handlerSpecs: Record<string, unknown>,
    bindOne: (key: string, handlerSpec: unknown) => unknown,
  ): Result => {
    assertHandlerRecordOwnership(owner, section, handlerSpecs)
    return Object.fromEntries(
      Object.entries(handlerSpecs).map(([key, handlerSpec]) => [
        key,
        bindOne(key, handlerSpec),
      ]),
    ) as Result
  }

  const server = {
    plan: options.plan,
    module,
    scheduleBindings,
    dispose: Effect.suspend(() => {
      if (disposed) {
        return Effect.void
      }

      disposed = true
      return runner.dispose ?? Effect.void
    }),
    ctx,
    reducerCtx: Effect.map(
      ServerContext.ReducerCtx,
      (ctx) => ctx as ServerContext.ReducerCtxService<Module>,
    ),
    procedureCtx: Effect.map(
      ServerContext.ProcedureCtx,
      (ctx) => ctx as ServerContext.ProcedureCtxService<Module>,
    ),
    httpHandlerCtx: Effect.map(
      ServerContext.HttpHandlerCtx,
      (ctx) => ctx as ServerContext.HttpHandlerCtxService<Module>,
    ),
    txCtx: Effect.map(
      ServerContext.TxCtx,
      (ctx) => ctx as ServerContext.TxCtxService<Module>,
    ),
    mutationCtx: Effect.map(
      ServerContext.MutationCtx,
      (ctx) => ctx as ServerContext.MutationCtxService<Module>,
    ),
    viewCtx: Effect.map(
      ServerContext.ViewCtx,
      (ctx) => ctx as ServerContext.ViewCtxService<Module>,
    ),
    anonymousViewCtx: Effect.map(
      ServerContext.AnonymousViewCtx,
      (ctx) => ctx as ServerContext.AnonymousViewCtxService<Module>,
    ),
    db: Effect.map(
      ServerContext.Db,
      (db) => db as ServerContext.DbService<Module>,
    ),
    readonlyDb: Effect.map(
      ServerContext.ReadonlyDb,
      (db) => db as ServerContext.ReadonlyDbService<Module>,
    ),
    from: Effect.map(
      ServerContext.From,
      (from) => from as ServerContext.FromService<Module>,
    ),
    http: Effect.map(ServerContext.Http, (http) => http),
    txRunner: ServerContext.txRunnerForModule<Module>(),
    httpTxRunner: ServerContext.httpTxRunnerForModule<Module>(),
    tx,
    transaction: tx,
    httpTransaction: httpTx,
    withTx,
    reducer,
    procedure,
    httpHandler,
    view,
    anonymousView,
    init,
    clientConnected,
    clientDisconnected,
    handlers,
    failRaw: (message: string) => new StdbSenderFailure({ value: message }),
    reducers: (handlerSpecs: ReducerHandlerRecord<Module, RuntimeR>) =>
      bindRecord<{
        readonly [Key in keyof typeof handlerSpecs]: Key extends ReducerKeys<Module>
          ? BoundReducerExport<Module, Key>
          : never
      }>("reducers", handlerSpecs, (key, handlerSpec) =>
        bindReducer(
          key as ReducerKeys<Module>,
          module.reducers[
            key as ReducerKeys<Module>
          ]! as Module["reducers"][ReducerKeys<Module>],
          handlerSpec as ReducerHandler<
            ParamsOf<Module["reducers"][ReducerKeys<Module>]>,
            unknown,
            ReducerHandlerErrors<Module["reducers"][ReducerKeys<Module>]>,
            HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
          >,
        ),
      ),
    procedures: (handlerSpecs: ProcedureHandlerRecord<Module, RuntimeR>) =>
      bindRecord<{
        readonly [Key in keyof typeof handlerSpecs]: Key extends ProcedureKeys<Module>
          ? BoundProcedureExport<Module, Key>
          : never
      }>("procedures", handlerSpecs, (key, handlerSpec) =>
        bindProcedure(
          key as ProcedureKeys<Module>,
          module.procedures[
            key as ProcedureKeys<Module>
          ]! as Module["procedures"][ProcedureKeys<Module>],
          handlerSpec as ProcedureHandler<
            ParamsOf<Module["procedures"][ProcedureKeys<Module>]>,
            ReturnsOf<Module["procedures"][ProcedureKeys<Module>]>,
            ProcedureHandlerErrors<Module["procedures"][ProcedureKeys<Module>]>,
            HandlerRequirements<RuntimeR, ProcedureAllowedRequirements>
          >,
        ),
      ),
    httpHandlers: (handlerSpecs: HttpHandlerHandlerRecord<Module, RuntimeR>) =>
      bindRecord<{
        readonly [Key in keyof typeof handlerSpecs]: Key extends HttpHandlerKeys<Module>
          ? BoundHttpHandlerExport<Module, Key>
          : never
      }>("httpHandlers", handlerSpecs, (key, handlerSpec) =>
        bindHttpHandler(
          key as HttpHandlerKeys<Module>,
          module.httpHandlers[
            key as HttpHandlerKeys<Module>
          ]! as Module["httpHandlers"][HttpHandlerKeys<Module>],
          handlerSpec as HttpHandlerHandler<
            HttpHandlerRequestOf<
              Module["httpHandlers"][HttpHandlerKeys<Module>]
            >,
            HttpHandlerResponseOf<
              Module["httpHandlers"][HttpHandlerKeys<Module>]
            >,
            HttpHandlerErrors<Module["httpHandlers"][HttpHandlerKeys<Module>]>,
            HandlerRequirements<RuntimeR, HttpHandlerAllowedRequirements>
          >,
        ),
      ),
    views: (handlerSpecs: ViewHandlerRecord<Module, RuntimeR>) =>
      bindRecord<{
        readonly [Key in keyof typeof handlerSpecs]: Key extends ViewKeys<Module>
          ? BoundViewExport<Module, Key>
          : never
      }>("views", handlerSpecs, (key, handlerSpec) =>
        bindView(
          key as ViewKeys<Module>,
          module.views[
            key as ViewKeys<Module>
          ]! as Module["views"][ViewKeys<Module>],
          handlerSpec as ViewHandler<
            ViewArgsOf<Module["views"][ViewKeys<Module>]>,
            ViewSuccessOf<Module["views"][ViewKeys<Module>]>,
            ViewHandlerErrors,
            HandlerRequirements<
              RuntimeR,
              SenderViewAllowedRequirements | AnonymousViewAllowedRequirements
            >
          >,
        ),
      ),
    lifecycle: (handlerSpecs: LifecycleHandlerRecord<Module, RuntimeR>) =>
      bindRecord<{
        readonly [Key in keyof typeof handlerSpecs]: Key extends LifecycleKeys
          ? BoundLifecycleExport<Module, Key>
          : never
      }>("lifecycle", handlerSpecs, (key, handlerSpec) =>
        bindLifecycle(
          key as LifecycleKeys,
          handlerSpec as LifecycleHandler<
            unknown,
            unknown,
            HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
          >,
        ),
      ),
  }

  return withServerOwner(owner, server) as unknown as ServerInstance<
    Module,
    RuntimeR
  >
}

export function make<Module extends AnyModuleSpec>(
  options: MakeOptions<Module> & { readonly runtime?: undefined },
): ServerInstance<Module>
export function make<Module extends AnyModuleSpec, RuntimeR>(
  options: MakeOptions<Module, RuntimeR> & {
    readonly runtime: MakeOptions<Module, RuntimeR>["runtime"]
  },
): ServerInstance<Module, RuntimeR>
export function make<Module extends AnyModuleSpec, RuntimeR = never>(
  options: MakeOptions<Module, RuntimeR>,
): ServerInstance<Module> | ServerInstance<Module, RuntimeR> {
  return (
    options.runtime === undefined
      ? makeFromModulePlan({
          plan: makeModulePlan(options.module),
        })
      : makeFromModulePlan({
          plan: makeModulePlan(options.module),
          runtime: options.runtime,
        })
  ) as ServerInstance<Module, RuntimeR>
}
