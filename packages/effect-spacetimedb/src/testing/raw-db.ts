import type { FieldTypeId } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ModuleMount, MountsOf } from "../contract/mount.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import type { HostOf, ValueType } from "../contract/type.ts"
import type { DbShape } from "../server/runtime-types.ts"

export type EncodedTable<Table extends AnyTableSpec> = Omit<
  Table,
  "columns"
> & {
  readonly columns: {
    readonly [Key in keyof Table["columns"]]: ValueType<
      HostOf<Table["columns"][Key]>,
      HostOf<Table["columns"][Key]>
    > &
      Pick<Table["columns"][Key], typeof FieldTypeId>
  }
}

export type EncodedModule<Module extends AnyModuleSpec> = Omit<
  Module,
  "tables"
> & {
  readonly tables: {
    readonly [Key in keyof Module["tables"]]: EncodedTable<
      Module["tables"][Key]
    >
  }
}

/** The SDK-shaped raw store accepts and returns native host column values, including encoded numeric magnitudes. Each Effect mount appears under its accessor key with its own raw table handles. */
export type TestModuleRawDb<Module extends AnyModuleSpec> = DbShape<
  EncodedModule<Module>
> & {
  readonly [K in keyof MountsOf<Module> as MountsOf<Module>[K] extends ModuleMount
    ? K
    : never]: MountsOf<Module>[K] extends ModuleMount<infer Child>
    ? TestModuleRawDb<Child>
    : never
}
