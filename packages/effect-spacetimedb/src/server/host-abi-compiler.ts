
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

export class StdbHostAbiCapabilityError extends Error {
  constructor(readonly capability: string) {
    super(
      `Unsupported spacetimedb host ABI: missing or malformed ${capability}. effect-spacetimedb currently supports spacetimedb ~2.6.1.`,
    )
    this.name = "StdbHostAbiCapabilityError"
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
    throw new StdbHostAbiCapabilityError(capability)
  }
}

const assertObjectCapability = (
  shape: CompilerHostAbiShape,
  capability: keyof CompilerHostAbiShape,
): void => {
  if (typeof shape[capability] !== "object" || shape[capability] === null) {
    throw new StdbHostAbiCapabilityError(capability)
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
    throw new StdbHostAbiCapabilityError("CaseConversionPolicy")
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
// - Re-check `UntypedReducerDef.params`; upstream 2.6/2.7 changed this type.
// - Re-run the off-host import-safety tests because this module is the only
//   allowed value edge to `spacetimedb/server`.
// - Re-run the native package tests that cover row-typed query and scheduled
//   target behavior before widening the peer range.
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
