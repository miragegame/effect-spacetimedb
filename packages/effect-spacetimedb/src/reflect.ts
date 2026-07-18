import type { AnyModuleSpec } from "./contract/module.ts"

type Entry<
  Kind extends string,
  Name extends string,
  Spec,
  GroupId extends string | undefined = undefined,
> = {
  readonly kind: Kind
  readonly name: Name
  readonly spec: Spec
  readonly groupId: GroupId
}

type Entries<
  Section extends Record<string, unknown>,
  Kind extends string,
  Groups extends Record<string, string> | undefined = undefined,
> = {
  readonly [Name in keyof Section & string]: Entry<
    Kind,
    Name,
    Section[Name],
    Groups extends Record<string, string>
      ? Name extends keyof Groups
        ? Groups[Name]
        : undefined
      : undefined
  >
}[keyof Section & string]

export type TableReflection<Module extends AnyModuleSpec> = Entries<
  Module["tables"],
  "table"
>
export type ViewReflection<Module extends AnyModuleSpec> = Entries<
  Module["views"],
  "view"
>
export type ReducerReflection<Module extends AnyModuleSpec> = Entries<
  Module["reducers"],
  "reducer",
  Module["reducerGroups"]
>
export type ProcedureReflection<Module extends AnyModuleSpec> = Entries<
  Module["procedures"],
  "procedure",
  Module["procedureGroups"]
>
export type HttpHandlerReflection<Module extends AnyModuleSpec> = Entries<
  Module["httpHandlers"],
  "httpHandler",
  Module["httpGroups"]
>
export type LifecycleReflection<Module extends AnyModuleSpec> = Entries<
  Module["lifecycle"],
  "lifecycle"
>

export type ModuleReflection<Module extends AnyModuleSpec> =
  | TableReflection<Module>
  | ViewReflection<Module>
  | ReducerReflection<Module>
  | ProcedureReflection<Module>
  | HttpHandlerReflection<Module>
  | LifecycleReflection<Module>

export type ReflectCallbacks<Module extends AnyModuleSpec> = {
  readonly predicate?: (entry: ModuleReflection<Module>) => boolean
  readonly onTable?: (entry: TableReflection<Module>) => void
  readonly onView?: (entry: ViewReflection<Module>) => void
  readonly onReducer?: (entry: ReducerReflection<Module>) => void
  readonly onProcedure?: (entry: ProcedureReflection<Module>) => void
  readonly onHttpHandler?: (entry: HttpHandlerReflection<Module>) => void
  readonly onLifecycle?: (entry: LifecycleReflection<Module>) => void
}

const groupIdOf = (
  groups: Record<string, string> | undefined,
  name: string,
): string | undefined => groups?.[name]

export const reflect = <Module extends AnyModuleSpec>(
  module: Module,
  callbacks: ReflectCallbacks<Module>,
): void => {
  const visit = <Reflection extends ModuleReflection<Module>>(
    entry: Reflection,
    callback: ((entry: Reflection) => void) | undefined,
  ): void => {
    if (callback !== undefined && (callbacks.predicate?.(entry) ?? true)) {
      callback(entry)
    }
  }

  for (const [name, spec] of Object.entries(module.tables)) {
    visit(
      {
        kind: "table",
        name,
        spec,
        groupId: undefined,
      } as TableReflection<Module>,
      callbacks.onTable,
    )
  }
  for (const [name, spec] of Object.entries(module.views)) {
    visit(
      {
        kind: "view",
        name,
        spec,
        groupId: undefined,
      } as ViewReflection<Module>,
      callbacks.onView,
    )
  }
  for (const [name, spec] of Object.entries(module.reducers)) {
    visit(
      {
        kind: "reducer",
        name,
        spec,
        groupId: groupIdOf(module.reducerGroups, name),
      } as ReducerReflection<Module>,
      callbacks.onReducer,
    )
  }
  for (const [name, spec] of Object.entries(module.procedures)) {
    visit(
      {
        kind: "procedure",
        name,
        spec,
        groupId: groupIdOf(module.procedureGroups, name),
      } as ProcedureReflection<Module>,
      callbacks.onProcedure,
    )
  }
  for (const [name, spec] of Object.entries(module.httpHandlers)) {
    visit(
      {
        kind: "httpHandler",
        name,
        spec,
        groupId: groupIdOf(module.httpGroups, name),
      } as HttpHandlerReflection<Module>,
      callbacks.onHttpHandler,
    )
  }
  for (const [name, spec] of Object.entries(module.lifecycle)) {
    visit(
      {
        kind: "lifecycle",
        name,
        spec,
        groupId: undefined,
      } as LifecycleReflection<Module>,
      callbacks.onLifecycle,
    )
  }
}
