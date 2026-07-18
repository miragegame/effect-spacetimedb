import * as SpacetimeDB from "spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"

const runtimeFactories = Reflect.get(SpacetimeDB, "t") as unknown

if (typeof runtimeFactories !== "object" || runtimeFactories === null) {
  throw new Error("spacetimedb runtime does not expose type-builder factories")
}

export const typeBuilder = (
  value: StdbTesting.ContractType.AnyValueType,
  path?: string,
) =>
  StdbTesting.ContractType.typeBuilderWithFactories(
    value,
    runtimeFactories as never,
    path,
  )

export const builderTypeName = (builder: unknown): string | undefined => {
  if (
    (typeof builder !== "object" && typeof builder !== "function") ||
    builder === null
  ) {
    return undefined
  }

  const value = Reflect.get(builder, "typeName")
  return typeof value === "string" ? value : undefined
}
