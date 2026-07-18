import type { AnyModuleSpec } from "./contract/module.ts"
import type { TableRow } from "./contract/table.ts"
import type {
  PublicEventTables,
  PublicPersistentTables,
} from "./module-projection.ts"
import type {
  ClientQueryRoot,
  StdbPredicate,
  StdbRowExpr,
} from "./query/types.ts"
import { typedEntries, typedFromEntries } from "./utils.ts"

export type PublicPersistentTableKeys<Module extends AnyModuleSpec> =
  keyof PublicPersistentTables<Module> & string

export type PublicEventTableKeys<Module extends AnyModuleSpec> =
  keyof PublicEventTables<Module> & string

export type PublicTableKeys<Module extends AnyModuleSpec> =
  keyof ClientQueryRoot<Module> & string

type ModuleBrand<Module extends AnyModuleSpec> = {
  readonly __module?: Module
}

export type TableSubscriptionTarget<
  Module extends AnyModuleSpec,
  Key extends
    PublicPersistentTableKeys<Module> = PublicPersistentTableKeys<Module>,
> = ModuleBrand<Module> & {
  readonly kind: "table"
  readonly key: Key
  readonly name: Module["tables"][Key]["name"]
  where(
    predicate: (
      row: StdbRowExpr<Module["tables"][Key]>,
    ) => StdbPredicate<Module["tables"][Key]>,
  ): QuerySubscriptionTarget<Module, Key>
  readonly __row?: TableRow<Module["tables"][Key]>
}

export type EventTableSubscriptionTarget<
  Module extends AnyModuleSpec,
  Key extends PublicEventTableKeys<Module> = PublicEventTableKeys<Module>,
> = ModuleBrand<Module> & {
  readonly kind: "eventTable"
  readonly key: Key
  readonly name: Module["tables"][Key]["name"]
  where(
    predicate: (
      row: StdbRowExpr<Module["tables"][Key]>,
    ) => StdbPredicate<Module["tables"][Key]>,
  ): QuerySubscriptionTarget<Module, Key>
  readonly __row?: TableRow<Module["tables"][Key]>
}

export type QuerySubscriptionTarget<
  Module extends AnyModuleSpec,
  Key extends keyof Module["tables"] & string = PublicTableKeys<Module>,
> = ModuleBrand<Module> & {
  readonly kind: "query"
  readonly key: Key
  readonly name: Module["tables"][Key]["name"]
  readonly predicate: (
    row: StdbRowExpr<Module["tables"][Key]>,
  ) => StdbPredicate<Module["tables"][Key]>
}

export type AllPublicTablesSubscriptionTarget<Module extends AnyModuleSpec> =
  ModuleBrand<Module> & {
    readonly kind: "allPublicTables"
    readonly keys: ReadonlyArray<PublicTableKeys<Module>>
  }

type QuerySubscriptionPredicate<Module extends AnyModuleSpec> = {
  bivarianceHack(
    row: StdbRowExpr<Module["tables"][PublicTableKeys<Module>]>,
  ): StdbPredicate<Module["tables"][PublicTableKeys<Module>]>
}["bivarianceHack"]

type PublicQuerySubscriptionTarget<Module extends AnyModuleSpec> =
  ModuleBrand<Module> & {
    readonly kind: "query"
    readonly key: PublicTableKeys<Module>
    readonly name: Module["tables"][PublicTableKeys<Module>]["name"]
    readonly predicate: QuerySubscriptionPredicate<Module>
  } & {
      readonly [Key in PublicTableKeys<Module>]: QuerySubscriptionTarget<
        Module,
        Key
      >
    }[PublicTableKeys<Module>]

export type SubscriptionTarget<Module extends AnyModuleSpec> =
  | (ModuleBrand<Module> & {
      readonly kind: "table"
      readonly key: PublicPersistentTableKeys<Module>
      readonly name: Module["tables"][PublicPersistentTableKeys<Module>]["name"]
    })
  | (ModuleBrand<Module> & {
      readonly kind: "eventTable"
      readonly key: PublicEventTableKeys<Module>
      readonly name: Module["tables"][PublicEventTableKeys<Module>]["name"]
    })
  | PublicQuerySubscriptionTarget<Module>
  | AllPublicTablesSubscriptionTarget<Module>

/** @internal Stable discriminant view used after the public correlated union is checked. */
export type MatchableSubscriptionTarget<Module extends AnyModuleSpec> =
  | (ModuleBrand<Module> & {
      readonly kind: "table"
      readonly key: PublicPersistentTableKeys<Module>
      readonly name: Module["tables"][PublicPersistentTableKeys<Module>]["name"]
    })
  | (ModuleBrand<Module> & {
      readonly kind: "eventTable"
      readonly key: PublicEventTableKeys<Module>
      readonly name: Module["tables"][PublicEventTableKeys<Module>]["name"]
    })
  | (ModuleBrand<Module> & {
      readonly kind: "query"
      readonly key: PublicTableKeys<Module>
      readonly name: Module["tables"][PublicTableKeys<Module>]["name"]
      readonly predicate: QuerySubscriptionPredicate<Module>
    })
  | AllPublicTablesSubscriptionTarget<Module>

export type ProjectedSubscriptionTargets<Module extends AnyModuleSpec> = {
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
  readonly allPublicTables: () => AllPublicTablesSubscriptionTarget<Module>
}

const makeTableTarget = <
  Module extends AnyModuleSpec,
  Key extends PublicPersistentTableKeys<Module>,
>(
  key: Key,
  name: Module["tables"][Key]["name"],
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
  name: Module["tables"][Key]["name"],
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

export const makeTargetsFromModule = <Module extends AnyModuleSpec>(options: {
  readonly publicTables: PublicPersistentTables<Module>
  readonly publicEventTables: PublicEventTables<Module>
}): ProjectedSubscriptionTargets<Module> => {
  const tables = typedFromEntries(
    typedEntries(options.publicTables).map(([key, tableSpec]) => [
      key,
      makeTableTarget<Module, typeof key>(key, tableSpec.name),
    ]),
  )

  const eventTables = typedFromEntries(
    typedEntries(options.publicEventTables).map(([key, tableSpec]) => [
      key,
      makeEventTableTarget<Module, typeof key>(key, tableSpec.name),
    ]),
  )

  const publicTableKeys = [
    ...typedEntries(options.publicTables).map(([key]) => key),
    ...typedEntries(options.publicEventTables).map(([key]) => key),
  ] as unknown as ReadonlyArray<PublicTableKeys<Module>>

  return {
    tables: tables as unknown as ProjectedSubscriptionTargets<Module>["tables"],
    eventTables:
      eventTables as unknown as ProjectedSubscriptionTargets<Module>["eventTables"],
    allPublicTables: () => ({
      kind: "allPublicTables",
      keys: publicTableKeys,
    }),
  }
}
