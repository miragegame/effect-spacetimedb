import type {
  ModuleExport,
  CaseConversionPolicy as ServerCaseConversionPolicy,
} from "spacetimedb/server"
import {
  type InternalStdbBuildPlan,
  InternalStdbBuildPlanSymbol as internalStdbBuildPlanSymbol,
} from "../builder/internal-build-plan.ts"
import { procedureResponseType } from "../callable-protocol.ts"
import { snakeCaseName } from "../contract/canonical-name.ts"
import { outboxResultFromHost } from "../contract/outbox-result.ts"
import {
  type AnyRemoteInterfaceBinding,
  isReceiverSpec,
} from "../contract/remote-interface.ts"
import type {
  Declaration as EnvironmentDeclaration,
  LiteralValues,
} from "../contract/environment.ts"
import { fieldOptions } from "../contract/field.ts"
import {
  type HttpHandlerMethod,
  HttpRouterExportKey,
} from "../contract/http-handler.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import {
  StdbValidationError,
  validateServerHandlers,
} from "../contract/module-validation.ts"
import {
  decodeHostValue,
  encodeHostValue,
} from "../contract/type/host-codec.ts"
import * as Type from "../contract/type.ts"
import { addDecodeContext, StdbDecodeError } from "../decode-error.ts"
import type { LifecycleKeys, ServerInstance } from "./bind.ts"
import {
  asCompilerSchemaBridge,
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
  resetCompilerTypeBuilderCaches,
  toCompilerHttpHandlerCtx,
  toCompilerProcedureCtx,
  toCompilerReducerCtx,
  toCompilerTypeBuilder,
} from "./compiler-interop.ts"
import {
  assertOwnedHandlerBundle,
  ServerOwnerSymbol,
} from "./handler-ownership.ts"
import type { ViewKeys } from "./handler-types.ts"
import {
  CaseConversionPolicy,
  SenderError as CompilerSenderError,
  isRowTypedQuery,
  schema,
  t,
} from "./host-abi-compiler.ts"
import {
  identityKey,
  isHostRecord,
  isScheduledRowPayload,
  senderErrorMessage,
} from "./host-abi-runtime.ts"
import {
  materializeParamsObject,
  materializeTables,
} from "./table-materialize.ts"
import { validateMaterializedTypeNames } from "./type-name-diagnostics.ts"

type CompiledExports = Record<string, ModuleExport>

export type CompiledModule<Module extends AnyModuleSpec = AnyModuleSpec> = {
  readonly module: ServerInstance<Module>["module"]
  readonly scheduleBindings: ServerInstance<Module>["scheduleBindings"]
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

// The SATS unit payload every allowed literal value carries.
const environmentLiteralPayload = {
  tag: "Product",
  value: { elements: [] },
} as const

/**
 * The SDK reads an environment literal set from a payload-free sum's
 * `algebraicType` and only checks that a `variants` member exists. `t.enum`
 * builds the same type but also installs every allowed value as a property of
 * its builder, which breaks on values such as `create`, `optional` or
 * `__proto__`. This constraint carries the type and nothing else.
 */
const environmentLiteralConstraint = (values: LiteralValues) => ({
  algebraicType: {
    tag: "Sum",
    value: {
      variants: values.map((name) => ({
        name,
        algebraicType: environmentLiteralPayload,
      })),
    },
  },
  variants: {},
})

const toCompilerEnvironmentBuilder = (
  declaration: EnvironmentDeclaration,
): unknown => {
  // Secrets are plain strings to the host; redaction applies when module code
  // reads them.
  const inner =
    declaration.kind === "literal"
      ? environmentLiteralConstraint(declaration.values)
      : t.string()
  // `t.option` reads only the inner type's `algebraicType`.
  return declaration.optional ? t.option(inner as never) : inner
}

/** Declaration metadata only: no environment value is part of the artifact. */
const toCompilerEnvironment = (
  environment: AnyModuleSpec["environment"],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(environment ?? {}).map(([key, declaration]) => [
      key,
      toCompilerEnvironmentBuilder(declaration),
    ]),
  )

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
): CompiledModule<Module> => {
  const server = options[internalStdbBuildPlanSymbol].server
  assertOwnedHandlerBundle(server[ServerOwnerSymbol], options.handlers)
  resetCompilerTypeBuilderCaches()

  const module = server.module
  const typeNameDiagnostics = validateMaterializedTypeNames(module)
  if (typeNameDiagnostics.length > 0) {
    throw new StdbValidationError({ diagnostics: typeNameDiagnostics })
  }

  const materializedTables = materializeTables({
    module,
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

  const compiledSchema = asCompilerSchemaBridge(
    schema(materializedTables as never, {
      CASE_CONVERSION_POLICY: toCaseConversionPolicy(
        module.settings.caseConversionPolicy,
      ),
      // Compiler boundary: literal constraints are structural SDK types, not
      // builder instances (see `environmentLiteralConstraint`).
      env: toCompilerEnvironment(module.environment) as never,
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
      ? server.reducers(options.handlers.reducers)
      : undefined
  const boundProcedures =
    options.handlers.procedures != null
      ? server.procedures(options.handlers.procedures)
      : undefined
  const boundHttpHandlers =
    options.handlers.httpHandlers != null
      ? server.httpHandlers(options.handlers.httpHandlers)
      : undefined
  const boundViews =
    options.handlers.views != null
      ? server.views(options.handlers.views)
      : undefined
  const boundLifecycle =
    options.handlers.lifecycle != null
      ? server.lifecycle(options.handlers.lifecycle)
      : undefined

  const compiledExports: CompiledExports = {}
  const setCompiledExport = (name: string, value: ModuleExport): void => {
    if (Object.hasOwn(compiledExports, name)) {
      throw new Error(`Duplicate compiled export ${name}`)
    }
    compiledExports[name] = value
  }
  const assertSchedulerInvocation = (
    key: string,
    ctx: {
      readonly sender: unknown
      readonly databaseIdentity: unknown
    },
  ): void => {
    const binding = scheduledTargetBindings.get(key)
    if (binding === undefined || binding.allowExternalCallers) {
      return
    }

    const senderKey = identityKey(ctx.sender)
    const databaseIdentityKey = identityKey(ctx.databaseIdentity)
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
          assertSchedulerInvocation(key, ctx)
          assertSettleInvocation(key, ctx)
          const args = decodeCallableArgs<
            Type.TypeOf<typeof reducer.spec.params>
          >(key, reducer.spec.params, rawArgs, `reducers.${key}.params`)
          try {
            reducer.invoke(toCompilerReducerCtx<Module>(ctx), args)
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
      const decodeArgs = (rawArgs: unknown) =>
        wrapCallableDecode(key, "args", `views.${key}.params`, () =>
          decodeOrThrow<Type.TypeOf<typeof view.spec.params>>(
            view.spec.params,
            rawArgs,
          ),
        )

      const compiledView =
        view.spec.context === "sender"
          ? defineCompilerHostView(
              compiledSchema,
              {
                name: exportName,
                public: view.spec.public,
              },
              params,
              returnType,
              (ctx, rawArgs) => {
                const value = invokeCompilerSenderView<
                  Module,
                  unknown,
                  unknown
                >(view, ctx, decodeArgs(rawArgs))

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
              params,
              returnType,
              (ctx, rawArgs) => {
                const value = invokeCompilerAnonymousView<
                  Module,
                  unknown,
                  unknown
                >(view, ctx, decodeArgs(rawArgs))

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
    schema: compiledSchema,
    exports: compiledExports,
    exportGroup: () => compiledSchema.exportGroup(compiledExports),
  }
}
