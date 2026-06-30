import type * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

type ModuleFromSectionsOptions<
  Tables extends Record<string, Stdb.AnyTableSpec> | undefined,
  Views extends Record<string, Stdb.AnyViewSpec> | undefined,
  Reducers extends Record<string, Stdb.ReducerSpec> | undefined,
  Procedures extends Record<string, Stdb.ProcedureSpec> | undefined,
  Lifecycle extends Stdb.LifecycleSpecs | undefined,
  HttpHandlers extends Record<string, Stdb.HttpHandlerSpec> | undefined,
> = {
  readonly name: string
  readonly settings?: Stdb.ModuleSettings
  readonly tables?: Tables
  readonly views?: Views
  readonly reducers?: Reducers
  readonly procedures?: Procedures
  readonly httpHandlers?: HttpHandlers
  readonly lifecycle?: Lifecycle
}

type RecordOrEmpty<T, Constraint> = T extends Constraint
  ? T
  : Record<string, never>
type LifecycleOrEmpty<T> = T extends Stdb.LifecycleSpecs ? T : {}

type HttpGroupsFor<HttpHandlers> = {
  readonly [Key in keyof RecordOrEmpty<
    HttpHandlers,
    Record<string, Stdb.HttpHandlerSpec>
  > &
    string]: "Http"
}

type ModuleFromSectionsSpec<
  Tables extends Record<string, Stdb.AnyTableSpec> | undefined,
  Views extends Record<string, Stdb.AnyViewSpec> | undefined,
  Reducers extends Record<string, Stdb.ReducerSpec> | undefined,
  Procedures extends Record<string, Stdb.ProcedureSpec> | undefined,
  Lifecycle extends Stdb.LifecycleSpecs | undefined,
  HttpHandlers extends Record<string, Stdb.HttpHandlerSpec> | undefined,
> = Stdb.ModuleSpec<
  RecordOrEmpty<Tables, Record<string, Stdb.AnyTableSpec>>,
  RecordOrEmpty<Views, Record<string, Stdb.AnyViewSpec>>,
  RecordOrEmpty<Reducers, Record<string, Stdb.ReducerSpec>>,
  RecordOrEmpty<Procedures, Record<string, Stdb.ProcedureSpec>>,
  LifecycleOrEmpty<Lifecycle>,
  RecordOrEmpty<HttpHandlers, Record<string, Stdb.HttpHandlerSpec>>,
  HttpGroupsFor<HttpHandlers>
>

const EmptyParams = Stdb.struct({})

type ReducerOptions = {
  readonly public?: boolean
  readonly params?: Stdb.StructLikeValueType
  readonly errors?: Stdb.AnyErrorDefinition
}

type ReducerParamsOf<Options extends ReducerOptions | undefined> =
  Options extends {
    readonly params: infer Params extends Stdb.StructLikeValueType
  }
    ? Params
    : typeof EmptyParams

type ReducerErrorsOf<Options extends ReducerOptions | undefined> =
  Options extends {
    readonly errors: infer Errors extends Stdb.AnyErrorDefinition
  }
    ? Errors
    : undefined

type PublicOf<Options extends { readonly public?: boolean } | undefined> =
  Options extends { readonly public: infer Public extends boolean }
    ? Public
    : true

export const rawReducerSpec = <
  const Options extends ReducerOptions | undefined = undefined,
>(
  options: Options = undefined as Options,
): Stdb.ReducerSpec<
  ReducerParamsOf<Options>,
  ReducerErrorsOf<Options>,
  PublicOf<Options>
> =>
  ({
    kind: "reducer",
    public: options?.public ?? true,
    params: options?.params ?? EmptyParams,
    ...(options?.errors === undefined ? {} : { errors: options.errors }),
  }) as Stdb.ReducerSpec<
    ReducerParamsOf<Options>,
    ReducerErrorsOf<Options>,
    PublicOf<Options>
  >

type ProcedureOptions = {
  readonly public?: boolean
  readonly params?: Stdb.StructLikeValueType
  readonly returns: Stdb.AnyValueType
  readonly errors?: Stdb.AnyErrorDefinition
}

type ProcedureParamsOf<Options extends ProcedureOptions> = Options extends {
  readonly params: infer Params extends Stdb.StructLikeValueType
}
  ? Params
  : typeof EmptyParams

type ProcedureReturnsOf<Options extends ProcedureOptions> = Options extends {
  readonly returns: infer Returns extends Stdb.AnyValueType
}
  ? Returns
  : Stdb.AnyValueType

type ProcedureErrorsOf<Options extends ProcedureOptions> = Options extends {
  readonly errors: infer Errors extends Stdb.AnyErrorDefinition
}
  ? Errors
  : undefined

export const rawProcedureSpec = <const Options extends ProcedureOptions>(
  options: Options,
): Stdb.ProcedureSpec<
  ProcedureParamsOf<Options>,
  ProcedureReturnsOf<Options>,
  ProcedureErrorsOf<Options>,
  PublicOf<Options>
> =>
  ({
    kind: "procedure",
    public: options.public ?? true,
    params: options.params ?? EmptyParams,
    returns: options.returns,
    ...(options.errors === undefined ? {} : { errors: options.errors }),
  }) as unknown as Stdb.ProcedureSpec<
    ProcedureParamsOf<Options>,
    ProcedureReturnsOf<Options>,
    ProcedureErrorsOf<Options>,
    PublicOf<Options>
  >

export function rawHttpHandlerSpec<
  const Method extends Stdb.HttpHandlerMethod,
  const Path extends string,
>(options: {
  readonly method: Method
  readonly path: Path
  readonly request?: undefined
  readonly response?: undefined
  readonly errors?: undefined
  readonly successStatus?: number
}): Stdb.RawHttpHandlerSpec<Method, Path>
export function rawHttpHandlerSpec<
  const Request extends Schema.Top,
  const Response extends Schema.Top,
  const Errors extends Stdb.AnyErrorDefinition | undefined,
  const Method extends Stdb.HttpHandlerMethod,
  const Path extends string,
>(options: {
  readonly method: Method
  readonly path: Path
  readonly request: Request
  readonly response: Response
  readonly errors?: Errors
  readonly successStatus?: number
}): Stdb.TypedHttpHandlerSpec<Request, Response, Errors, Method, Path>
export function rawHttpHandlerSpec(options: {
  readonly method: Stdb.HttpHandlerMethod
  readonly path: string
  readonly request?: Schema.Top | undefined
  readonly response?: Schema.Top | undefined
  readonly errors?: Stdb.AnyErrorDefinition | undefined
  readonly successStatus?: number | undefined
}): Stdb.HttpHandlerSpec
export function rawHttpHandlerSpec(options: {
  readonly method: Stdb.HttpHandlerMethod
  readonly path: string
  readonly request?: Schema.Top | undefined
  readonly response?: Schema.Top | undefined
  readonly errors?: Stdb.AnyErrorDefinition | undefined
  readonly successStatus?: number | undefined
}): unknown {
  return {
    kind: "httpHandler",
    method: options.method,
    path: options.path,
    ...(options.request === undefined ? {} : { request: options.request }),
    ...(options.response === undefined ? {} : { response: options.response }),
    ...(options.errors === undefined ? {} : { errors: options.errors }),
    ...(options.successStatus === undefined
      ? {}
      : { successStatus: options.successStatus }),
  } as Stdb.RawHttpHandlerSpec | Stdb.TypedHttpHandlerSpec
}

const callableDeclsFromSections = (
  options: ModuleFromSectionsOptions<
    Record<string, Stdb.AnyTableSpec> | undefined,
    Record<string, Stdb.AnyViewSpec> | undefined,
    Record<string, Stdb.ReducerSpec> | undefined,
    Record<string, Stdb.ProcedureSpec> | undefined,
    Stdb.LifecycleSpecs | undefined,
    Record<string, Stdb.HttpHandlerSpec> | undefined
  >,
): ReadonlyArray<Stdb.AnyCallableDecl> =>
  [
    ...Object.entries(options.views ?? {}).map(([name, spec]) => ({
      declKind: "view" as const,
      name,
      spec,
    })),
    ...Object.entries(options.reducers ?? {}).map(([name, spec]) => ({
      declKind: "reducer" as const,
      name,
      spec,
    })),
    ...Object.entries(options.procedures ?? {}).map(([name, spec]) => ({
      declKind: "procedure" as const,
      name,
      spec,
    })),
    ...Object.entries(options.lifecycle ?? {}).map(([name, spec]) => ({
      declKind: "lifecycle" as const,
      name: name as "init" | "clientConnected" | "clientDisconnected",
      spec,
    })),
  ] as ReadonlyArray<Stdb.AnyCallableDecl>

export const moduleFromSections = <
  const Tables extends
    | Record<string, Stdb.AnyTableSpec>
    | undefined = undefined,
  const Views extends Record<string, Stdb.AnyViewSpec> | undefined = undefined,
  const Reducers extends
    | Record<string, Stdb.ReducerSpec>
    | undefined = undefined,
  const Procedures extends
    | Record<string, Stdb.ProcedureSpec>
    | undefined = undefined,
  const Lifecycle extends Stdb.LifecycleSpecs | undefined = undefined,
  const HttpHandlers extends
    | Record<string, Stdb.HttpHandlerSpec>
    | undefined = undefined,
>(
  options: ModuleFromSectionsOptions<
    Tables,
    Views,
    Reducers,
    Procedures,
    Lifecycle,
    HttpHandlers
  >,
): ModuleFromSectionsSpec<
  Tables,
  Views,
  Reducers,
  Procedures,
  Lifecycle,
  HttpHandlers
> => {
  const tables = Object.values(
    options.tables ?? {},
  ) as ReadonlyArray<Stdb.AnyTableSpec>
  let module: Stdb.StdbModuleType<
    string,
    Record<string, Stdb.AnyTableSpec>,
    | Stdb.StdbGroupType<string, Stdb.AnyCallableDecl>
    | Stdb.StdbHttpGroupType<string, Stdb.AnyHttpRouteDecl>,
    string
  > = Stdb.StdbModule.make(options.name, {
    ...(options.settings === undefined ? {} : { settings: options.settings }),
  }).addTables(...tables)

  const callableDecls = callableDeclsFromSections(options)
  if (callableDecls.length > 0) {
    module = module.add(
      Stdb.StdbGroup.make("Callables").add(
        ...(callableDecls as [
          Stdb.AnyCallableDecl,
          ...ReadonlyArray<Stdb.AnyCallableDecl>,
        ]),
      ),
    )
  }

  const httpHandlers: Record<string, Stdb.HttpHandlerSpec> =
    options.httpHandlers ?? {}
  const httpDecls = Object.entries(httpHandlers).map(([name, spec]) => ({
    declKind: "httpHandler" as const,
    httpMode:
      spec.request === undefined && spec.response === undefined
        ? ("raw" as const)
        : ("typed" as const),
    name,
    spec,
  })) as ReadonlyArray<Stdb.AnyHttpRouteDecl>
  if (httpDecls.length > 0) {
    module = module.add(
      Stdb.StdbHttpGroup.make("Http").add(
        ...(httpDecls as [
          (typeof httpDecls)[number],
          ...ReadonlyArray<(typeof httpDecls)[number]>,
        ]),
      ),
    )
  }

  return module.spec as ModuleFromSectionsSpec<
    Tables,
    Views,
    Reducers,
    Procedures,
    Lifecycle,
    HttpHandlers
  >
}
