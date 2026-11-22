import type { ModuleExport } from "spacetimedb/server"
import {
  type InternalStdbBuildPlan,
  InternalStdbBuildPlanSymbol as internalStdbBuildPlanSymbol,
} from "../builder/internal-build-plan.ts"
import { procedureResponseType } from "../callable-protocol.ts"
import {
  canonicalNameForPolicy,
  snakeCaseName,
} from "../contract/canonical-name.ts"
import { outboxResultFromHost } from "../contract/outbox-result.ts"
import {
  type AnyRemoteInterfaceBinding,
  isReceiverSpec,
} from "../contract/remote-interface.ts"
import { fieldOptions } from "../contract/field.ts"
import {
  type HttpHandlerMethod,
  HttpRouterExportKey,
} from "../contract/http-handler.ts"
import type { LifecycleName } from "../contract/lifecycle.ts"
import { makeStdbDiagnostic } from "../contract/diagnostic.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import {
  StdbValidationDefect,
  validateServerHandlers,
} from "../contract/module-validation.ts"
import {
  decodeHostValue,
  encodeHostValue,
} from "../contract/type/host-codec.ts"
import * as Type from "../contract/type.ts"
import { addDecodeContext, StdbDecodeError } from "../decode-error.ts"
import {
  compilerOutboxResultType,
  type CompilerReducerOptions,
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
  rejectCompilerViewArguments,
  reportCompilerViewFailure,
  resetCompilerTypeBuilderCaches,
  toCompilerHttpHandlerCtx,
  toCompilerProcedureCtx,
  toCompilerReducerCtx,
  toCompilerTypeBuilder,
} from "./compiler-interop.ts"
import type {
  BoundModule,
  RawHttpHandlerRecord,
  RawLifecycleHandlerRecord,
  RawProcedureHandlerRecord,
  RawReducerHandlerRecord,
  RawViewHandlerRecord,
  ViewKeys,
} from "./handler-types.ts"
import {
  SenderError as CompilerSenderError,
  assertMountSchema,
  isRowTypedQuery,
  schema,
} from "./host-abi-compiler.ts"
import {
  identityKey,
  isDatabaseSender,
  isHostRecord,
  isScheduledRowPayload,
  senderErrorMessage,
} from "./host-abi-runtime.ts"
import { makeCompilerSchema } from "./compiler-schema.ts"
import { mountedQueries, type MountQueries } from "./mount-context.ts"
import { StdbSenderError } from "./services.ts"
import {
  materializeParamsObject,
  materializeTables,
} from "./table-materialize.ts"
import { validateMaterializedTypeNames } from "./type-name-diagnostics.ts"

export type CompiledExports = Record<string, ModuleExport>

export type CompiledModule<Module extends AnyModuleSpec = AnyModuleSpec> = {
  readonly module: BoundModule<Module>["module"]
  readonly scheduleBindings: BoundModule<Module>["scheduleBindings"]
  readonly schema: unknown
  readonly exports: Readonly<CompiledExports>
  readonly exportGroup: () => ModuleExport
}

/** The zero identity: the sender the host runs every settle reducer as. */
const settleSenderIdentityKey = "0".repeat(64)

const decodeOrThrow = <A>(type: Type.AnyValueType, value: unknown): A =>
  decodeHostValue(type, value)

const encodeOrThrow = <A>(type: Type.AnyValueType, value: A): unknown =>
  encodeHostValue(type, value)

const compileViewResult = (
  returns: Type.AnyValueType,
  value: unknown,
): unknown => (isRowTypedQuery(value) ? value : encodeOrThrow(returns, value))

const wrapCallableDecode = <A>(
  key: string,
  phase: StdbDecodeError["phase"],
  op: string,
  run: () => A,
): A => {
  try {
    return run()
  } catch (cause) {
    throw StdbDecodeError.is(cause)
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
  const message = senderErrorMessage(cause)
  return message === undefined ? undefined : new CompilerSenderError(message)
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

export const compileModule = <Module extends AnyModuleSpec, RuntimeR = never>(
  options: InternalStdbBuildPlan<Module, RuntimeR>,
  compileOptions: {
    /** See `BuildOptions.receiverBindings`. */
    readonly receiverBindings?: ReadonlyArray<AnyRemoteInterfaceBinding>
  } = {},
  prefix = "",
  nativeSchemas = new WeakSet<object>(),
): CompiledModule<Module> & { readonly [mountedQueries]: MountQueries } => {
  const server = options[internalStdbBuildPlanSymbol].server
  const entries: Record<string, unknown> = Object.create(null)
  const children: Record<string, MountQueries> = Object.create(null)
  const implementations = options[internalStdbBuildPlanSymbol].mounts
  // The native dispatcher assigns function ids in schema insertion order.
  let reference: object | undefined
  for (const [key, mount] of Object.entries(server.module.mounts ?? {})) {
    const implementation = implementations[key]!
    let library: unknown
    if (implementation.kind === "moduleMount") {
      const child = compileModule(
        implementation.plan,
        compileOptions,
        prefix + mount.wireNamespace + ".",
        nativeSchemas,
      )
      children[key] = child[mountedQueries]
      library = { default: child.schema, ModuleExports: child.exportGroup() }
    } else {
      library = implementation.library
      if (isHostRecord(library) && isHostRecord(library.default)) {
        if (nativeSchemas.has(library.default))
          throw new StdbValidationDefect({
            diagnostics: [
              makeStdbDiagnostic(
                "DuplicateMountedModule",
                ["mounts", key],
                `Native mount "${prefix}${key}" reuses an already mounted Schema. The host accepts repeated schemas, but this package requires one compiled instance per mount. Reuse the existing mount accessor or supply a fresh native schema.`,
              ),
            ],
          })
        nativeSchemas.add(library.default)
      }
    }
    reference ??= schema({})
    assertMountSchema(
      key,
      isHostRecord(library) ? library.default : undefined,
      reference,
    )
    entries[key] =
      mount.wireNamespace ===
      canonicalNameForPolicy(server.module.settings.caseConversionPolicy, key)
        ? library
        : { name: mount.wireNamespace, module: library }
  }
  resetCompilerTypeBuilderCaches()

  const module = server.module
  const typeNameDiagnostics = validateMaterializedTypeNames(module)
  if (typeNameDiagnostics.length > 0) {
    throw new StdbValidationDefect({ diagnostics: typeNameDiagnostics })
  }

  const materializedTables = materializeTables({
    module,
    mountedWireNames: prefix === "" ? undefined : module.wireNames.tables,
    receiverBindings: compileOptions.receiverBindings ?? [],
  })

  const scheduledRowTypeOverrides = new Map<string, unknown>()
  const scheduledRowValueTypes = new Map<string, Type.AnyValueType>()
  // Each scheduled target carries the native table handle that `schema()`
  // registers, which is what upstream's `onSchedule` option resolves against.
  const scheduledTargetTables = new Map<string, unknown>()
  const scheduledTargetBindings = new Map<
    string,
    {
      readonly allowExternalCallers: boolean
    }
  >()
  for (const binding of server.scheduleBindings) {
    const materializedTable = materializedTables[binding.tableKey] as
      | { readonly rowType?: unknown }
      | undefined
    const rowType = materializedTable?.rowType

    if (rowType == null) {
      throw new Error(
        `Scheduled table ${binding.tableKey} did not expose a rowType for ${binding.targetKey}`,
      )
    }

    scheduledRowTypeOverrides.set(binding.targetKey, { data: rowType })
    scheduledTargetTables.set(binding.targetKey, materializedTable)
    const table = module.tables[binding.tableKey]
    if (table != null) {
      scheduledRowValueTypes.set(binding.targetKey, table.row)
    }
    scheduledTargetBindings.set(binding.targetKey, {
      allowExternalCallers: binding.allowExternalCallers,
    })
  }

  // Each settle reducer takes its outbox's native row builder by identity,
  // which is what upstream's `onResult` check compares, and is registered
  // against the outbox table handle `schema()` registers.
  const settleTargetTables = new Map<string, unknown>()
  const settleParamOverrides = new Map<string, unknown>()
  const settleRowValueTypes = new Map<string, Type.AnyValueType>()
  for (const binding of server.plan.outboxResultBindings) {
    const materializedTable = materializedTables[binding.tableKey] as
      | { readonly rowType?: unknown }
      | undefined
    const rowType = materializedTable?.rowType
    if (rowType == null) {
      throw new Error(
        `Outbox table ${binding.tableKey} did not expose a rowType for ${binding.settleKey}`,
      )
    }

    settleTargetTables.set(binding.settleKey, materializedTable)
    settleParamOverrides.set(binding.settleKey, {
      row: rowType,
      result: compilerOutboxResultType(),
    })
    const table = module.tables[binding.tableKey]
    if (table != null) {
      settleRowValueTypes.set(binding.settleKey, table.row)
    }
  }

  const { compiledSchema, queries, viewContext } = makeCompilerSchema(
    module,
    materializedTables,
    entries,
    children,
    prefix,
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
    throw new StdbValidationDefect({ diagnostics: handlerDiagnostics })
  }

  // Compiler boundary: `Handlers` is conditional on each section being
  // populated, which a generic `Module` leaves unresolved.
  const handlers = options.handlers as {
    readonly reducers?: RawReducerHandlerRecord<Module, RuntimeR>
    readonly procedures?: RawProcedureHandlerRecord<Module, RuntimeR>
    readonly httpHandlers?: RawHttpHandlerRecord<Module, RuntimeR>
    readonly views?: RawViewHandlerRecord<Module, RuntimeR>
    readonly lifecycle?: RawLifecycleHandlerRecord<Module, RuntimeR>
  }
  const boundReducers =
    handlers.reducers != null ? server.reducers(handlers.reducers) : undefined
  const boundProcedures =
    handlers.procedures != null
      ? server.procedures(handlers.procedures)
      : undefined
  const boundHttpHandlers =
    handlers.httpHandlers != null
      ? server.httpHandlers(handlers.httpHandlers)
      : undefined
  const boundViews =
    handlers.views != null ? server.views(handlers.views) : undefined
  const boundLifecycle =
    handlers.lifecycle != null
      ? server.lifecycle(handlers.lifecycle)
      : undefined

  const compiledExports: CompiledExports = {}
  const setCompiledExport = (name: string, value: ModuleExport): void => {
    if (Object.hasOwn(compiledExports, name)) {
      throw new Error(`Duplicate compiled export ${name}`)
    }
    compiledExports[name] = value
  }
  const schedulerRefusal = (
    key: string,
    ctx: {
      readonly sender: unknown
      readonly databaseIdentity: unknown
    },
  ): string | undefined => {
    const binding = scheduledTargetBindings.get(key)
    return binding === undefined ||
      binding.allowExternalCallers ||
      isDatabaseSender(ctx)
      ? undefined
      : `Scheduled target ${key} is only invocable by the scheduler`
  }
  // The host runs a settle reducer as the zero identity; anyone else calling
  // it, the owner included, could forge an outcome for a row it did not send.
  const assertSettleInvocation = (
    key: string,
    ctx: { readonly sender: unknown },
  ): void => {
    if (!settleTargetTables.has(key)) {
      return
    }
    if (identityKey(ctx.sender) === settleSenderIdentityKey) {
      return
    }

    throw new CompilerSenderError(
      `Settle reducer ${key} is only invocable by the host settling its outbox`,
    )
  }
  const normalizeScheduledRowPayload = (
    rowType: Type.AnyValueType,
    payload: unknown,
  ): unknown => {
    if (!isHostRecord(payload)) {
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
      const settleRowType = settleRowValueTypes.get(key)
      if (settleRowType != null) {
        const settleArgs = isHostRecord(rawArgs) ? rawArgs : {}
        const row = decodeOrThrow(
          settleRowType,
          normalizeScheduledRowPayload(settleRowType, settleArgs.row),
        )
        const result = outboxResultFromHost(settleArgs.result)
        return { row, result } as A
      }

      const rowType = scheduledRowValueTypes.get(key)
      if (rowType == null) {
        return decodeOrThrow<A>(params, rawArgs)
      }

      // The host path deserializes scheduled args as named values. Scheduled
      // targets accept either the derived wrapper or the scheduled row itself.
      const rowPayload =
        isHostRecord(rawArgs) &&
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
        settleParamOverrides.get(key) ??
        materializeParamsObject(
          `${key}Params`,
          reducer.spec.params,
          {},
          `reducers.${key}.params`,
        )
      const reducerOptions: CompilerReducerOptions = {
        ...(isReceiverSpec(reducer.spec) ? { name: snakeCaseName(key) } : {}),
        ...(scheduledTargetTables.has(key)
          ? { onSchedule: scheduledTargetTables.get(key) }
          : {}),
        ...(settleTargetTables.has(key)
          ? { onResult: settleTargetTables.get(key) }
          : {}),
      }
      const reducerExport = defineCompilerHostReducer(
        compiledSchema,
        params,
        (ctx, rawArgs) => {
          const refusal = schedulerRefusal(key, ctx)
          if (refusal !== undefined) {
            throw new CompilerSenderError(refusal)
          }
          assertSettleInvocation(key, ctx)
          const reducerCtx = toCompilerReducerCtx<Module>(ctx)
          const decodeArgs = (): Type.TypeOf<typeof reducer.spec.params> => {
            try {
              return decodeCallableArgs(
                key,
                reducer.spec.params,
                rawArgs,
                `reducers.${key}.params`,
              )
            } catch (cause) {
              return reducer.rejectArguments(reducerCtx, cause)
            }
          }
          try {
            reducer.invoke(reducerCtx, decodeArgs())
          } catch (cause) {
            throw asCompilerSenderError(cause) ?? cause
          }
        },
        reducerOptions,
      )

      setCompiledExport(callableExportName(key), reducerExport)
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
      const callable = server.plan.procedureCallables[key]
      const returnType = procedureResponseType(callable)
      const compiledProcedure = defineCompilerHostProcedure(
        compiledSchema,
        params,
        toCompilerTypeBuilder(returnType, `procedures.${key}.returns`),
        // No failure of the call may escape this function: the host answers an
        // exception out of a procedure by discarding the isolate, whatever threw
        // it. The SDK serializes what this returns after it has returned, so a
        // `Stdb.custom` whose encoder disagrees with its declared type still
        // throws there. That takes the module author's own mismatch, which no
        // caller can reach and the first test finds, so nothing checks for it.
        (ctx, rawArgs: unknown) => {
          const procedureCtx = toCompilerProcedureCtx<Module>(ctx)
          let args: Type.TypeOf<typeof procedure.spec.params>
          try {
            const refusal = schedulerRefusal(key, ctx)
            if (refusal !== undefined) {
              throw new StdbSenderError({ value: refusal })
            }
            args = decodeCallableArgs(
              key,
              procedure.spec.params,
              rawArgs,
              `procedures.${key}.params`,
            )
          } catch (cause) {
            return encodeOrThrow(
              returnType,
              procedure.rejectArguments(procedureCtx, cause),
            )
          }

          const reply = procedure.invoke(procedureCtx, args)
          try {
            return wrapCallableDecode(
              key,
              "ok",
              `procedures.${key}.returns`,
              () => encodeOrThrow(returnType, reply),
            )
          } catch (cause) {
            return encodeOrThrow(
              returnType,
              procedure.failReply(procedureCtx, cause),
            )
          }
        },
        scheduledTargetTables.get(key),
      )

      setCompiledExport(callableExportName(key), compiledProcedure)
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
      const params = materializeParamsObject(
        `${key}Params`,
        view.spec.params,
        {},
        `views.${key}.params`,
      )
      // A view is never a schedule target, so its arguments always arrive
      // as the host's named params object.
      const decodeArgs = (
        ctx: Parameters<typeof rejectCompilerViewArguments>[1],
        rawArgs: unknown,
      ): Type.TypeOf<typeof view.spec.params> => {
        try {
          return wrapCallableDecode(key, "args", `views.${key}.params`, () =>
            decodeOrThrow<Type.TypeOf<typeof view.spec.params>>(
              view.spec.params,
              rawArgs,
            ),
          )
        } catch (cause) {
          return rejectCompilerViewArguments(view, ctx, cause)
        }
      }
      // A result that does not encode never reached the view's boundary, so it
      // reports here. The view's own failures already have.
      const encodeResult = (
        ctx: Parameters<typeof reportCompilerViewFailure>[1],
        value: unknown,
      ) => {
        try {
          return wrapCallableDecode(key, "ok", `views.${key}.returns`, () =>
            compileViewResult(view.spec.returns, value),
          )
        } catch (cause) {
          reportCompilerViewFailure(view, ctx, cause)
          throw cause
        }
      }

      const compiledView =
        view.spec.context === "sender"
          ? defineCompilerHostView(
              compiledSchema,
              {
                name: exportName,
                public: true,
              },
              params,
              returnType,
              (ctx, rawArgs) => {
                const args = decodeArgs(ctx, rawArgs)
                const value = invokeCompilerSenderView<
                  Module,
                  unknown,
                  unknown
                >(view, viewContext(ctx), args)

                return encodeResult(ctx, value)
              },
            )
          : defineCompilerHostAnonymousView(
              compiledSchema,
              {
                name: exportName,
                public: true,
              },
              params,
              returnType,
              (ctx, rawArgs) => {
                const args = decodeArgs(ctx, rawArgs)
                const value = invokeCompilerAnonymousView<
                  Module,
                  unknown,
                  unknown
                >(view, viewContext(ctx), args)

                return encodeResult(ctx, value)
              },
            )

      setCompiledExport(exportName, compiledView)
    }
  }

  if (boundLifecycle != null) {
    const lifecycleRecord = boundLifecycle as Partial<
      Record<
        LifecycleName,
        (typeof boundLifecycle)[keyof typeof boundLifecycle]
      >
    >

    for (const key of Object.keys(
      lifecycleRecord,
    ) as ReadonlyArray<LifecycleName>) {
      const lifecycle = lifecycleRecord[key]
      if (lifecycle == null) {
        continue
      }

      // A hook's sender failure is the module refusing its caller (a
      // `clientConnected` refusing a connection, an `init` refusing a
      // publish): it must reach the host as the host's own `SenderError`, as a
      // reducer's does, or the host reads it as a fault of the module.
      const invokeLifecycle = (
        ctx: Parameters<typeof toCompilerReducerCtx>[0],
      ) => {
        try {
          lifecycle.invoke(toCompilerReducerCtx<Module>(ctx))
        } catch (cause) {
          throw asCompilerSenderError(cause) ?? cause
        }
      }
      const compiledLifecycle =
        key === "init"
          ? defineCompilerHostInit(compiledSchema, invokeLifecycle)
          : key === "clientConnected"
            ? defineCompilerHostClientConnected(compiledSchema, invokeLifecycle)
            : defineCompilerHostClientDisconnected(
                compiledSchema,
                invokeLifecycle,
              )

      setCompiledExport(key, compiledLifecycle)
    }
  }

  return {
    module,
    scheduleBindings: server.scheduleBindings,
    [mountedQueries]: queries,
    schema: compiledSchema,
    exports: compiledExports,
    exportGroup: () => compiledSchema.exportGroup(compiledExports),
  }
}
