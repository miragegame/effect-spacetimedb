import type { Declarations as EnvironmentDeclarations } from "./environment.ts"
import type { LifecycleSpecs } from "./lifecycle.ts"
import type { HttpHandlerSpec } from "./http-handler.ts"
import type { ProcedureSpec } from "./procedure.ts"
import type { ReducerSpec } from "./reducer.ts"
import type { ModuleSettings } from "./settings.ts"
import type { AnyTableSpec } from "./table.ts"
import type { AnyViewSpec } from "./view.ts"
import { canonicalNameForPolicy, snakeCaseName } from "./canonical-name.ts"
import { StdbValidationError, type StdbDiagnostic } from "./diagnostic.ts"
import { validate } from "./module-validation-public.ts"
import { isReceiverSpec } from "./remote-interface.ts"

export type ModuleWireNames = {
  readonly tables: Record<string, string>
  readonly views: Record<string, string>
  readonly functions: Record<string, string>
}

export type ModuleSpec<
  Tables extends Record<string, AnyTableSpec> = Record<string, AnyTableSpec>,
  Views extends Record<string, AnyViewSpec> = Record<string, AnyViewSpec>,
  Reducers extends Record<string, ReducerSpec> = Record<string, ReducerSpec>,
  Procedures extends Record<string, ProcedureSpec> = Record<
    string,
    ProcedureSpec
  >,
  Lifecycle extends LifecycleSpecs = LifecycleSpecs,
  HttpHandlers extends Record<string, HttpHandlerSpec> = Record<string, never>,
  HttpGroups extends Record<string, string> = Record<string, never>,
  ReducerGroups extends Record<string, string> = Record<string, never>,
  ProcedureGroups extends Record<string, string> = Record<string, never>,
  Environment extends EnvironmentDeclarations = {},
> = {
  readonly kind: "module"
  readonly name: string
  readonly settings: ModuleSettings
  /**
   * Declared database environment keys. Absent means the module declares
   * none; `define` always fills it, so only hand-written specs omit it.
   */
  readonly environment?: Environment | undefined
  readonly tables: Tables
  readonly views: Views
  readonly reducers: Reducers
  readonly procedures: Procedures
  readonly httpHandlers: HttpHandlers
  readonly httpGroups: HttpGroups
  readonly reducerGroups: ReducerGroups
  readonly procedureGroups: ProcedureGroups
  readonly lifecycle: Lifecycle
  readonly wireNames: ModuleWireNames
  readonly diagnostics: ReadonlyArray<StdbDiagnostic>
}

export type AnyModuleSpec = ModuleSpec<
  Record<string, AnyTableSpec>,
  Record<string, AnyViewSpec>,
  Record<string, ReducerSpec>,
  Record<string, ProcedureSpec>,
  LifecycleSpecs,
  Record<string, HttpHandlerSpec>,
  Record<string, string>,
  Record<string, string>,
  Record<string, string>,
  EnvironmentDeclarations
>

type TablesOf<Tables> = Tables extends Record<string, AnyTableSpec>
  ? Tables
  : Record<string, never>

type ViewsOf<Views> = Views extends Record<string, AnyViewSpec>
  ? Views
  : Record<string, never>

type ReducersOf<Reducers> = Reducers extends Record<string, ReducerSpec>
  ? Reducers
  : Record<string, never>

type ProceduresOf<Procedures> = Procedures extends Record<string, ProcedureSpec>
  ? Procedures
  : Record<string, never>

type HttpHandlersOf<HttpHandlers> = HttpHandlers extends Record<
  string,
  HttpHandlerSpec
>
  ? HttpHandlers
  : Record<string, never>

type LifecycleOf<Lifecycle> = Lifecycle extends LifecycleSpecs ? Lifecycle : {}

type EnvironmentOf<Environment> = Environment extends EnvironmentDeclarations
  ? Environment
  : {}

type HttpGroupsOf<HttpGroups> = HttpGroups extends Record<string, string>
  ? HttpGroups
  : Record<string, never>

type ReducerGroupsOf<ReducerGroups> = ReducerGroups extends Record<
  string,
  string
>
  ? ReducerGroups
  : Record<string, never>

type ProcedureGroupsOf<ProcedureGroups> = ProcedureGroups extends Record<
  string,
  string
>
  ? ProcedureGroups
  : Record<string, never>

const wireNameRecord = (
  policy: ModuleSettings["caseConversionPolicy"],
  names: ReadonlyArray<string>,
): Record<string, string> =>
  Object.fromEntries(
    names.map((name) => [name, canonicalNameForPolicy(policy, name)] as const),
  )

export const computeWireNames = (options: {
  readonly settings: ModuleSettings
  readonly tables: Record<string, AnyTableSpec>
  readonly views: Record<string, AnyViewSpec>
  readonly reducers: Record<string, ReducerSpec>
  readonly procedures: Record<string, ProcedureSpec>
  readonly httpHandlers: Record<string, HttpHandlerSpec>
}): ModuleWireNames => {
  const policy = options.settings.caseConversionPolicy
  // A receiver is called by the name in its caller's generated binding, so its
  // wire name is the snake_case of its key under every policy.
  const receiverKeys = Object.entries(options.reducers)
    .filter(([, spec]) => isReceiverSpec(spec))
    .map(([key]) => key)
  return {
    tables: wireNameRecord(
      policy,
      Object.values(options.tables).map((table) => table.name),
    ),
    views: wireNameRecord(policy, Object.keys(options.views)),
    functions: {
      ...wireNameRecord(policy, [
        ...Object.keys(options.reducers),
        ...Object.keys(options.procedures),
        ...Object.keys(options.httpHandlers),
      ]),
      ...Object.fromEntries(
        receiverKeys.map((key) => [key, snakeCaseName(key)] as const),
      ),
    },
  }
}

export const define = <
  const Tables extends Record<string, AnyTableSpec> | undefined = undefined,
  const Views extends Record<string, AnyViewSpec> | undefined = undefined,
  const Reducers extends Record<string, ReducerSpec> | undefined = undefined,
  const Procedures extends
    | Record<string, ProcedureSpec>
    | undefined = undefined,
  const Lifecycle extends LifecycleSpecs | undefined = undefined,
  const HttpHandlers extends
    | Record<string, HttpHandlerSpec>
    | undefined = undefined,
  const HttpGroups extends Record<string, string> | undefined = undefined,
  const ReducerGroups extends Record<string, string> | undefined = undefined,
  const ProcedureGroups extends Record<string, string> | undefined = undefined,
  const Environment extends EnvironmentDeclarations | undefined = undefined,
>(options: {
  readonly name: string
  readonly settings?: ModuleSettings
  readonly environment?: Environment | undefined
  readonly tables?: Tables
  readonly views?: Views
  readonly reducers?: Reducers
  readonly procedures?: Procedures
  readonly httpHandlers?: HttpHandlers
  readonly httpGroups?: HttpGroups
  readonly reducerGroups?: ReducerGroups
  readonly procedureGroups?: ProcedureGroups
  readonly lifecycle?: Lifecycle
  readonly errors?: never
}): ModuleSpec<
  TablesOf<Tables>,
  ViewsOf<Views>,
  ReducersOf<Reducers>,
  ProceduresOf<Procedures>,
  LifecycleOf<Lifecycle>,
  HttpHandlersOf<HttpHandlers>,
  HttpGroupsOf<HttpGroups>,
  ReducerGroupsOf<ReducerGroups>,
  ProcedureGroupsOf<ProcedureGroups>,
  EnvironmentOf<Environment>
> => {
  const module = {
    kind: "module" as const,
    name: options.name,
    settings: options.settings ?? {},
    environment: (options.environment ?? {}) as EnvironmentOf<Environment>,
    tables: (options.tables ?? {}) as TablesOf<Tables>,
    views: (options.views ?? {}) as ViewsOf<Views>,
    reducers: (options.reducers ?? {}) as ReducersOf<Reducers>,
    procedures: (options.procedures ?? {}) as ProceduresOf<Procedures>,
    httpHandlers: (options.httpHandlers ?? {}) as HttpHandlersOf<HttpHandlers>,
    httpGroups: (options.httpGroups ?? {}) as HttpGroupsOf<HttpGroups>,
    reducerGroups: (options.reducerGroups ??
      {}) as ReducerGroupsOf<ReducerGroups>,
    procedureGroups: (options.procedureGroups ??
      {}) as ProcedureGroupsOf<ProcedureGroups>,
    lifecycle: (options.lifecycle ?? {}) as LifecycleOf<Lifecycle>,
  }

  const definedModule = {
    ...module,
    wireNames: computeWireNames(module),
    diagnostics: [] as ReadonlyArray<StdbDiagnostic>,
  }

  const diagnostics = validate(definedModule)
  const errors = diagnostics.filter((entry) => entry.severity === "error")
  if (errors.length > 0) {
    throw new StdbValidationError({ diagnostics: errors })
  }

  return { ...definedModule, diagnostics }
}
