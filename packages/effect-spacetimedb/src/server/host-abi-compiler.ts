
import * as Data from "effect/Data"

import {
  CaseConversionPolicy,
  isRowTypedQuery,
  Range,
  Router,
  SenderError,
  schema,
  t,
  table,
} from "spacetimedb/server"

export {
  CaseConversionPolicy,
  isRowTypedQuery,
  Range,
  Router,
  schema,
  SenderError,
  t,
  table,
}

export class StdbHostAbiCapabilityError extends Data.TaggedError(
  "StdbHostAbiCapabilityError",
)<{
  readonly capability: string
}> {
  override get message(): string {
    return `Unsupported spacetimedb host ABI: missing or malformed ${this.capability}. effect-spacetimedb currently supports spacetimedb ~2.10.1.`
  }
}

export type CompilerHostAbiShape = {
  readonly CaseConversionPolicy?: unknown
  readonly isRowTypedQuery?: unknown
  readonly Range?: unknown
  readonly Router?: unknown
  readonly schema?: unknown
  readonly SenderError?: unknown
  readonly t?: unknown
  readonly table?: unknown
}

const assertFunctionCapability = (
  shape: CompilerHostAbiShape,
  capability: keyof CompilerHostAbiShape,
): void => {
  if (typeof shape[capability] !== "function") {
    throw new StdbHostAbiCapabilityError({ capability })
  }
}

const assertObjectCapability = (
  shape: CompilerHostAbiShape,
  capability: keyof CompilerHostAbiShape,
): void => {
  if (typeof shape[capability] !== "object" || shape[capability] === null) {
    throw new StdbHostAbiCapabilityError({ capability })
  }
}

export const assertCompilerHostAbiCapabilities = (
  shape: CompilerHostAbiShape,
): void => {
  assertObjectCapability(shape, "CaseConversionPolicy")
  const policy = shape.CaseConversionPolicy as {
    readonly None?: unknown
    readonly SnakeCase?: unknown
  }
  if (policy.SnakeCase == null || policy.None == null) {
    throw new StdbHostAbiCapabilityError({
      capability: "CaseConversionPolicy",
    })
  }

  assertFunctionCapability(shape, "isRowTypedQuery")
  assertFunctionCapability(shape, "Range")
  assertFunctionCapability(shape, "Router")
  assertFunctionCapability(shape, "schema")
  assertFunctionCapability(shape, "SenderError")
  assertObjectCapability(shape, "t")
  assertFunctionCapability(shape, "table")
}

// Bump hazards for the next spacetimedb peer-range change:
// - Re-check `UntypedReducerDef.params` (`src/sdk/reducers.ts`); it is
//   unchanged between 2.6.1 and 2.10.1, so the client reducer typing still
//   holds, but it has moved before.
// - Re-check the hand-written bridge types in `compiler-interop.ts` against
//   `spacetimedb/server`: `ReducerCtx`/`ProcedureCtx`/`HandlerContext` gained a
//   required `as` alias member in 2.10.1, `schema()`'s result type always
//   carries `namespaces`, and `procedure()` now returns a `ProcedureExport`.
// - Re-check how schedules are registered. Since 2.7.0 `TableOpts.scheduled`
//   and `TableSchema.schedule` are deprecated in favour of
//   `reducer/procedure({ onSchedule: <table handle> })`; upstream resolves the
//   handle through `tableSourceNames`, so every scheduled table must be
//   registered under exactly one `schema()` key, and `resolveSchedules()` /
//   `registerModuleExports()` silently skip a second pass.
// - Re-run the off-host import-safety tests because this module is the only
//   allowed value edge to `spacetimedb/server`.
// - Re-run the native package tests that cover row-typed query, scheduled
//   target behavior, index uniqueness and composite index ranges before
//   widening the peer range.
assertCompilerHostAbiCapabilities({
  CaseConversionPolicy,
  isRowTypedQuery,
  Range,
  Router,
  schema,
  SenderError,
  t,
  table,
})
