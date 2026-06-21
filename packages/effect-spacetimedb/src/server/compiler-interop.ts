// lint-ignore: unused-files - used through the package server-compiler export map entrypoint.

import type { BinaryWriter } from "spacetimedb"
import type {
  HttpHandlerExport,
  ModuleExport,
  Request,
  t as ServerFactories,
  Router as ServerRouter,
  table as ServerTable,
  SyncResponse,
} from "spacetimedb/server"
import * as SpacetimeServer from "spacetimedb/server"
import type { AnyModuleSpec } from "../contract/module.ts"
import * as Type from "../contract/type.ts"
import type {
  ServerAnonymousViewCtx,
  ServerConnectionId,
  ServerDatabaseIdentity,
  ServerHttpHandlerCtx,
  ServerIdentity,
  ServerProcedureCtx,
  ServerRandom,
  ServerReducerCtx,
  ServerSender,
  ServerSenderAuth,
  ServerSenderViewCtx,
  ServerTimestamp,
  ServerUuid,
} from "./runtime-types.ts"

const { Router, table, t } = SpacetimeServer as unknown as {
  readonly Router: new () => ServerRouter
  readonly table: typeof ServerTable
  readonly t: typeof ServerFactories
}

type OptionalTypeBuilder = {
  readonly optional: () => unknown
}

type DefaultableTypeBuilder = {
  readonly default: (value: unknown) => unknown
}

type NameableTypeBuilder = {
  readonly name: (name: string) => unknown
}

type PrimaryKeyableTypeBuilder = {
  readonly primaryKey: () => unknown
}

type AutoIncrementableTypeBuilder = {
  readonly autoInc: () => unknown
}

const unsupportedCompilerColumnMethod = (method: string): never => {
  throw new Error(
    `SpaceTimeDB compiler column builder does not support ${method}`,
  )
}

type CompilerColumnBridge = {
  readonly typeBuilder: unknown
  readonly serialize: (writer: BinaryWriter, value: never) => void
}

type CompilerRowBridge = {
  readonly row: Record<string, CompilerColumnBridge>
}

export type CompilerSchemaBridge = {
  readonly reducer: (
    params: unknown,
    handler: (ctx: unknown, rawArgs: unknown) => void,
  ) => ModuleExport
  readonly procedure: (
    params: unknown,
    returnType: unknown,
    handler: (ctx: unknown, rawArgs: unknown) => unknown,
  ) => ModuleExport
  readonly view: (
    options: { readonly name: string; readonly public: boolean },
    returnType: unknown,
    handler: (ctx: unknown) => unknown,
  ) => ModuleExport
  readonly anonymousView: (
    options: { readonly name: string; readonly public: boolean },
    returnType: unknown,
    handler: (ctx: unknown) => unknown,
  ) => ModuleExport
  readonly httpHandler: (
    handler: (ctx: unknown, req: Request) => SyncResponse,
  ) => HttpHandlerExport
  readonly httpRouter: (router: ServerRouter) => ModuleExport
  readonly init: (handler: (ctx: unknown) => void) => ModuleExport
  readonly clientConnected: (handler: (ctx: unknown) => void) => ModuleExport
  readonly clientDisconnected: (handler: (ctx: unknown) => void) => ModuleExport
  readonly exportGroup: (exports: Record<string, ModuleExport>) => ModuleExport
}

export type CompilerReducerHostCtx = {
  readonly sender: ServerSender
  readonly identity: ServerIdentity
  readonly timestamp: ServerTimestamp
  readonly connectionId: ServerConnectionId
  readonly db: unknown
  readonly senderAuth: ServerSenderAuth
  readonly newUuidV4: () => ServerUuid
  readonly newUuidV7: () => ServerUuid
  readonly random: ServerRandom
}

type CompilerCallableHostCtx = Omit<CompilerReducerHostCtx, "db" | "senderAuth">

export type CompilerProcedureHostCtx = CompilerCallableHostCtx & {
  readonly http: {
    readonly fetch: (
      url: string,
      init?: unknown,
    ) => {
      readonly text: () => string
      readonly json: () => unknown
      readonly bytes: () => Uint8Array
    }
  }
  readonly withTx: <A>(body: (ctx: CompilerReducerHostCtx) => A) => A
}

export type CompilerHttpHandlerHostCtx = {
  readonly timestamp: ServerTimestamp
  readonly http: CompilerProcedureHostCtx["http"]
  readonly identity: ServerDatabaseIdentity
  readonly random: ServerRandom
  readonly withTx: <A>(body: (ctx: { readonly db: unknown }) => A) => A
  readonly newUuidV4: () => ServerUuid
  readonly newUuidV7: () => ServerUuid
}

export type CompilerSenderViewHostCtx = {
  readonly sender: unknown
  readonly db: unknown
  readonly from: unknown
}

export type CompilerAnonymousViewHostCtx = {
  readonly db: unknown
  readonly from: unknown
}

export const applyOptional = (builder: unknown): unknown =>
  (builder as OptionalTypeBuilder).optional()

export const applyCompilerDefault = (
  builder: unknown,
  value: unknown,
): unknown =>
  typeof (builder as Partial<DefaultableTypeBuilder>).default === "function"
    ? (builder as DefaultableTypeBuilder).default(value)
    : unsupportedCompilerColumnMethod("default(...)")

export const applyCompilerColumnName = (
  builder: unknown,
  name: string,
): unknown =>
  typeof (builder as Partial<NameableTypeBuilder>).name === "function"
    ? (builder as NameableTypeBuilder).name(name)
    : unsupportedCompilerColumnMethod("name(...)")

export const defineCompilerTable = (options: unknown, row: unknown): unknown =>
  table(options as never, row as never)

export const defineCompilerRow = (
  row: Record<string, unknown>,
): CompilerRowBridge => t.row(row as never) as unknown as CompilerRowBridge

export const toCompilerTypeBuilder = (
  value: Type.AnyValueType,
  path?: string,
): unknown => Type.typeBuilderWithFactories(value, t as never, path)

export const applyCompilerPrimaryKey = (builder: unknown): unknown =>
  typeof (builder as Partial<PrimaryKeyableTypeBuilder>).primaryKey ===
  "function"
    ? (builder as PrimaryKeyableTypeBuilder).primaryKey()
    : unsupportedCompilerColumnMethod("primaryKey()")

export const applyCompilerAutoInc = (builder: unknown): unknown =>
  typeof (builder as Partial<AutoIncrementableTypeBuilder>).autoInc ===
  "function"
    ? (builder as AutoIncrementableTypeBuilder).autoInc()
    : unsupportedCompilerColumnMethod("autoInc()")

export const withCompilerScheduledTarget = <Options extends object>(
  options: Options,
  resolveTarget: () => unknown,
): Options =>
  ({
    ...options,
    scheduled: resolveTarget,
  }) as never

export const defineCompilerReducer = (
  schema: CompilerSchemaBridge,
  params: unknown,
  handler: (ctx: unknown, rawArgs: unknown) => void,
): ModuleExport => schema.reducer(params as never, handler as never)

export const defineCompilerHostReducer = (
  schema: CompilerSchemaBridge,
  params: unknown,
  handler: (ctx: CompilerReducerHostCtx, rawArgs: unknown) => void,
): ModuleExport =>
  defineCompilerReducer(schema, params, (ctx, rawArgs) =>
    handler(ctx as CompilerReducerHostCtx, rawArgs),
  )

export const defineCompilerProcedure = (
  schema: CompilerSchemaBridge,
  params: unknown,
  returnType: unknown,
  handler: (ctx: unknown, rawArgs: unknown) => unknown,
): ModuleExport =>
  schema.procedure(params as never, returnType as never, handler as never)

export const defineCompilerHostProcedure = (
  schema: CompilerSchemaBridge,
  params: unknown,
  returnType: unknown,
  handler: (ctx: CompilerProcedureHostCtx, rawArgs: unknown) => unknown,
): ModuleExport =>
  defineCompilerProcedure(schema, params, returnType, (ctx, rawArgs) =>
    handler(ctx as CompilerProcedureHostCtx, rawArgs),
  )

export const defineCompilerView = (
  schema: CompilerSchemaBridge,
  options: { readonly name: string; readonly public: boolean },
  returnType: unknown,
  handler: (ctx: unknown) => unknown,
): ModuleExport => schema.view(options, returnType as never, handler as never)

export const defineCompilerHostView = (
  schema: CompilerSchemaBridge,
  options: { readonly name: string; readonly public: boolean },
  returnType: unknown,
  handler: (ctx: CompilerSenderViewHostCtx) => unknown,
): ModuleExport =>
  defineCompilerView(schema, options, returnType, (ctx) =>
    handler(ctx as CompilerSenderViewHostCtx),
  )

export const defineCompilerAnonymousView = (
  schema: CompilerSchemaBridge,
  options: { readonly name: string; readonly public: boolean },
  returnType: unknown,
  handler: (ctx: unknown) => unknown,
): ModuleExport =>
  schema.anonymousView(options, returnType as never, handler as never)

export const defineCompilerHostAnonymousView = (
  schema: CompilerSchemaBridge,
  options: { readonly name: string; readonly public: boolean },
  returnType: unknown,
  handler: (ctx: CompilerAnonymousViewHostCtx) => unknown,
): ModuleExport =>
  defineCompilerAnonymousView(schema, options, returnType, (ctx) =>
    handler(ctx as CompilerAnonymousViewHostCtx),
  )

export const defineCompilerHttpHandler = (
  schema: CompilerSchemaBridge,
  handler: (ctx: unknown, req: Request) => SyncResponse,
): ModuleExport => schema.httpHandler(handler as never)

export const defineCompilerHostHttpHandler = (
  schema: CompilerSchemaBridge,
  handler: (ctx: CompilerHttpHandlerHostCtx, req: Request) => SyncResponse,
): ModuleExport =>
  defineCompilerHttpHandler(schema, (ctx, req) =>
    handler(ctx as CompilerHttpHandlerHostCtx, req),
  )

export const defineCompilerHttpRouter = (
  schema: CompilerSchemaBridge,
  router: ServerRouter,
): ModuleExport => schema.httpRouter(router)

export const makeCompilerHttpRouter = (): ServerRouter => new Router()

export const defineCompilerInit = (
  schema: CompilerSchemaBridge,
  handler: (ctx: unknown) => void,
): ModuleExport => schema.init(handler as never)

export const defineCompilerHostInit = (
  schema: CompilerSchemaBridge,
  handler: (ctx: CompilerReducerHostCtx) => void,
): ModuleExport =>
  defineCompilerInit(schema, (ctx) => handler(ctx as CompilerReducerHostCtx))

export const defineCompilerClientConnected = (
  schema: CompilerSchemaBridge,
  handler: (ctx: unknown) => void,
): ModuleExport => schema.clientConnected(handler as never)

export const defineCompilerHostClientConnected = (
  schema: CompilerSchemaBridge,
  handler: (ctx: CompilerReducerHostCtx) => void,
): ModuleExport =>
  defineCompilerClientConnected(schema, (ctx) =>
    handler(ctx as CompilerReducerHostCtx),
  )

export const defineCompilerClientDisconnected = (
  schema: CompilerSchemaBridge,
  handler: (ctx: unknown) => void,
): ModuleExport => schema.clientDisconnected(handler as never)

export const defineCompilerHostClientDisconnected = (
  schema: CompilerSchemaBridge,
  handler: (ctx: CompilerReducerHostCtx) => void,
): ModuleExport =>
  defineCompilerClientDisconnected(schema, (ctx) =>
    handler(ctx as CompilerReducerHostCtx),
  )

export const asCompilerSchemaBridge = (value: unknown): CompilerSchemaBridge =>
  value as CompilerSchemaBridge

export const toCompilerReducerCtx = <Module extends AnyModuleSpec>(
  ctx: CompilerReducerHostCtx,
): ServerReducerCtx<Module> => ctx as unknown as ServerReducerCtx<Module>

export const toCompilerProcedureCtx = <Module extends AnyModuleSpec>(
  ctx: CompilerProcedureHostCtx,
): ServerProcedureCtx<Module> => ctx as unknown as ServerProcedureCtx<Module>

export const toCompilerHttpHandlerCtx = <Module extends AnyModuleSpec>(
  ctx: CompilerHttpHandlerHostCtx,
): ServerHttpHandlerCtx<Module> =>
  ({
    timestamp: ctx.timestamp,
    http: ctx.http,
    databaseIdentity: ctx.identity,
    withTx: ctx.withTx,
    newUuidV4: ctx.newUuidV4,
    newUuidV7: ctx.newUuidV7,
    random: ctx.random,
  }) as unknown as ServerHttpHandlerCtx<Module>

export const toCompilerSenderViewCtx = <Module extends AnyModuleSpec>(
  ctx: CompilerSenderViewHostCtx,
): ServerSenderViewCtx<Module> => ctx as unknown as ServerSenderViewCtx<Module>

export const toCompilerAnonymousViewCtx = <Module extends AnyModuleSpec>(
  ctx: CompilerAnonymousViewHostCtx,
): ServerAnonymousViewCtx<Module> =>
  ctx as unknown as ServerAnonymousViewCtx<Module>

export const invokeCompilerSenderView = <Module extends AnyModuleSpec, Result>(
  view: {
    readonly invoke: unknown
  },
  ctx: CompilerSenderViewHostCtx,
): Result =>
  (
    view.invoke as (
      ctx: ServerSenderViewCtx<Module>,
      args: Record<string, never>,
    ) => Result
  )(toCompilerSenderViewCtx<Module>(ctx), {})

export const invokeCompilerAnonymousView = <
  Module extends AnyModuleSpec,
  Result,
>(
  view: {
    readonly invoke: unknown
  },
  ctx: CompilerAnonymousViewHostCtx,
): Result =>
  (
    view.invoke as (
      ctx: ServerAnonymousViewCtx<Module>,
      args: Record<string, never>,
    ) => Result
  )(toCompilerAnonymousViewCtx<Module>(ctx), {})
