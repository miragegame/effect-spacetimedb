// lint-ignore: unused-files - used through the package server-compiler export map entrypoint.
// lint-ignore: prefer-match-for-literal-union-branching,use-exhaustive-discriminant-chain - current branch logic stays local and exhaustive refactor is outside the restack fix.
import * as RootSpacetimeDB from "spacetimedb"
import * as SpacetimeServer from "spacetimedb/server"
import { procedureResponseType } from "../callable-protocol.ts"
import { addDecodeContext, StdbDecodeError } from "../decode-error.ts"
import { fieldOptions } from "../contract/field.ts"
import { snakeCaseName } from "../contract/canonical-name.ts"
import {
  HttpRouterExportKey,
  type HttpHandlerMethod,
} from "../contract/http-handler.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import {
  StdbValidationError,
  validateServerHandlers,
} from "../contract/module-validation.ts"
import * as Type from "../contract/type.ts"
import { buildQueryRelation, isQueryRelation } from "../query/types.ts"
import type { Handlers, LifecycleKeys, ServerInstance } from "./bind.ts"
import {
  materializeParamsObject,
  materializeTables,
} from "./table-materialize.ts"
import {
  asCompilerSchemaBridge,
  defineCompilerHostAnonymousView,
  defineCompilerHostClientConnected,
  defineCompilerHostClientDisconnected,
  defineCompilerHostHttpHandler,
  defineCompilerHostInit,
  defineCompilerHostProcedure,
  defineCompilerHostReducer,
  defineCompilerHostView,
  defineCompilerHttpRouter,
  invokeCompilerAnonymousView,
  invokeCompilerSenderView,
  makeCompilerHttpRouter,
  toCompilerHttpHandlerCtx,
  toCompilerProcedureCtx,
  toCompilerReducerCtx,
  toCompilerTypeBuilder,
} from "./compiler-interop.ts"
import {
  assertOwnedHandlerBundle,
  ServerOwnerSymbol,
} from "./handler-ownership.ts"
import {
  decodeHostValue,
  encodeHostValue,
} from "../contract/type/host-codec.ts"
import type {
  CaseConversionPolicy as ServerCaseConversionPolicy,
  isRowTypedQuery as ServerIsRowTypedQuery,
  ModuleExport,
  schema as ServerSchemaFn,
} from "spacetimedb/server"
import type { ViewKeys } from "./handler-types.ts"

const {
  isRowTypedQuery,
  SenderError: CompilerSenderError,
  CaseConversionPolicy,
  schema,
} = SpacetimeServer as unknown as {
  readonly isRowTypedQuery: typeof ServerIsRowTypedQuery
  readonly SenderError: new (message: string) => Error
  readonly CaseConversionPolicy: {
    readonly SnakeCase: ServerCaseConversionPolicy
    readonly None: ServerCaseConversionPolicy
  }
  readonly schema: typeof ServerSchemaFn
}

type CompiledExports = Record<string, ModuleExport>

export type CompiledModule<Module extends AnyModuleSpec = AnyModuleSpec> = {
  readonly module: ServerInstance<Module>["module"]
  readonly scheduleBindings: ServerInstance<Module>["scheduleBindings"]
  readonly schema: unknown
  readonly exports: Readonly<CompiledExports>
  readonly exportGroup: () => ModuleExport
}

const decodeOrThrow = <A>(type: Type.AnyValueType, value: unknown): A =>
  decodeHostValue(type, value)

const encodeOrThrow = <A>(type: Type.AnyValueType, value: A): unknown =>
  encodeHostValue(type, value)

const isCompilerRawRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isScheduledRowPayload = (value: unknown): boolean =>
  isCompilerRawRecord(value) &&
  (Object.hasOwn(value, "scheduledId") ||
    Object.hasOwn(value, "scheduledAt") ||
    Object.hasOwn(value, "scheduled_id") ||
    Object.hasOwn(value, "scheduled_at"))

const compileViewResult = (
  returns: Type.AnyValueType,
  value: unknown,
): unknown =>
  isRowTypedQuery(value)
    ? value
    : isQueryRelation(value)
      ? buildQueryRelation(value)
      : encodeOrThrow(returns, value)

const wrapCallableDecode = <A>(
  key: string,
  phase: StdbDecodeError["phase"],
  op: string,
  run: () => A,
): A => {
  try {
    return run()
  } catch (cause) {
    throw cause instanceof StdbDecodeError
      ? addDecodeContext(cause, { callable: key, op })
      : new StdbDecodeError({
          phase,
          cause,
          callable: key,
          op,
        })
  }
}

const asCompilerSenderError = (cause: unknown): Error | undefined => {
  if (cause instanceof RootSpacetimeDB.SenderError) {
    return new CompilerSenderError(cause.message)
  }

  if (cause instanceof Error && cause.name === "SenderError") {
    return new CompilerSenderError(cause.message)
  }

  return undefined
}

const toCaseConversionPolicy = (
  policy: AnyModuleSpec["settings"]["caseConversionPolicy"],
): ServerCaseConversionPolicy => {
  switch (policy) {
    case undefined:
    case "snake_case":
      return CaseConversionPolicy.SnakeCase
    case "none":
      return CaseConversionPolicy.None
  }
}

const addHttpRoute = (
  router: ReturnType<typeof makeCompilerHttpRouter>,
  method: HttpHandlerMethod,
  path: string,
  handler: ModuleExport,
): ReturnType<typeof makeCompilerHttpRouter> => {
  const httpHandler = handler as never
  switch (method) {
    case "get":
      return router.get(path, httpHandler)
    case "post":
      return router.post(path, httpHandler)
    case "put":
      return router.put(path, httpHandler)
    case "delete":
      return router.delete(path, httpHandler)
    case "patch":
      return router.patch(path, httpHandler)
    case "head":
      return router.head(path, httpHandler)
    case "options":
      return router.options(path, httpHandler)
    case "any":
      return router.any(path, httpHandler)
  }
}

export const compileModule = <
  Module extends AnyModuleSpec,
  RuntimeR = never,
>(options: {
  readonly server: ServerInstance<Module, RuntimeR>
  readonly handlers: Handlers<Module, RuntimeR>
}): CompiledModule<Module> => {
  assertOwnedHandlerBundle(options.server[ServerOwnerSymbol], options.handlers)

  const module = options.server.module
  const scheduledTargets = new Map<string, ModuleExport>()

  const materializedTables = materializeTables({
    module,
    scheduleBindings: options.server.scheduleBindings,
    resolveScheduledTarget: (targetKey) => {
      const target = scheduledTargets.get(targetKey)
      if (target == null) {
        throw new Error(`Scheduled target ${targetKey} was not registered`)
      }
      return target
    },
  })

  const scheduledRowTypeOverrides = new Map<string, unknown>()
  const scheduledRowValueTypes = new Map<string, Type.AnyValueType>()
  const scheduledTargetBindings = new Map<
    string,
    {
      readonly allowExternalCallers: boolean
    }
  >()
  for (const binding of options.server.scheduleBindings) {
    const rowType = (
      materializedTables[binding.tableKey] as {
        readonly rowType?: unknown
      }
    ).rowType

    if (rowType == null) {
      throw new Error(
        `Scheduled table ${binding.tableKey} did not expose a rowType for ${binding.targetKey}`,
      )
    }

    scheduledRowTypeOverrides.set(binding.targetKey, { data: rowType })
    const table = module.tables[binding.tableKey]
    if (table != null) {
      scheduledRowValueTypes.set(binding.targetKey, table.row)
    }
    scheduledTargetBindings.set(binding.targetKey, {
      allowExternalCallers: binding.allowExternalCallers,
    })
  }

  const compiledSchema = asCompilerSchemaBridge(
    schema(materializedTables as never, {
      CASE_CONVERSION_POLICY: toCaseConversionPolicy(
        module.settings.caseConversionPolicy,
      ),
    }),
  )

  const reducerHandlers = (options.handlers.reducers ?? {}) as Record<
    string,
    unknown
  >
  const procedureHandlers = (options.handlers.procedures ?? {}) as Record<
    string,
    unknown
  >
  const httpHandlers = (options.handlers.httpHandlers ?? {}) as Record<
    string,
    unknown
  >
  const viewHandlers = (options.handlers.views ?? {}) as Record<string, unknown>
  const lifecycleHandlers = (options.handlers.lifecycle ?? {}) as Record<
    string,
    unknown
  >

  const handlerDiagnostics = validateServerHandlers(module, {
    reducers: reducerHandlers,
    procedures: procedureHandlers,
    httpHandlers,
    views: viewHandlers,
    lifecycle: lifecycleHandlers,
  })
  if (handlerDiagnostics.length > 0) {
    throw new StdbValidationError({ diagnostics: handlerDiagnostics })
  }

  const boundReducers =
    options.handlers.reducers != null
      ? options.server.reducers(options.handlers.reducers)
      : undefined
  const boundProcedures =
    options.handlers.procedures != null
      ? options.server.procedures(options.handlers.procedures)
      : undefined
  const boundHttpHandlers =
    options.handlers.httpHandlers != null
      ? options.server.httpHandlers(options.handlers.httpHandlers)
      : undefined
  const boundViews =
    options.handlers.views != null
      ? options.server.views(options.handlers.views)
      : undefined
  const boundLifecycle =
    options.handlers.lifecycle != null
      ? options.server.lifecycle(options.handlers.lifecycle)
      : undefined

  const compiledExports: CompiledExports = {}
  const setCompiledExport = (name: string, value: ModuleExport): void => {
    if (Object.hasOwn(compiledExports, name)) {
      throw new Error(`Duplicate compiled export ${name}`)
    }
    compiledExports[name] = value
  }
  const identityKey = (value: unknown): string | undefined => {
    if (typeof value === "string" || typeof value === "bigint") {
      return String(value)
    }

    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { readonly toHexString?: unknown }).toHexString ===
        "function"
    ) {
      const hexString = (
        value as { readonly toHexString: () => unknown }
      ).toHexString()
      return typeof hexString === "string" ? hexString : undefined
    }

    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { readonly __identity__?: unknown }).__identity__ ===
        "bigint"
    ) {
      return String((value as { readonly __identity__: bigint }).__identity__)
    }

    return undefined
  }
  const assertSchedulerInvocation = (
    key: string,
    ctx: {
      readonly sender: unknown
      readonly identity: unknown
      readonly connectionId?: unknown
    },
  ): void => {
    const binding = scheduledTargetBindings.get(key)
    if (binding === undefined || binding.allowExternalCallers) {
      return
    }

    if (ctx.connectionId === null) {
      return
    }

    const databaseIdentity =
      (ctx as { readonly databaseIdentity?: unknown }).databaseIdentity ??
      ctx.identity
    const senderKey = identityKey(ctx.sender)
    const databaseIdentityKey = identityKey(databaseIdentity)
    if (
      senderKey !== undefined &&
      databaseIdentityKey !== undefined &&
      senderKey === databaseIdentityKey
    ) {
      return
    }

    throw new CompilerSenderError(
      `Scheduled target ${key} is only invocable by the scheduler`,
    )
  }
  const normalizeScheduledRowPayload = (
    rowType: Type.AnyValueType,
    payload: unknown,
  ): unknown => {
    if (!isCompilerRawRecord(payload)) {
      return payload
    }

    const fields = Type.structFields(rowType)
    if (fields == null) {
      return payload
    }

    let normalized: Record<string, unknown> | undefined
    for (const [fieldName, field] of Object.entries(fields)) {
      if (Object.hasOwn(payload, fieldName)) {
        continue
      }

      const wireName =
        fieldOptions(field).name ??
        (module.settings.caseConversionPolicy === "none"
          ? fieldName
          : snakeCaseName(fieldName))
      if (wireName === fieldName || !Object.hasOwn(payload, wireName)) {
        continue
      }

      normalized ??= { ...payload }
      normalized[fieldName] = payload[wireName]
    }

    return normalized ?? payload
  }
  const decodeCallableArgs = <A>(
    key: string,
    params: Type.AnyValueType,
    rawArgs: unknown,
    op: string,
  ): A =>
    wrapCallableDecode(key, "args", op, () => {
      const rowType = scheduledRowValueTypes.get(key)
      if (rowType == null) {
        return decodeOrThrow<A>(params, rawArgs)
      }

      // The host path deserializes scheduled args as named values. Scheduled
      // targets accept either the derived wrapper or the scheduled row itself.
      const rowPayload =
        isCompilerRawRecord(rawArgs) &&
        Object.hasOwn(rawArgs, "data") &&
        !isScheduledRowPayload(rawArgs)
          ? rawArgs.data
          : rawArgs
      const data = decodeOrThrow(
        rowType,
        normalizeScheduledRowPayload(rowType, rowPayload),
      )
      return { data } as A
    })
  const callableExportName = (key: string): string =>
    module.wireNames.functions[key] ?? key
  const viewExportName = (key: ViewKeys<Module>): string =>
    module.wireNames.views[key] ?? key

  if (boundReducers != null) {
    for (const key of Object.keys(boundReducers) as unknown as ReadonlyArray<
      keyof typeof boundReducers & string
    >) {
      const reducer = boundReducers[key]

      const params =
        scheduledRowTypeOverrides.get(key) ??
        materializeParamsObject(
          `${key}Params`,
          reducer.spec.params,
          {},
          `reducers.${key}.params`,
        )
      const reducerExport = defineCompilerHostReducer(
        compiledSchema,
        params,
        (ctx, rawArgs) => {
          assertSchedulerInvocation(key, ctx)
          const args = decodeCallableArgs<
            Type.TypeOf<typeof reducer.spec.params>
          >(key, reducer.spec.params, rawArgs, `reducers.${key}.params`)
          try {
            reducer.invoke(toCompilerReducerCtx<Module>(ctx), args)
          } catch (cause) {
            throw asCompilerSenderError(cause) ?? cause
          }
        },
      )

      setCompiledExport(callableExportName(key), reducerExport)
      scheduledTargets.set(key, reducerExport)
    }
  }

  if (boundProcedures != null) {
    for (const key of Object.keys(boundProcedures) as unknown as ReadonlyArray<
      keyof typeof boundProcedures & string
    >) {
      const procedure = boundProcedures[key]

      const params =
        scheduledRowTypeOverrides.get(key) ??
        materializeParamsObject(
          `${key}Params`,
          procedure.spec.params,
          {},
          `procedures.${key}.params`,
        )
      const callable = options.server.plan.procedureCallables[key]
      const returnType = procedureResponseType(callable)
      const compiledProcedure = defineCompilerHostProcedure(
        compiledSchema,
        params,
        toCompilerTypeBuilder(returnType, `procedures.${key}.returns`),
        (ctx, rawArgs: unknown) => {
          assertSchedulerInvocation(key, ctx)
          const args = decodeCallableArgs<
            Type.TypeOf<typeof procedure.spec.params>
          >(key, procedure.spec.params, rawArgs, `procedures.${key}.params`)
          const value = procedure.invoke(
            toCompilerProcedureCtx<Module>(ctx),
            args,
          )
          return wrapCallableDecode(
            key,
            "ok",
            `procedures.${key}.returns`,
            () => encodeOrThrow(returnType, value),
          )
        },
      )

      setCompiledExport(callableExportName(key), compiledProcedure)
      scheduledTargets.set(key, compiledProcedure)
    }
  }

  if (boundHttpHandlers != null) {
    let router = makeCompilerHttpRouter()

    for (const key of Object.keys(
      boundHttpHandlers,
    ) as unknown as ReadonlyArray<keyof typeof boundHttpHandlers & string>) {
      const httpHandler = boundHttpHandlers[key]

      const compiledHttpHandler = defineCompilerHostHttpHandler(
        compiledSchema,
        (ctx, req) =>
          httpHandler.invoke(
            toCompilerHttpHandlerCtx<Module>(ctx),
            req as never,
          ) as never,
      )

      setCompiledExport(callableExportName(key), compiledHttpHandler)
      router = addHttpRoute(
        router,
        httpHandler.spec.method,
        httpHandler.spec.path,
        compiledHttpHandler,
      )
    }

    setCompiledExport(
      HttpRouterExportKey,
      defineCompilerHttpRouter(compiledSchema, router),
    )
  }

  if (boundViews != null) {
    for (const key of Object.keys(boundViews) as unknown as ReadonlyArray<
      keyof typeof boundViews & string
    >) {
      const view = boundViews[key]

      const returnType = toCompilerTypeBuilder(
        view.spec.returns,
        `views.${key}.returns`,
      )
      const exportName = viewExportName(key)

      const compiledView =
        view.spec.context === "sender"
          ? defineCompilerHostView(
              compiledSchema,
              {
                name: exportName,
                public: view.spec.public,
              },
              returnType,
              (ctx) => {
                const value = invokeCompilerSenderView<Module, unknown>(
                  view,
                  ctx,
                )

                return wrapCallableDecode(
                  key,
                  "ok",
                  `views.${key}.returns`,
                  () => compileViewResult(view.spec.returns, value),
                )
              },
            )
          : defineCompilerHostAnonymousView(
              compiledSchema,
              {
                name: exportName,
                public: view.spec.public,
              },
              returnType,
              (ctx) => {
                const value = invokeCompilerAnonymousView<Module, unknown>(
                  view,
                  ctx,
                )

                return wrapCallableDecode(
                  key,
                  "ok",
                  `views.${key}.returns`,
                  () => compileViewResult(view.spec.returns, value),
                )
              },
            )

      setCompiledExport(exportName, compiledView)
    }
  }

  if (boundLifecycle != null) {
    const lifecycleRecord = boundLifecycle as Partial<
      Record<
        LifecycleKeys,
        (typeof boundLifecycle)[keyof typeof boundLifecycle]
      >
    >

    for (const key of Object.keys(
      lifecycleRecord,
    ) as ReadonlyArray<LifecycleKeys>) {
      const lifecycle = lifecycleRecord[key]
      if (lifecycle == null) {
        continue
      }

      const compiledLifecycle =
        key === "init"
          ? defineCompilerHostInit(compiledSchema, (ctx) => {
              lifecycle.invoke(toCompilerReducerCtx<Module>(ctx))
            })
          : key === "clientConnected"
            ? defineCompilerHostClientConnected(compiledSchema, (ctx) => {
                lifecycle.invoke(toCompilerReducerCtx<Module>(ctx))
              })
            : defineCompilerHostClientDisconnected(compiledSchema, (ctx) => {
                lifecycle.invoke(toCompilerReducerCtx<Module>(ctx))
              })

      setCompiledExport(key, compiledLifecycle)
    }
  }

  return {
    module,
    scheduleBindings: options.server.scheduleBindings,
    schema: compiledSchema,
    exports: compiledExports,
    exportGroup: () => compiledSchema.exportGroup(compiledExports),
  }
}
