import * as Schema from "effect/Schema"

export const TableCachePolicySchema = Schema.Literals([
  "required_in_memory",
  "required_on_disk",
  "no_requirement",
])
/**
 * `required_in_memory` keeps every row resident (the default).
 * `required_on_disk` lets the host page cold rows to disk.
 * `no_requirement` lets the host choose placement.
 */
export type TableCachePolicy = typeof TableCachePolicySchema.Type
export const isTableCachePolicy = Schema.is(TableCachePolicySchema)

export const resolveTableCachePolicy = (
  table: {
    readonly event: boolean
    readonly cachePolicy?: TableCachePolicy | undefined
  },
  settings: { readonly tableCachePolicyDefault?: TableCachePolicy },
): TableCachePolicy =>
  table.event
    ? "required_in_memory"
    : (table.cachePolicy ??
      settings.tableCachePolicyDefault ??
      "required_in_memory")
