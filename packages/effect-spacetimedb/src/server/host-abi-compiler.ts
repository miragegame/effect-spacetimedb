import * as Data from "effect/Data"

import {
  CaseConversionPolicy,
  makeQueryBuilder,
  isRowTypedQuery,
  Range,
  Router,
  remoteModule,
  SenderError,
  schema,
  t,
  table,
} from "spacetimedb/server"

export {
  CaseConversionPolicy,
  makeQueryBuilder,
  isRowTypedQuery,
  Range,
  Router,
  remoteModule,
  schema,
  SenderError,
  t,
  table,
}

export type { ReceiverIdentity, RemoteReducer } from "spacetimedb/server"

export class StdbHostAbiCapabilityDefect extends Data.TaggedError(
  "StdbHostAbiCapabilityDefect",
)<{
  readonly capability: string
}> {
  override readonly message =
    `Unsupported spacetimedb host ABI: missing or malformed ${this.capability}. effect-spacetimedb currently supports spacetimedb ~2.16.1.`
}

export type CompilerHostAbiShape = {
  readonly CaseConversionPolicy?: unknown
  readonly isRowTypedQuery?: unknown
  readonly Range?: unknown
  readonly Router?: unknown
  readonly remoteModule?: unknown
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
    throw new StdbHostAbiCapabilityDefect({ capability })
  }
}

const assertObjectCapability = (
  shape: CompilerHostAbiShape,
  capability: keyof CompilerHostAbiShape,
): void => {
  if (typeof shape[capability] !== "object" || shape[capability] === null) {
    throw new StdbHostAbiCapabilityDefect({ capability })
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
    throw new StdbHostAbiCapabilityDefect({
      capability: "CaseConversionPolicy",
    })
  }

  assertFunctionCapability(shape, "isRowTypedQuery")
  assertFunctionCapability(shape, "Range")
  assertFunctionCapability(shape, "Router")
  // Inter-database calls: generated receiver bindings build their handles
  // with it, and outbox tables are checked against those handles.
  assertFunctionCapability(shape, "remoteModule")
  assertFunctionCapability(shape, "schema")
  assertFunctionCapability(shape, "SenderError")
  assertObjectCapability(shape, "t")
  assertFunctionCapability(shape, "table")
}

/** Both the Schema constructor and its dispatch method are SDK-instance-local. */
export const assertMountSchema = (
  namespace: string,
  candidate: unknown,
  reference: object,
) => {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !(candidate instanceof reference.constructor)
  ) {
    throw new TypeError(
      `Mount ${namespace} must export a default Schema from the same spacetimedb/server SDK copy as the consumer; resolve the package peer to one instance`,
    )
  }
  if (
    !("buildSubmoduleDispatch" in candidate) ||
    typeof candidate.buildSubmoduleDispatch !== "function"
  ) {
    throw new StdbHostAbiCapabilityDefect({
      capability: "Schema.buildSubmoduleDispatch",
    })
  }
}

// Bump hazards for the next spacetimedb peer-range change:
// - Generate the same mounted client repeatedly. Compare the CLI's namespace
//   imports, registrations and facade entries with orderedNamespaceBindings
//   in codegen/support.ts and verify byte-for-byte stability.
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
  remoteModule,
  schema,
  SenderError,
  t,
  table,
})
