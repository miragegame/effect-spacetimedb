import type { ModulePlan } from "./module-plan.ts"
import {
  nestMembers,
  type NestedMembers,
  type MembersByPath,
} from "./member-path.ts"
import type { AnyModuleSpec } from "./contract/module.ts"
import type { TableRow } from "./contract/table.ts"
import type {
  PublicEventTables,
  PublicPersistentTables,
  PublicViewKeys,
  PublicViews,
  ViewCallArgsOf,
  ViewRowOf,
  ViewTakesArgs,
} from "./module-projection.ts"
import { viewTakesArgs } from "./contract/view.ts"
import type { StdbPredicate, StdbRowExpr } from "./query/types.ts"
import { typedEntries, typedFromEntries } from "./utils.ts"

export type PublicPersistentTableKeys<Module extends AnyModuleSpec> =
  keyof PublicPersistentTables<Module> & string

export type PublicEventTableKeys<Module extends AnyModuleSpec> =
  keyof PublicEventTables<Module> & string

export type PublicTableKeys<Module extends AnyModuleSpec> =
  | PublicPersistentTableKeys<Module>
  | PublicEventTableKeys<Module>

type ModuleBrand<Module extends AnyModuleSpec> = {
  readonly __module?: Module
}

export type TableTargetName<
  M extends AnyModuleSpec,
  K extends keyof MembersByPath<M, "tables"> & string,
> = K extends `${string}.${string}`
  ? string
  : MembersByPath<M, "tables">[K]["name"]

export type TableSubscriptionTarget<
  Module extends AnyModuleSpec,
  Key extends
    PublicPersistentTableKeys<Module> = PublicPersistentTableKeys<Module>,
> = ModuleBrand<Module> & {
  readonly kind: "table"
  readonly key: Key
  readonly name: TableTargetName<Module, Key>
  where(
    predicate: (
      row: StdbRowExpr<MembersByPath<Module, "tables">[Key]>,
    ) => StdbPredicate<MembersByPath<Module, "tables">[Key]>,
  ): QuerySubscriptionTarget<Module, Key>
  readonly __row?: TableRow<MembersByPath<Module, "tables">[Key]>
}

export type EventTableSubscriptionTarget<
  Module extends AnyModuleSpec,
  Key extends PublicEventTableKeys<Module> = PublicEventTableKeys<Module>,
> = ModuleBrand<Module> & {
  readonly kind: "eventTable"
  readonly key: Key
  readonly name: TableTargetName<Module, Key>
  where(
    predicate: (
      row: StdbRowExpr<MembersByPath<Module, "tables">[Key]>,
    ) => StdbPredicate<MembersByPath<Module, "tables">[Key]>,
  ): QuerySubscriptionTarget<Module, Key>
  readonly __row?: TableRow<MembersByPath<Module, "tables">[Key]>
}

/**
 * A subscription to one view. A view that declares params is subscribed to
 * through a call, `SELECT * FROM "name"(args)`; every call a connection holds
 * answers into the view's one client cache, which therefore holds the union
 * of their rows.
 */
export type ViewSubscriptionTarget<
  Module extends AnyModuleSpec,
  Key extends PublicViewKeys<Module> = PublicViewKeys<Module>,
> = ModuleBrand<Module> & {
  readonly kind: "view"
  readonly key: Key
  readonly name: string
  /** The params the arguments encode through; an empty struct without them. */
  readonly params: MembersByPath<Module, "views">[Key]["params"]
  /** The call's arguments; `{}` for a view without params. */
  readonly args: ViewCallArgsOf<MembersByPath<Module, "views">[Key]>
  readonly __row?: ViewRowOf<MembersByPath<Module, "views">[Key]>
}

/**
 * The projected target of a view: the target itself for a view without
 * params, a call building one for a view with them.
 */
export type ViewTargetOf<
  Module extends AnyModuleSpec,
  Key extends PublicViewKeys<Module>,
> = ViewTakesArgs<MembersByPath<Module, "views">[Key]> extends true
  ? (
      args: ViewCallArgsOf<MembersByPath<Module, "views">[Key]>,
    ) => ViewSubscriptionTarget<Module, Key>
  : ViewSubscriptionTarget<Module, Key>

export type QuerySubscriptionTarget<
  Module extends AnyModuleSpec,
  Key extends keyof MembersByPath<Module, "tables"> &
    string = PublicTableKeys<Module>,
> = ModuleBrand<Module> & {
  readonly kind: "query"
  readonly key: Key
  readonly name: TableTargetName<Module, Key>
  readonly predicate: (
    row: StdbRowExpr<MembersByPath<Module, "tables">[Key]>,
  ) => StdbPredicate<MembersByPath<Module, "tables">[Key]>
}

export type AllPublicTablesSubscriptionTarget<Module extends AnyModuleSpec> =
  ModuleBrand<Module> & {
    readonly kind: "allPublicTables"
    readonly names?: Readonly<Record<string, string>>
    readonly keys: ReadonlyArray<PublicTableKeys<Module>>
  }

type QuerySubscriptionPredicate<Module extends AnyModuleSpec> = {
  bivarianceHack(
    row: StdbRowExpr<MembersByPath<Module, "tables">[PublicTableKeys<Module>]>,
  ): StdbPredicate<MembersByPath<Module, "tables">[PublicTableKeys<Module>]>
}["bivarianceHack"]

export type PublicQuerySubscriptionTarget<Module extends AnyModuleSpec> = {
  readonly [Key in PublicTableKeys<Module>]: QuerySubscriptionTarget<
    Module,
    Key
  >
}[PublicTableKeys<Module>]

export type SubscriptionTarget<Module extends AnyModuleSpec> =
  | (ModuleBrand<Module> & {
      readonly kind: "table"
      readonly key: PublicPersistentTableKeys<Module>
      readonly name: string
    })
  | (ModuleBrand<Module> & {
      readonly kind: "eventTable"
      readonly key: PublicEventTableKeys<Module>
      readonly name: string
    })
  | PublicQuerySubscriptionTarget<Module>
  | ViewSubscriptionTarget<Module>
  | AllPublicTablesSubscriptionTarget<Module>

/** @internal Stable discriminant view used after the public correlated union is checked. */
export type MatchableSubscriptionTarget<Module extends AnyModuleSpec> =
  | (ModuleBrand<Module> & {
      readonly kind: "table"
      readonly key: PublicPersistentTableKeys<Module>
      readonly name: string
    })
  | (ModuleBrand<Module> & {
      readonly kind: "eventTable"
      readonly key: PublicEventTableKeys<Module>
      readonly name: string
    })
  | (ModuleBrand<Module> & {
      readonly kind: "query"
      readonly key: PublicTableKeys<Module>
      readonly name: string
      readonly predicate: QuerySubscriptionPredicate<Module>
    })
  | ViewSubscriptionTarget<Module>
  | AllPublicTablesSubscriptionTarget<Module>

export type FlatSubscriptionTargets<Module extends AnyModuleSpec> = {
  readonly tables: {
    readonly [Key in PublicPersistentTableKeys<Module>]: TableSubscriptionTarget<
      Module,
      Key
    >
  }
  readonly eventTables: {
    readonly [Key in PublicEventTableKeys<Module>]: EventTableSubscriptionTarget<
      Module,
      Key
    >
  }
  readonly views: {
    readonly [Key in PublicViewKeys<Module>]: ViewTargetOf<Module, Key>
  }
  readonly allPublicTables: () => AllPublicTablesSubscriptionTarget<Module>
}

const makeTableTarget = <
  Module extends AnyModuleSpec,
  Key extends PublicPersistentTableKeys<Module>,
>(
  key: Key,
  name: TableTargetName<Module, Key>,
): TableSubscriptionTarget<Module, Key> => {
  const where: TableSubscriptionTarget<Module, Key>["where"] = (predicate) => ({
    kind: "query",
    key,
    name,
    predicate,
  })

  return {
    kind: "table",
    key,
    name,
    where,
  }
}

const makeEventTableTarget = <
  Module extends AnyModuleSpec,
  Key extends PublicEventTableKeys<Module>,
>(
  key: Key,
  name: TableTargetName<Module, Key>,
): EventTableSubscriptionTarget<Module, Key> => {
  const where: EventTableSubscriptionTarget<Module, Key>["where"] = (
    predicate,
  ) => ({
    kind: "query",
    key,
    name,
    predicate,
  })

  return {
    kind: "eventTable",
    key,
    name,
    where,
  }
}

const makeViewTarget = <
  Module extends AnyModuleSpec,
  Key extends PublicViewKeys<Module>,
>(
  key: Key,
  name: string,
  params: MembersByPath<Module, "views">[Key]["params"],
): ViewTargetOf<Module, Key> => {
  const call = (
    args: ViewCallArgsOf<MembersByPath<Module, "views">[Key]>,
  ): ViewSubscriptionTarget<Module, Key> => ({
    kind: "view",
    key,
    name,
    params,
    args,
  })
  // Projection boundary: whether the view takes arguments is decided by its
  // params value at runtime, which `ViewTargetOf` decides from its type.
  return (
    viewTakesArgs(params)
      ? call
      : call({} as ViewCallArgsOf<MembersByPath<Module, "views">[Key]>)
  ) as ViewTargetOf<Module, Key>
}

export const makeTargetsFromModule = <Module extends AnyModuleSpec>(options: {
  readonly members: ModulePlan<Module>["members"]
  readonly publicTables: PublicPersistentTables<Module>
  readonly publicEventTables: PublicEventTables<Module>
  readonly publicViews: PublicViews<Module>
}): FlatSubscriptionTargets<Module> => {
  const tables = typedFromEntries(
    typedEntries(options.publicTables).map(([key, tableSpec]) => [
      key,
      makeTableTarget<Module, typeof key>(
        key,
        (key.includes(".")
          ? options.members.tables[key]!.wireName
          : tableSpec.name) as TableTargetName<Module, typeof key>,
      ),
    ]),
  )

  const eventTables = typedFromEntries(
    typedEntries(options.publicEventTables).map(([key, tableSpec]) => [
      key,
      makeEventTableTarget<Module, typeof key>(
        key,
        (key.includes(".")
          ? options.members.tables[key]!.wireName
          : tableSpec.name) as TableTargetName<Module, typeof key>,
      ),
    ]),
  )
  const views = typedFromEntries(
    typedEntries(options.publicViews).map(([key, viewSpec]) => [
      key,
      makeViewTarget<Module, typeof key>(
        key,
        options.members.views[key]!.wireName,
        viewSpec.params as MembersByPath<Module, "views">[typeof key]["params"],
      ),
    ]),
  )

  const publicTableKeys = [
    ...typedEntries(options.publicTables).map(([key]) => key),
    ...typedEntries(options.publicEventTables).map(([key]) => key),
  ] as unknown as ReadonlyArray<PublicTableKeys<Module>>

  const names = publicTableKeys.some((key) => key.includes("."))
    ? Object.fromEntries(
        publicTableKeys.map((key) => [
          key,
          options.members.tables[key]!.wireName,
        ]),
      )
    : undefined
  return {
    tables: tables as unknown as FlatSubscriptionTargets<Module>["tables"],
    eventTables:
      eventTables as unknown as FlatSubscriptionTargets<Module>["eventTables"],
    views: views as unknown as FlatSubscriptionTargets<Module>["views"],
    allPublicTables: () => ({
      kind: "allPublicTables",
      keys: publicTableKeys,
      ...(names === undefined ? {} : { names }),
    }),
  }
}

export type ProjectedSubscriptionTargets<M extends AnyModuleSpec> = {
  readonly tables: NestedMembers<FlatSubscriptionTargets<M>["tables"]>
  readonly eventTables: NestedMembers<FlatSubscriptionTargets<M>["eventTables"]>
  readonly views: NestedMembers<FlatSubscriptionTargets<M>["views"]>
  readonly allPublicTables: FlatSubscriptionTargets<M>["allPublicTables"]
}

export const nestedTargets = <M extends AnyModuleSpec>(
  flat: FlatSubscriptionTargets<M>,
): ProjectedSubscriptionTargets<M> => ({
  tables: nestMembers(flat.tables),
  eventTables: nestMembers(flat.eventTables),
  views: nestMembers(flat.views),
  allPublicTables: flat.allPublicTables,
})
