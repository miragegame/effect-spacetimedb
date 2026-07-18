import * as Data from "effect/Data"
import type * as Duration from "effect/Duration"
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { TableRow } from "../contract/table.ts"
import type { StdbDecodeError } from "../decode-error.ts"
import type { PublicPersistentTableKeys } from "../subscription-target.ts"
import type { SubscriptionFailure } from "./ws-subscription.ts"

export class WaitUntilTimeoutError extends Data.TaggedError(
  "WaitUntilTimeoutError",
)<{
  readonly table: string
  readonly timeoutMillis: number
  readonly lastSnapshotSize: number
}> {}

export type WaitUntilOptions = {
  readonly timeout?: Duration.Input | undefined
  /** Accepted for migration compatibility; waiting is event-driven. */
  readonly interval?: Duration.Input | undefined
}

export type WaitUntil<Module extends AnyModuleSpec> = <
  Key extends PublicPersistentTableKeys<Module>,
>(
  key: Key,
  predicate: (row: TableRow<Module["tables"][Key]>) => boolean,
  options?: WaitUntilOptions,
) => Effect.Effect<
  ReadonlyArray<TableRow<Module["tables"][Key]>>,
  SubscriptionFailure | StdbDecodeError | WaitUntilTimeoutError,
  Scope.Scope
>
