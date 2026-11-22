import type { TableCachePolicy } from "./table-cache-policy.ts"

export type CaseConversionPolicy = "none" | "snake_case"

export type ModuleSettings = {
  /** Storage policy for stored tables without their own policy. Defaults to `required_in_memory`. */
  readonly tableCachePolicyDefault?: TableCachePolicy
  readonly caseConversionPolicy?: CaseConversionPolicy
}
