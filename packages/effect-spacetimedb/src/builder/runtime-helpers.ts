import * as Effect from "effect/Effect"

import * as Match from "effect/Match"
import type { AnyErrorDefinition } from "../contract/error.ts"
import { type HttpHandlerSpec } from "../contract/http-handler.ts"
import {
  type LifecycleSpec,
  type LifecycleSpecs,
} from "../contract/lifecycle.ts"
import {
  type AnyModuleSpec,
  define as defineModule,
} from "../contract/module.ts"
import {
  httpHandlerRoutesOverlap,
  StdbDiagnostic,
  type StdbDiagnosticCode,
  StdbValidationError,
} from "../contract/module-validation.ts"
import { type ProcedureSpec } from "../contract/procedure.ts"
import { type ReducerSpec } from "../contract/reducer.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import { type AnyViewSpec } from "../contract/view.ts"

import * as ServerContext from "../server/context.ts"

import type { HandlerInputDefinitions } from "../server/handler-types.ts"

import type {
  AnyCallableDecl,
  AnyEndpointDecl,
  AnyGroup,
  AnyHttpRouteDecl,
  ModuleAccessors,
  ModuleSpecFor,
  RuntimeModuleState,
} from "./declarations.ts"
import {
  mergeGroupErrorDefaults,
  withGroupDefaultErrors,
} from "./group-error-runtime.ts"
import {
  assertValidGroupMiddleware,
  middlewareForDecl,
  prependMiddleware,
} from "./group-middleware-runtime.ts"
import type { AnyStdbModule } from "./handler-types.ts"
import type { StdbGroup, StdbHttpGroup, StdbModule } from "./http-builders.ts"
import type {
  GroupEndpointPair,
  GroupEndpointPairsOf,
  GroupNameOf,
  HttpGroupPair,
  HttpGroupPairsOf,
  NonEmptyReadonlyArray,
  ScheduledTableNameOf,
  SchedulePair,
  SchedulePairsOf,
  SpecOfModule,
  TableNameOf,
  TablesFromTuple,
} from "./type-utils.ts"

export const diagnostic = (
  code: StdbDiagnosticCode,
  path: ReadonlyArray<string | number>,
  message: string,
): StdbValidationError =>
  new StdbValidationError({
    diagnostics: [
      new StdbDiagnostic({
        code,
        path,
        message,
        severity: "error",
      }),
    ],
  })

export const duplicateCallableError = (
  path: ReadonlyArray<string | number>,
  message: string,
): StdbValidationError => diagnostic("DuplicateCallableName", path, message)

export const normalizeRoutePath = (...parts: ReadonlyArray<string>): string => {
  const joined = parts.filter((part) => part.length > 0).join("/")
  const normalized = joined.replaceAll(/\/+/g, "/")
  const withLeadingSlash = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`
  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash
}

const assertUniqueEndpointNames = (
  groupId: string,
  endpoints: ReadonlyArray<AnyEndpointDecl>,
): void => {
  const seen = new Set<string>()
  for (const endpoint of endpoints) {
    if (seen.has(endpoint.name)) {
      throw duplicateCallableError(
        ["groups", groupId, endpoint.name],
        `Group ${groupId} declares duplicate endpoint ${endpoint.name}`,
      )
    }
    seen.add(endpoint.name)
  }
}

const assertHttpRouteConflicts = (
  groupId: string,
  endpoints: ReadonlyArray<AnyHttpRouteDecl>,
): void => {
  for (let leftIndex = 0; leftIndex < endpoints.length; leftIndex += 1) {
    const left = endpoints[leftIndex]
    if (left == null) {
      continue
    }
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < endpoints.length;
      rightIndex += 1
    ) {
      const right = endpoints[rightIndex]
      if (right == null) {
        continue
      }
      if (!httpHandlerRoutesOverlap(left.spec, right.spec)) {
        continue
      }
      throw diagnostic(
        "DuplicateHttpHandlerRoute",
        ["groups", groupId, right.name],
        `HTTP route ${right.spec.method.toUpperCase()} ${right.spec.path} for ${right.name} overlaps with ${left.name}`,
      )
    }
  }
}

const assertUniqueGroupIds = (groups: ReadonlyArray<AnyGroup>): void => {
  const seen = new Set<string>()
  for (const group of groups) {
    if (seen.has(group.id)) {
      throw duplicateCallableError(
        ["groups", group.id],
        `Module declares duplicate group ${group.id}`,
      )
    }
    seen.add(group.id)
  }
}

const assertNoDuplicateTableKeys = (
  left: Record<string, AnyTableSpec>,
  right: Record<string, AnyTableSpec>,
): void => {
  for (const key of Object.keys(right)) {
    if (Object.hasOwn(left, key)) {
      throw diagnostic(
        "DuplicateRelationName",
        ["tables", key],
        `Module merge declares duplicate table key ${key}`,
      )
    }
  }
}

const tableRecordFromList = (
  tables: ReadonlyArray<AnyTableSpec>,
): Record<string, AnyTableSpec> => {
  const entries: Array<readonly [string, AnyTableSpec]> = []
  const seen = new Set<string>()
  for (const table of tables) {
    if (seen.has(table.name)) {
      throw diagnostic(
        "DuplicateRelationName",
        ["tables", table.name],
        `Module declares duplicate table ${table.name}`,
      )
    }
    seen.add(table.name)
    entries.push([table.name, table])
  }
  return Object.fromEntries(entries)
}

const transformHttpEndpointPath = <Endpoint extends AnyHttpRouteDecl>(
  endpoint: Endpoint,
  prefix: string,
): Endpoint =>
  ({
    ...endpoint,
    spec: {
      ...endpoint.spec,
      path: normalizeRoutePath(prefix, endpoint.spec.path),
    },
  }) as Endpoint

export const makeCallableGroup = <
  Id extends string,
  Endpoints extends AnyCallableDecl,
  Errors extends AnyErrorDefinition | undefined = undefined,
>(
  id: Id,
  endpoints: ReadonlyArray<AnyCallableDecl>,
  errors?: Errors,
): StdbGroup<Id, Endpoints, Errors> => {
  assertUniqueEndpointNames(id, endpoints)

  return {
    kind: "stdbGroup",
    id,
    ...(errors === undefined ? {} : { errors }),
    endpoints,
    add: (...added) =>
      makeCallableGroup<Id, Endpoints | (typeof added)[number], Errors>(
        id,
        [...endpoints, ...added],
        errors,
      ),
  } as StdbGroup<Id, Endpoints, Errors>
}

export const makeHttpGroup = <
  Id extends string,
  Endpoints extends AnyHttpRouteDecl,
  Errors extends AnyErrorDefinition | undefined = undefined,
>(
  id: Id,
  endpoints: ReadonlyArray<AnyHttpRouteDecl>,
  errors?: Errors,
  activePrefix = "",
): StdbHttpGroup<Id, Endpoints, Errors> => {
  assertUniqueEndpointNames(id, endpoints)
  assertHttpRouteConflicts(id, endpoints)

  return {
    kind: "stdbHttpGroup",
    id,
    ...(errors === undefined ? {} : { errors }),
    endpoints,
    add: (...added: NonEmptyReadonlyArray<AnyHttpRouteDecl>) =>
      makeHttpGroup<Id, Endpoints | (typeof added)[number], Errors>(
        id,
        [
          ...endpoints,
          ...added.map((endpoint) =>
            transformHttpEndpointPath(endpoint, activePrefix),
          ),
        ],
        errors,
        activePrefix,
      ),
    prefix: (nextPrefix: string) =>
      makeHttpGroup<Id, Endpoints, Errors>(
        id,
        endpoints.map((endpoint) =>
          transformHttpEndpointPath(endpoint, nextPrefix),
        ),
        errors,
        normalizeRoutePath(activePrefix, nextPrefix),
      ),
    nest: (
      prefix: string,
      other: StdbHttpGroup<
        string,
        AnyHttpRouteDecl,
        AnyErrorDefinition | undefined
      >,
    ) =>
      makeHttpGroup(
        id,
        [
          ...endpoints,
          ...other.endpoints.map((endpoint: AnyHttpRouteDecl) =>
            transformHttpEndpointPath(
              endpoint,
              normalizeRoutePath(activePrefix, prefix),
            ),
          ),
        ],
        mergeGroupErrorDefaults(errors, other.errors),
        activePrefix,
      ) as never,
    merge: (
      other: StdbHttpGroup<
        string,
        AnyHttpRouteDecl,
        AnyErrorDefinition | undefined
      >,
    ) =>
      makeHttpGroup(
        id,
        [...endpoints, ...other.endpoints],
        mergeGroupErrorDefaults(errors, other.errors),
        activePrefix,
      ) as never,
  } as unknown as StdbHttpGroup<Id, Endpoints, Errors>
}

// Module accessors are typed facades over shared runtime tags; this is the
// single builder-side seam that attaches the module brand to the R channel.
const moduleScopedAccessor = <
  Spec extends AnyModuleSpec,
  A,
  Requirement extends ServerContext.AnyServerContextRequirements,
>(
  effect: Effect.Effect<A, never, Requirement>,
): Effect.Effect<
  A,
  never,
  ServerContext.ModuleScopedRequirement<Spec, Requirement>
> =>
  // Builder accessor boundary: the runtime tag is shared; only the R-channel
  // records which module accessor produced it.
  // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
  effect as Effect.Effect<
    A,
    never,
    ServerContext.ModuleScopedRequirement<Spec, Requirement>
  >

const makeAccessors = <
  Spec extends AnyModuleSpec,
>(): ModuleAccessors<Spec> => ({
  Db: moduleScopedAccessor<
    Spec,
    ServerContext.DbService<Spec>,
    ServerContext.Db
  >(Effect.map(ServerContext.Db, (db) => db as ServerContext.DbService<Spec>)),
  ReadonlyDb: moduleScopedAccessor<
    Spec,
    ServerContext.ReadonlyDbService<Spec>,
    ServerContext.ReadonlyDb
  >(
    Effect.map(
      ServerContext.ReadonlyDb,
      (db) => db as ServerContext.ReadonlyDbService<Spec>,
    ),
  ),
  ReducerCtx: moduleScopedAccessor<
    Spec,
    ServerContext.ReducerCtxService<Spec>,
    ServerContext.ReducerCtx
  >(
    Effect.map(
      ServerContext.ReducerCtx,
      (ctx) => ctx as ServerContext.ReducerCtxService<Spec>,
    ),
  ),
  ProcedureCtx: moduleScopedAccessor<
    Spec,
    ServerContext.ProcedureCtxService<Spec>,
    ServerContext.ProcedureCtx
  >(
    Effect.map(
      ServerContext.ProcedureCtx,
      (ctx) => ctx as ServerContext.ProcedureCtxService<Spec>,
    ),
  ),
  TxCtx: moduleScopedAccessor<
    Spec,
    ServerContext.TxCtxService<Spec>,
    ServerContext.TxCtx
  >(
    Effect.map(
      ServerContext.TxCtx,
      (ctx) => ctx as ServerContext.TxCtxService<Spec>,
    ),
  ),
  ViewCtx: moduleScopedAccessor<
    Spec,
    ServerContext.ViewCtxService<Spec>,
    ServerContext.ViewCtx
  >(
    Effect.map(
      ServerContext.ViewCtx,
      (ctx) => ctx as ServerContext.ViewCtxService<Spec>,
    ),
  ),
  AnonymousViewCtx: moduleScopedAccessor<
    Spec,
    ServerContext.AnonymousViewCtxService<Spec>,
    ServerContext.AnonymousViewCtx
  >(
    Effect.map(
      ServerContext.AnonymousViewCtx,
      (ctx) => ctx as ServerContext.AnonymousViewCtxService<Spec>,
    ),
  ),
  HttpHandlerCtx: moduleScopedAccessor<
    Spec,
    ServerContext.HttpHandlerCtxService<Spec>,
    ServerContext.HttpHandlerCtx
  >(
    Effect.map(
      ServerContext.HttpHandlerCtx,
      (ctx) => ctx as ServerContext.HttpHandlerCtxService<Spec>,
    ),
  ),
  MutationCtx: moduleScopedAccessor<
    Spec,
    ServerContext.MutationCtxService<Spec>,
    ServerContext.MutationCtx
  >(
    Effect.map(
      ServerContext.MutationCtx,
      (ctx) => ctx as ServerContext.MutationCtxService<Spec>,
    ),
  ),
  From: moduleScopedAccessor<
    Spec,
    ServerContext.FromService<Spec>,
    ServerContext.From
  >(
    Effect.map(
      ServerContext.From,
      (from) => from as ServerContext.FromService<Spec>,
    ),
  ),
  // Http is module-independent and deliberately unbranded.
  Http: ServerContext.Http,
  Tx: ServerContext.txRunnerForModule<Spec>(),
  withTx: (effect) =>
    Effect.flatMap(ServerContext.txRunnerForModule<Spec>(), (runner) =>
      runner.run(effect),
    ),
  HttpTx: ServerContext.httpTxRunnerForModule<Spec>(),
})

export const sortedRecord = <Value>(
  entries: ReadonlyArray<readonly [string, Value]>,
): Record<string, Value> =>
  Object.fromEntries(
    entries.slice().sort(([left], [right]) => left.localeCompare(right)),
  ) as Record<string, Value>

const assembleSpec = <
  Id extends string,
  Tables extends Record<string, AnyTableSpec>,
  Groups extends AnyGroup,
  Lifecycle extends LifecycleSpecs,
  HttpGroupPairs extends HttpGroupPair,
>(
  state: RuntimeModuleState,
): ModuleSpecFor<Id, Tables, Groups, Lifecycle, HttpGroupPairs> => {
  const reducerEntries: Array<readonly [string, ReducerSpec]> = []
  const procedureEntries: Array<readonly [string, ProcedureSpec]> = []
  const viewEntries: Array<readonly [string, AnyViewSpec]> = []
  const lifecycleEntries: Array<readonly [string, LifecycleSpec]> = []
  const httpHandlerEntries: Array<readonly [string, HttpHandlerSpec]> = []
  const httpGroupEntries: Array<readonly [string, string]> = []
  const reducerGroupEntries: Array<readonly [string, string]> = []
  const procedureGroupEntries: Array<readonly [string, string]> = []
  const names = new Map<string, string>()
  const relationNames = new Map<string, string>()
  const declaredLifecycleNames = new Set(Object.keys(state.lifecycle))
  const groupedLifecycleNames = new Set<string>()

  const assertExportName = (section: string, name: string): void => {
    const previous = names.get(name)
    if (previous != null) {
      throw duplicateCallableError(
        [section, name],
        `Endpoint ${name} is declared by both ${previous} and ${section}`,
      )
    }
    names.set(name, section)
  }

  const assertRelationName = (section: string, name: string): void => {
    const previous = relationNames.get(name)
    if (previous != null) {
      throw diagnostic(
        "DuplicateRelationName",
        [section, name],
        `Relation ${name} is declared by both ${previous} and ${section}`,
      )
    }
    relationNames.set(name, section)
  }

  for (const [tableKey, table] of Object.entries(state.tables)) {
    assertRelationName(`tables.${tableKey}`, table.name)
  }

  for (const [name, spec] of Object.entries(state.lifecycle)) {
    assertExportName("lifecycle", name)
    lifecycleEntries.push([name, spec])
  }

  for (const group of state.groups) {
    for (const endpoint of group.endpoints) {
      Match.value(endpoint).pipe(
        Match.discriminatorsExhaustive("declKind")({
          reducer: (endpoint) => {
            assertExportName("reducers", endpoint.name)
            reducerEntries.push([
              endpoint.name,
              group.errors === undefined
                ? endpoint.spec
                : withGroupDefaultErrors(group.errors, endpoint.spec, [
                    "reducers",
                    endpoint.name,
                  ]),
            ])
            reducerGroupEntries.push([endpoint.name, group.id])
          },
          procedure: (endpoint) => {
            assertExportName("procedures", endpoint.name)
            procedureEntries.push([
              endpoint.name,
              group.errors === undefined
                ? endpoint.spec
                : withGroupDefaultErrors(group.errors, endpoint.spec, [
                    "procedures",
                    endpoint.name,
                  ]),
            ])
            procedureGroupEntries.push([endpoint.name, group.id])
          },
          view: (endpoint) => {
            assertRelationName(`views.${endpoint.name}`, endpoint.name)
            viewEntries.push([endpoint.name, endpoint.spec])
          },
          lifecycle: (endpoint) => {
            if (groupedLifecycleNames.has(endpoint.name)) {
              throw duplicateCallableError(
                ["lifecycle", endpoint.name],
                `Lifecycle hook implemented more than once: ${endpoint.name}`,
              )
            }
            groupedLifecycleNames.add(endpoint.name)
            if (!declaredLifecycleNames.has(endpoint.name)) {
              assertExportName("lifecycle", endpoint.name)
            }
            lifecycleEntries.push([endpoint.name, endpoint.spec])
          },
          httpHandler: (endpoint) => {
            assertExportName("httpHandlers", endpoint.name)
            httpHandlerEntries.push([
              endpoint.name,
              group.errors === undefined || endpoint.httpMode === "raw"
                ? endpoint.spec
                : withGroupDefaultErrors(group.errors, endpoint.spec, [
                    "httpHandlers",
                    endpoint.name,
                  ]),
            ])
            httpGroupEntries.push([endpoint.name, group.id])
          },
        }),
      )
    }
  }

  return defineModule({
    name: state.id,
    settings: state.settings,
    tables: state.tables as Tables,
    views: sortedRecord(viewEntries),
    reducers: sortedRecord(reducerEntries),
    procedures: sortedRecord(procedureEntries),
    lifecycle: sortedRecord(lifecycleEntries),
    httpHandlers: sortedRecord(httpHandlerEntries),
    httpGroups: sortedRecord(httpGroupEntries),
    reducerGroups: sortedRecord(reducerGroupEntries),
    procedureGroups: sortedRecord(procedureGroupEntries),
    // Cast seam: runtime assembly is validated above; ModuleSpecFor reads the
    // groups' eager section-record phantoms. Platform structure snapshots pin
    // this boundary against a wrong derived type.
  }) as unknown as ModuleSpecFor<Id, Tables, Groups, Lifecycle, HttpGroupPairs>
}

export const makeModule = <
  Id extends string,
  Tables extends Record<string, AnyTableSpec>,
  Groups extends AnyGroup = never,
  GroupNameUnion extends string = GroupNameOf<Groups>,
  TableNameUnion extends string = keyof Tables & string,
  Lifecycle extends LifecycleSpecs = {},
  HttpGroupPairs extends HttpGroupPair = HttpGroupPairsOf<Groups>,
  ScheduledTableNameUnion extends string = ScheduledTableNameOf<
    Tables[keyof Tables]
  >,
  SchedulePairs extends SchedulePair = SchedulePairsOf<Groups>,
  GroupEndpointPairs extends GroupEndpointPair = GroupEndpointPairsOf<Groups>,
>(
  state: RuntimeModuleState,
): StdbModule<
  Id,
  Tables,
  Groups,
  GroupNameUnion,
  TableNameUnion,
  Lifecycle,
  HttpGroupPairs,
  ScheduledTableNameUnion,
  SchedulePairs,
  GroupEndpointPairs
> => {
  assertUniqueGroupIds(state.groups)
  const accessors =
    makeAccessors<
      ModuleSpecFor<Id, Tables, Groups, Lifecycle, HttpGroupPairs>
    >()
  const module = {
    ...state,
    ...accessors,
    get spec() {
      return assembleSpec<Id, Tables, Groups, Lifecycle, HttpGroupPairs>(state)
    },
    addTables: (...tables: ReadonlyArray<AnyTableSpec>) => {
      const added = tableRecordFromList(tables)
      assertNoDuplicateTableKeys(state.tables, added)
      return makeModule<
        Id,
        Tables & TablesFromTuple<typeof tables>,
        Groups,
        GroupNameUnion,
        TableNameUnion | TableNameOf<(typeof tables)[number]>,
        Lifecycle,
        HttpGroupPairs,
        ScheduledTableNameUnion | ScheduledTableNameOf<(typeof tables)[number]>,
        SchedulePairs,
        GroupEndpointPairs
      >({
        ...state,
        tables: {
          ...state.tables,
          ...added,
        },
      })
    },
    add: (...groups: NonEmptyReadonlyArray<AnyGroup>) =>
      makeModule<
        Id,
        Tables,
        Groups | (typeof groups)[number],
        GroupNameUnion | GroupNameOf<(typeof groups)[number]>,
        TableNameUnion,
        Lifecycle,
        HttpGroupPairs | HttpGroupPairsOf<(typeof groups)[number]>,
        ScheduledTableNameUnion,
        SchedulePairs | SchedulePairsOf<(typeof groups)[number]>,
        GroupEndpointPairs | GroupEndpointPairsOf<(typeof groups)[number]>
      >({
        ...state,
        groups: [...state.groups, ...groups],
      }),
  }

  return module as unknown as StdbModule<
    Id,
    Tables,
    Groups,
    GroupNameUnion,
    TableNameUnion,
    Lifecycle,
    HttpGroupPairs,
    ScheduledTableNameUnion,
    SchedulePairs,
    GroupEndpointPairs
  >
}

const sectionForDecl = (
  decl: AnyEndpointDecl,
): keyof HandlerInputDefinitions<AnyModuleSpec> => {
  switch (decl.declKind) {
    case "reducer":
      return "reducers"
    case "procedure":
      return "procedures"
    case "view":
      return "views"
    case "lifecycle":
      return "lifecycle"
    case "httpHandler":
      return "httpHandlers"
  }
}

export const formatCandidateNames = (names: ReadonlyArray<string>): string =>
  names.length === 0 ? "none" : [...names].sort().join(", ")

export const findDecl = (
  groupId: string,
  endpoints: ReadonlyArray<AnyEndpointDecl>,
  name: string,
): AnyEndpointDecl => {
  const decl = endpoints.find((endpoint) => endpoint.name === name)
  if (decl == null) {
    throw diagnostic(
      "UnknownEndpoint",
      ["groups", groupId, name],
      `Group ${groupId} has no endpoint named ${name}. Available endpoints: ${formatCandidateNames(endpoints.map((endpoint) => endpoint.name))}`,
    )
  }
  return decl
}

export const makeHandlerDefinitionsFromRecord = <
  Module extends AnyStdbModule,
  RuntimeR,
>(
  groupId: string,
  endpoints: ReadonlyArray<AnyEndpointDecl>,
  handlers: Record<string, unknown>,
  middleware?: unknown,
): {
  readonly definitions: Partial<
    HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>
  >
  readonly remainingNames: ReadonlySet<string>
} => {
  assertValidGroupMiddleware(groupId, middleware)
  let definitions: Partial<
    HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>
  > = {}
  const remainingNames = new Set(endpoints.map((endpoint) => endpoint.name))

  for (const [name, handler] of Object.entries(handlers)) {
    const decl = findDecl(groupId, endpoints, name)
    const section = sectionForDecl(decl)
    const definition = prependMiddleware(
      handler,
      middlewareForDecl(decl, middleware),
    )
    const nextSection = {
      ...((definitions[section] as Record<string, unknown> | undefined) ?? {}),
      [name]: definition,
    }
    definitions = {
      ...definitions,
      [section]: nextSection,
    } as Partial<HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>>
    remainingNames.delete(name)
  }

  return { definitions, remainingNames }
}
