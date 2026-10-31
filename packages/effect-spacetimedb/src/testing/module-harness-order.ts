import * as Match from "effect/Match"
import { deepEqual } from "spacetimedb"
import type { AnyFieldType } from "../contract/field.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import { type AnyValueType, type TypeKind, typeInfo } from "../contract/type.ts"

/*
 * How the test module harness orders and range-matches index scans: the
 * SpacetimeDB SATS order over each column's value kind, so harness scans
 * return rows in the order the host's B-tree indexes would.
 */

const comparisonKindOf = (
  valueType: AnyValueType,
  seen = new WeakSet<object>(),
): TypeKind | undefined => {
  if (seen.has(valueType)) return undefined
  seen.add(valueType)
  const info = typeInfo(valueType)
  if (info === undefined) return undefined
  return Match.value(info.kind).pipe(
    Match.when(Match.is("custom", "option"), (kind) =>
      info.item !== undefined ? comparisonKindOf(info.item, seen) : kind,
    ),
    Match.when("lazy", (kind) =>
      info.lazy !== undefined ? comparisonKindOf(info.lazy(), seen) : kind,
    ),
    Match.when(
      Match.is(
        "array",
        "bigint",
        "bool",
        "bytes",
        "connectionId",
        "f32",
        "f64",
        "i8",
        "i16",
        "i32",
        "i64",
        "i128",
        "i256",
        "identity",
        "literal",
        "result",
        "scheduleAt",
        "string",
        "struct",
        "sum",
        "timeDuration",
        "timestamp",
        "u8",
        "u16",
        "u32",
        "u64",
        "u128",
        "u256",
        "unit",
        "uuid",
      ),
      (kind) => kind,
    ),
    Match.exhaustive,
  )
}

const ownBigInt = (value: unknown, key: string): bigint | undefined => {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined
  }
  const candidate = Reflect.get(value, key)
  return typeof candidate === "bigint" ? candidate : undefined
}

const nativeScalarBigIntKeys: Partial<Record<TypeKind, string>> = {
  connectionId: "__connection_id__",
  identity: "__identity__",
  timeDuration: "__time_duration_micros__",
  timestamp: "__timestamp_micros_since_unix_epoch__",
  uuid: "__uuid__",
}

const nativeScalarBigInt = (
  kind: TypeKind | undefined,
  value: unknown,
): bigint | undefined => {
  if (kind === undefined) return undefined
  const bigintKey = nativeScalarBigIntKeys[kind]
  return bigintKey === undefined ? undefined : ownBigInt(value, bigintKey)
}

const orderableComparisonKinds: ReadonlySet<TypeKind> = new Set([
  "bigint",
  "bool",
  "bytes",
  "connectionId",
  "f32",
  "f64",
  "i8",
  "i16",
  "i32",
  "i64",
  "i128",
  "i256",
  "identity",
  "literal",
  "string",
  "timeDuration",
  "timestamp",
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "u256",
  "uuid",
])

const compareBigInt = (left: bigint, right: bigint): number =>
  left < right ? -1 : left > right ? 1 : 0

const compareBytes = (left: Uint8Array, right: Uint8Array): number => {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const comparison = (left[index] ?? 0) - (right[index] ?? 0)
    if (comparison !== 0) return comparison < 0 ? -1 : 1
  }
  return left.length < right.length ? -1 : left.length > right.length ? 1 : 0
}

const compareScalar = (
  field: AnyFieldType,
  left: unknown,
  right: unknown,
): number => {
  const kind = comparisonKindOf(field)
  if (kind === undefined || !orderableComparisonKinds.has(kind)) {
    throw new TypeError(
      `Test module harness cannot order ${kind ?? "unknown"} range values`,
    )
  }
  if (deepEqual(left, right)) return 0
  // SpacetimeDB encodes Option as Some | None, in that variant order.
  // Consequently every present value sorts before an absent one.
  if (left === undefined || left === null) return 1
  if (right === undefined || right === null) return -1

  const leftNative = nativeScalarBigInt(kind, left)
  const rightNative = nativeScalarBigInt(kind, right)
  if (leftNative !== undefined && rightNative !== undefined) {
    return compareBigInt(leftNative, rightNative)
  }
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return compareBytes(left, right)
  }
  if (typeof left === "bigint" && typeof right === "bigint") {
    return compareBigInt(left, right)
  }
  if (typeof left === "number" && typeof right === "number") {
    return left < right ? -1 : left > right ? 1 : 0
  }
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return left === right ? 0 : left ? 1 : -1
  }
  throw new TypeError(`Test module harness cannot order ${kind} range values`)
}

export const compareRowsByColumns = (
  table: AnyTableSpec,
  columns: ReadonlyArray<string>,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number => {
  for (const column of columns) {
    const comparison = compareScalar(
      table.columns[column]!,
      left[column],
      right[column],
    )
    if (comparison !== 0) return comparison
  }
  return 0
}

export const matchesRange = (
  row: Record<string, unknown>,
  table: AnyTableSpec,
  columns: ReadonlyArray<string>,
  input: unknown,
): boolean => {
  const values = Array.isArray(input) ? input : [input]
  const prefixLength = Math.max(0, values.length - 1)
  for (let index = 0; index < prefixLength; index++) {
    if (!deepEqual(row[columns[index]!], values[index])) return false
  }
  const term = values.at(-1)
  const rowValue = row[columns[prefixLength]!]
  if (
    typeof term === "object" &&
    term !== null &&
    "from" in term &&
    "to" in term
  ) {
    const range = term as {
      readonly from: { readonly tag: string; readonly value?: unknown }
      readonly to: { readonly tag: string; readonly value?: unknown }
    }
    const field = table.columns[columns[prefixLength]!]!
    if (range.from.tag !== "unbounded") {
      const comparison = compareScalar(field, rowValue, range.from.value)
      if (comparison < 0) return false
      if (comparison === 0 && range.from.tag === "excluded") {
        return false
      }
    }
    if (range.to.tag !== "unbounded") {
      const comparison = compareScalar(field, rowValue, range.to.value)
      if (comparison > 0) return false
      if (comparison === 0 && range.to.tag === "excluded") {
        return false
      }
    }
    return true
  }
  return deepEqual(rowValue, term)
}
