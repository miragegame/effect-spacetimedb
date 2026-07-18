import * as StdbTesting from "effect-spacetimedb/testing"
import * as SpacetimeDB from "spacetimedb"
import { typeBuilder } from "./type-builder"

type NativeSerializableType = Parameters<
  typeof StdbTesting.ContractType.typeBuilderWithFactories
>[0]

export const algebraicTypeOf = (
  type: NativeSerializableType,
): SpacetimeDB.AlgebraicType => {
  const algebraic = Reflect.get(typeBuilder(type), "algebraicType") as
    | SpacetimeDB.AlgebraicType
    | undefined
  if (algebraic === undefined) {
    throw new Error("Expected native algebraic type")
  }

  return algebraic
}

export const nativeRoundTrip = (
  type: NativeSerializableType,
  value: unknown,
): unknown => {
  const algebraic = algebraicTypeOf(type)
  const writer = new SpacetimeDB.BinaryWriter(16)
  SpacetimeDB.AlgebraicType.makeSerializer(algebraic)(writer, value)
  return SpacetimeDB.AlgebraicType.makeDeserializer(algebraic)(
    new SpacetimeDB.BinaryReader(writer.getBuffer()),
  )
}

export const nativeBytes = (
  type: NativeSerializableType,
  value: unknown,
): Uint8Array => {
  const writer = new SpacetimeDB.BinaryWriter(16)
  SpacetimeDB.AlgebraicType.makeSerializer(algebraicTypeOf(type))(writer, value)
  return writer.getBuffer()
}
