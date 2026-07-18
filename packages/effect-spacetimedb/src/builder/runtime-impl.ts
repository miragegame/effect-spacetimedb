import {
  define as defineReducer,
  type ReducerSpec,
} from "../contract/reducer.ts"

import {
  define as defineProcedure,
  type ProcedureSpec,
} from "../contract/procedure.ts"

import type {
  DefinitionOfInputOrUndefined,
  ErrorsInput,
} from "../contract/error.ts"

import type { AnyScheduledTableSpec } from "../contract/table.ts"

import {
  struct,
  unit,
  type AnyValueType,
  type StructLikeValueType,
} from "../contract/type.ts"

import {
  isSyncRunnerLike,
  fromLayer as syncRunnerFromLayer,
  type SyncRunner,
  type SyncRunnerLike,
} from "../server/sync-runner.ts"

import type { HandlerInputDefinitions } from "../server/handler-types.ts"

import { sortedRecord } from "./runtime-helpers.ts"

import type {
  ProcedureDecl,
  ReducerDecl,
  ScheduledParams,
  ScheduledProcedureDecl,
  ScheduledProcedureSpec,
  ScheduledReducerDecl,
  ScheduledReducerSpec,
} from "./declarations.ts"

import type { AnyStdbModule, BuildRuntime } from "./handler-types.ts"

import type { SpecOfModule } from "./type-utils.ts"

export type RuntimeBuilderImpl<Module extends AnyStdbModule, RuntimeR> = {
  readonly definitions: Partial<
    HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>
  >
}

export const mergeDefinitions = <Module extends AnyStdbModule, RuntimeR>(
  impls: ReadonlyArray<RuntimeBuilderImpl<Module, RuntimeR>>,
): Partial<HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>> => {
  const sections = {
    reducers: [] as Array<readonly [string, unknown]>,
    procedures: [] as Array<readonly [string, unknown]>,
    httpHandlers: [] as Array<readonly [string, unknown]>,
    views: [] as Array<readonly [string, unknown]>,
    lifecycle: [] as Array<readonly [string, unknown]>,
  }

  for (const impl of impls) {
    for (const section of Object.keys(sections) as Array<
      keyof typeof sections
    >) {
      for (const [key, handler] of Object.entries(
        (impl.definitions[section] as Record<string, unknown> | undefined) ??
          {},
      )) {
        sections[section].push([key, handler])
      }
    }
  }

  return {
    reducers:
      sections.reducers.length > 0
        ? sortedRecord(sections.reducers)
        : undefined,
    procedures:
      sections.procedures.length > 0
        ? sortedRecord(sections.procedures)
        : undefined,
    httpHandlers:
      sections.httpHandlers.length > 0
        ? sortedRecord(sections.httpHandlers)
        : undefined,
    views: sections.views.length > 0 ? sortedRecord(sections.views) : undefined,
    lifecycle:
      sections.lifecycle.length > 0
        ? sortedRecord(sections.lifecycle)
        : undefined,
  } as Partial<HandlerInputDefinitions<SpecOfModule<Module>, RuntimeR>>
}

export const normalizeRuntime = <RuntimeR>(
  runtime: BuildRuntime<RuntimeR>,
): SyncRunner<RuntimeR> | SyncRunnerLike<RuntimeR> =>
  isSyncRunnerLike<RuntimeR>(runtime) ? runtime : syncRunnerFromLayer(runtime)

const EmptyEndpointParams = struct({})

export const reducerEndpoint = <
  const Name extends string,
  const Params extends StructLikeValueType = typeof EmptyEndpointParams,
  const Errors extends ErrorsInput | undefined = undefined,
  const Public extends boolean = true,
>(
  name: Name,
  spec: {
    readonly params?: Params
    readonly errors?: Errors
    readonly public?: Public
  },
): ReducerDecl<Name, Params, DefinitionOfInputOrUndefined<Errors>, Public> => ({
  declKind: "reducer",
  name,
  spec: defineReducer(spec as never) as ReducerSpec<
    Params,
    DefinitionOfInputOrUndefined<Errors>,
    Public
  >,
})

export const procedureEndpoint = <
  const Name extends string,
  const Returns extends AnyValueType,
  const Params extends StructLikeValueType = typeof EmptyEndpointParams,
  const Errors extends ErrorsInput | undefined = undefined,
  const Public extends boolean = true,
>(
  name: Name,
  spec: {
    readonly params?: Params
    readonly returns: Returns
    readonly errors?: Errors
    readonly public?: Public
  },
): ProcedureDecl<
  Name,
  Params,
  Returns,
  DefinitionOfInputOrUndefined<Errors>,
  Public
> => ({
  declKind: "procedure",
  name,
  spec: defineProcedure(spec as never) as ProcedureSpec<
    Params,
    Returns,
    DefinitionOfInputOrUndefined<Errors>,
    Public
  >,
})

type ScheduledCallableOptions<
  Table extends AnyScheduledTableSpec,
  Errors extends ErrorsInput | undefined,
> = {
  readonly table: Table
  readonly errors?: Errors
  readonly allowExternalCallers?: boolean
}

const scheduledParams = <Table extends AnyScheduledTableSpec>(
  table: Table,
): ScheduledParams<Table> =>
  struct({
    data: table.row,
  }) as ScheduledParams<Table>

export const scheduledReducerEndpoint = <
  const Name extends string,
  const Table extends AnyScheduledTableSpec,
  const Errors extends ErrorsInput | undefined = undefined,
>(
  name: Name,
  spec: ScheduledCallableOptions<Table, Errors>,
): ScheduledReducerDecl<Name, Table, DefinitionOfInputOrUndefined<Errors>> => {
  const reducer = defineReducer({
    params: scheduledParams(spec.table),
    errors: spec.errors,
    public: false,
  } as never) as ScheduledReducerSpec<
    Table,
    DefinitionOfInputOrUndefined<Errors>
  >

  return {
    declKind: "reducer",
    name,
    spec: {
      ...reducer,
      scheduled: {
        table: spec.table,
        allowExternalCallers: spec.allowExternalCallers === true,
      },
    },
  }
}

export const scheduledProcedureEndpoint = <
  const Name extends string,
  const Table extends AnyScheduledTableSpec,
  const Errors extends ErrorsInput | undefined = undefined,
>(
  name: Name,
  spec: ScheduledCallableOptions<Table, Errors>,
): ScheduledProcedureDecl<
  Name,
  Table,
  DefinitionOfInputOrUndefined<Errors>
> => {
  const procedure = defineProcedure({
    params: scheduledParams(spec.table),
    returns: unit(),
    errors: spec.errors,
    public: false,
  } as never) as ScheduledProcedureSpec<
    Table,
    DefinitionOfInputOrUndefined<Errors>
  >

  return {
    declKind: "procedure",
    name,
    spec: {
      ...procedure,
      scheduled: {
        table: spec.table,
        allowExternalCallers: spec.allowExternalCallers === true,
      },
    },
  }
}
