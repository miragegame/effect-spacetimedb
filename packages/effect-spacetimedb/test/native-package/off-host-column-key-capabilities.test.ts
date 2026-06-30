import * as EffectVitest from "@effect/vitest"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { typeBuilder } from "../helpers/type-builder"

const { describe, expect, it } = EffectVitest

type CapabilityMethod = "primaryKey" | "autoInc"

const hasMethod = (value: unknown, method: CapabilityMethod): boolean =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  typeof Reflect.get(value, method) === "function"

const nativePrimaryKeyCapable = (
  value: StdbTesting.ContractType.AnyValueType,
): boolean => hasMethod(typeBuilder(value), "primaryKey")

const nativeAutoIncCapable = (
  value: StdbTesting.ContractType.AnyValueType,
): boolean => {
  const builder = typeBuilder(value)
  if (!hasMethod(builder, "primaryKey")) {
    return false
  }

  const primaryKeyBuilder = Reflect.apply(
    Reflect.get(builder, "primaryKey") as () => unknown,
    builder,
    [],
  )
  return hasMethod(primaryKeyBuilder, "autoInc")
}

const u32 = Stdb.u32()

const capabilityCases: ReadonlyArray<{
  readonly label: string
  readonly value: StdbTesting.ContractType.AnyValueType
}> = [
  { label: "array", value: Stdb.array(Stdb.u8()) },
  { label: "bigint", value: Stdb.bigint() },
  { label: "bool", value: Stdb.bool() },
  { label: "bytes", value: Stdb.bytes() },
  { label: "connectionId", value: Stdb.connectionId() },
  { label: "custom", value: Stdb.custom(u32.schema, { type: u32 }) },
  { label: "f32", value: Stdb.f32() },
  { label: "f64", value: Stdb.f64() },
  { label: "identity", value: Stdb.identity() },
  { label: "i8", value: Stdb.i8() },
  { label: "i16", value: Stdb.i16() },
  { label: "i32", value: Stdb.i32() },
  { label: "i64", value: Stdb.i64() },
  { label: "i128", value: Stdb.i128() },
  { label: "i256", value: Stdb.i256() },
  { label: "lazy", value: Stdb.lazy(() => u32) },
  { label: "literal boolean", value: Stdb.literal(true, false) },
  { label: "literal number", value: Stdb.literal(1, 2) },
  { label: "literal string", value: Stdb.literal("Open", "Closed") },
  { label: "option", value: Stdb.option(Stdb.u32()) },
  { label: "result", value: Stdb.result(Stdb.u32(), Stdb.string()) },
  { label: "scheduleAt", value: Stdb.scheduleAt() },
  { label: "string", value: Stdb.string() },
  {
    label: "struct",
    value: Stdb.struct({
      value: Stdb.u32(),
    }),
  },
  {
    label: "sum payload",
    value: Stdb.sum({
      Ready: Stdb.unit(),
      Count: Stdb.u32(),
    }),
  },
  { label: "sum unit", value: Stdb.enum("Open", "Closed") },
  { label: "timeDuration", value: Stdb.timeDuration() },
  { label: "timestamp", value: Stdb.timestamp() },
  { label: "u8", value: Stdb.u8() },
  { label: "u16", value: Stdb.u16() },
  { label: "u32", value: Stdb.u32() },
  { label: "u64", value: Stdb.u64() },
  { label: "u128", value: Stdb.u128() },
  { label: "u256", value: Stdb.u256() },
  { label: "unit", value: Stdb.unit() },
  { label: "uuid", value: Stdb.uuid() },
]

describe("column key capability drift", () => {
  it("matches native builder primary key and auto-increment capabilities", () => {
    for (const entry of capabilityCases) {
      expect(
        StdbTesting.ContractType.supportsPrimaryKey(entry.value),
        `${entry.label} primaryKey`,
      ).toBe(nativePrimaryKeyCapable(entry.value))
      expect(
        StdbTesting.ContractType.supportsAutoInc(entry.value),
        `${entry.label} autoInc`,
      ).toBe(nativeAutoIncCapable(entry.value))
    }
  })
})
