export { isRowTypedQuery } from "spacetimedb"

export const moduleHooks = Symbol("spacetime:sys@2.0/moduleHooks")
const registerExport = Symbol("SpacetimeDB.registerExport")
const exportNames = new WeakMap<object, string>()

type ModuleExport = {
  readonly [registerExport]: (schema: TestSchema, exportName: string) => void
}

type CallableModuleExport = ModuleExport & {
  readonly kind: "procedure" | "reducer"
  readonly params: unknown
  readonly returnType?: unknown
  readonly invoke: (ctx: unknown, rawArgs: unknown) => unknown
}

type ViewModuleExport = ModuleExport & {
  readonly invoke: (ctx: unknown) => unknown
}

type HttpRoute = {
  readonly handler: ModuleExport
  readonly method: string
  readonly path: string
}

type ExplicitNameEntry = {
  readonly tag: "Index" | "Table"
  readonly value: {
    readonly sourceName: string
    readonly canonicalName: string
  }
}

type TableIndexOptions = {
  readonly name?: string
  readonly algorithm?: "btree" | "hash" | "direct"
  readonly columns?: ReadonlyArray<string>
  readonly column?: string
}

type TableOptions = {
  readonly name?: string
  readonly indexes?: ReadonlyArray<TableIndexOptions>
}

type ViewOptions = {
  readonly name: string
  readonly public: boolean
}

type TableSchema = {
  readonly tableDef: (schema: TestSchema, accessorName: string) => unknown
}

export const CaseConversionPolicy = {
  SnakeCase: "snake_case",
  None: "none",
} as const

export class SenderError extends Error {}

export class SpacetimeHostError extends Error {
  override get name(): string {
    return "SpacetimeHostError"
  }
}

const hostErrorNames = [
  "HostCallFailure",
  "NotInTransaction",
  "BsatnDecodeError",
  "NoSuchTable",
  "NoSuchIndex",
  "NoSuchIter",
  "NoSuchConsoleTimer",
  "NoSuchBytes",
  "NoSpace",
  "BufferTooSmall",
  "UniqueAlreadyExists",
  "ScheduleAtDelayTooLong",
  "IndexNotUnique",
  "NoSuchRow",
  "AutoIncOverflow",
  "WouldBlockTransaction",
  "TransactionNotAnonymous",
  "TransactionIsReadOnly",
  "TransactionIsMut",
  "HttpError",
] as const

export const errors = Object.fromEntries(
  hostErrorNames.map((name) => [
    name,
    class extends SpacetimeHostError {
      override get name(): string {
        return name
      }
    },
  ]),
) as Record<(typeof hostErrorNames)[number], typeof SpacetimeHostError>

export class Range<T> {
  readonly from: unknown
  readonly to: unknown

  constructor(from?: unknown, to?: unknown) {
    this.from = from ?? { tag: "unbounded" }
    this.to = to ?? { tag: "unbounded" }
  }
}

export class Headers extends globalThis.Headers {}

export class Request extends globalThis.Request {}

export class SyncResponse {
  readonly body: string
  readonly headers: Headers
  readonly status: number

  constructor(
    body = "",
    init: { readonly headers?: HeadersInit; readonly status?: number } = {},
  ) {
    this.body = body
    this.headers = new Headers(init.headers)
    this.status = init.status ?? 200
  }
}

export class Router {
  readonly routes: Array<HttpRoute> = []

  get(path: string, handler: ModuleExport): this {
    return this.route("GET", path, handler)
  }

  post(path: string, handler: ModuleExport): this {
    return this.route("POST", path, handler)
  }

  put(path: string, handler: ModuleExport): this {
    return this.route("PUT", path, handler)
  }

  delete(path: string, handler: ModuleExport): this {
    return this.route("DELETE", path, handler)
  }

  patch(path: string, handler: ModuleExport): this {
    return this.route("PATCH", path, handler)
  }

  head(path: string, handler: ModuleExport): this {
    return this.route("HEAD", path, handler)
  }

  options(path: string, handler: ModuleExport): this {
    return this.route("OPTIONS", path, handler)
  }

  any(path: string, handler: ModuleExport): this {
    return this.route("ANY", path, handler)
  }

  private route(method: string, path: string, handler: ModuleExport): this {
    this.routes.push({ handler, method, path })
    return this
  }
}

class TestSchema {
  readonly moduleDef = {
    tables: [] as Array<unknown>,
    reducers: [] as Array<{
      readonly sourceName: string
      readonly params: unknown
    }>,
    procedures: [] as Array<{
      readonly sourceName: string
      readonly params: unknown
      readonly returnType: unknown
    }>,
    httpHandlers: [] as Array<{ readonly sourceName: string }>,
    httpRoutes: [] as Array<{
      readonly handlerFunction: string
      readonly method: string
      readonly path: string
    }>,
    views: [] as Array<{
      readonly sourceName: string
      readonly exportName: string
      readonly public: boolean
    }>,
    explicitNames: {
      entries: [] as Array<ExplicitNameEntry>,
    },
  }

  constructor(tables: Record<string, unknown> = {}) {
    for (const [accessorName, tableSchema] of Object.entries(tables)) {
      if (isTableSchema(tableSchema)) {
        this.moduleDef.tables.push(tableSchema.tableDef(this, accessorName))
      }
    }
  }

  reducer(
    params: Record<string, unknown>,
    handler: (ctx: unknown, rawArgs: unknown) => unknown,
  ): ModuleExport {
    return callableModuleExport(handler, { kind: "reducer", params })
  }

  procedure(
    params: Record<string, unknown>,
    returnType: unknown,
    handler: (ctx: unknown, rawArgs: unknown) => unknown,
  ): ModuleExport {
    return callableModuleExport(handler, {
      kind: "procedure",
      params,
      returnType,
    })
  }

  view(
    options: ViewOptions,
    _returnType: unknown,
    handler: (ctx: unknown) => unknown,
  ): ModuleExport {
    return viewModuleExport(options, handler)
  }

  anonymousView(
    options: ViewOptions,
    _returnType: unknown,
    handler: (ctx: unknown) => unknown,
  ): ModuleExport {
    return viewModuleExport(options, handler)
  }

  init(): ModuleExport {
    return emptyModuleExport()
  }

  clientConnected(): ModuleExport {
    return emptyModuleExport()
  }

  clientDisconnected(): ModuleExport {
    return emptyModuleExport()
  }

  httpHandler(): ModuleExport {
    const exportValue: ModuleExport = {
      [registerExport]: (schema, exportName) => {
        exportNames.set(exportValue, exportName)
        schema.moduleDef.httpHandlers.push({ sourceName: exportName })
      },
    }
    return exportValue
  }

  httpRouter(router: Router): ModuleExport {
    return {
      [registerExport]: (schema) => {
        for (const route of router.routes) {
          schema.moduleDef.httpRoutes.push({
            handlerFunction: exportNames.get(route.handler) ?? "",
            method: route.method,
            path: route.path,
          })
        }
      },
    }
  }

  exportGroup(exports: Record<string, ModuleExport>): ModuleExport {
    return {
      [registerExport]: (schema) => {
        for (const [exportName, moduleExport] of Object.entries(exports)) {
          moduleExport[registerExport](schema, exportName)
        }
      },
    }
  }
}

const emptyModuleExport = (): ModuleExport => ({
  [registerExport]: () => {},
})

const callableModuleExport = (
  handler: CallableModuleExport["invoke"],
  options: {
    readonly kind: CallableModuleExport["kind"]
    readonly params: unknown
    readonly returnType?: unknown
  },
): CallableModuleExport => ({
  ...options,
  [registerExport]: (schema, exportName) => {
    if (options.kind === "reducer") {
      schema.moduleDef.reducers.push({
        sourceName: exportName,
        params: options.params,
      })
      return
    }

    schema.moduleDef.procedures.push({
      sourceName: exportName,
      params: options.params,
      returnType: options.returnType,
    })
  },
  invoke: handler,
})

const viewModuleExport = (
  options: ViewOptions,
  handler: ViewModuleExport["invoke"],
): ViewModuleExport => ({
  [registerExport]: (schema, exportName) => {
    schema.moduleDef.views.push({
      sourceName: options.name,
      exportName,
      public: options.public,
    })
  },
  invoke: handler,
})

export const invokeModuleExport = (
  moduleExport: unknown,
  ctx: unknown,
  rawArgs: unknown,
): unknown => (moduleExport as CallableModuleExport).invoke(ctx, rawArgs)

const isModuleExport = (value: unknown): value is ModuleExport =>
  typeof value === "object" && value !== null && registerExport in value

const isTableSchema = (value: unknown): value is TableSchema =>
  typeof value === "object" && value !== null && "tableDef" in value

export const schema = (tables?: Record<string, unknown>): TestSchema =>
  new TestSchema(tables)

export const registerCompiledModule = (
  schema: unknown,
  exportGroup: unknown,
): unknown => {
  const proto = Object.getPrototypeOf(schema) as Record<PropertyKey, unknown>
  const hookSymbol = Object.getOwnPropertySymbols(proto).find(
    (symbol) => typeof proto[symbol] === "function",
  )
  if (hookSymbol == null) {
    throw new Error("Missing SDK module hook symbol")
  }

  return (schema as Record<PropertyKey, (exports: object) => unknown>)[
    hookSymbol
  ]!({
    default: schema,
    ModuleExports: exportGroup,
  })
}

type TestBuilderMetadata = {
  readonly kind?: string
  readonly columnName?: string
  readonly defaultValue?: unknown
  readonly columnMetadata?: {
    readonly isPrimaryKey?: boolean
    readonly isAutoIncrement?: boolean
  }
  readonly item?: unknown
  readonly fields?: Record<string, unknown>
  readonly typeName?: string
  readonly isOptional?: boolean
}

const makeBuilder = (metadata: TestBuilderMetadata = {}): unknown => ({
  ...metadata,
  optional: () => makeBuilder({ ...metadata, isOptional: true }),
  default: (defaultValue: unknown) =>
    makeBuilder({ ...metadata, defaultValue }),
  primaryKey: () =>
    makeBuilder({
      ...metadata,
      columnMetadata: {
        ...metadata.columnMetadata,
        isPrimaryKey: true,
      },
    }),
  autoInc: () =>
    makeBuilder({
      ...metadata,
      columnMetadata: {
        ...metadata.columnMetadata,
        isAutoIncrement: true,
      },
    }),
  name: (columnName: string) => makeBuilder({ ...metadata, columnName }),
  serialize: () => {},
})

export const t = new Proxy(
  {},
  {
    get: (_target, property) =>
      property === "row"
        ? (row: Record<string, unknown>) => ({ row })
        : property === "array" || property === "lazy" || property === "option"
          ? (item: unknown) => makeBuilder({ kind: String(property), item })
          : property === "object"
            ? (typeName: string, fields: Record<string, unknown>) =>
                makeBuilder({
                  kind: "object",
                  typeName,
                  fields,
                })
            : property === "enum"
              ? (typeName: string, fields: Record<string, unknown>) =>
                  makeBuilder({
                    kind: "enum",
                    typeName,
                    fields,
                  })
              : property === "result"
                ? (ok: unknown, err: unknown) =>
                    makeBuilder({
                      kind: "result",
                      fields: { ok, err },
                    })
                : () => makeBuilder({ kind: String(property) }),
  },
)

const columnsForIndex = (index: TableIndexOptions): ReadonlyArray<string> =>
  index.columns ?? (index.column === undefined ? [] : [index.column])

export const table = (options: unknown, row: unknown): unknown => {
  const tableOptions = options as TableOptions

  return {
    options,
    row,
    rowType: row,
    tableDef: (schema: TestSchema, accessorName: string) => {
      for (const index of tableOptions.indexes ?? []) {
        if (index.name === undefined) {
          continue
        }

        const columns = columnsForIndex(index)
        const algorithm = index.algorithm ?? "btree"
        schema.moduleDef.explicitNames.entries.push({
          tag: "Index",
          value: {
            sourceName: `${accessorName}_${columns.join("_")}_idx_${algorithm}`,
            canonicalName: index.name,
          },
        })
      }

      if (tableOptions.name !== undefined) {
        schema.moduleDef.explicitNames.entries.push({
          tag: "Table",
          value: {
            sourceName: accessorName,
            canonicalName: tableOptions.name,
          },
        })
      }

      return {
        sourceName: accessorName,
        row,
      }
    },
  }
}

function registerModuleExports(
  this: TestSchema,
  exports: unknown,
): { readonly __describe_module__: () => Uint8Array } {
  const moduleExports = exports as Record<string, unknown>

  for (const [name, moduleExport] of Object.entries(moduleExports)) {
    if (name === "default") {
      continue
    }

    if (isModuleExport(moduleExport)) {
      moduleExport[registerExport](this, name)
    }
  }

  return {
    __describe_module__: () => new Uint8Array([1]),
  }
}

Object.defineProperty(TestSchema.prototype, moduleHooks, {
  value: registerModuleExports,
})
