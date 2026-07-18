import { type AnyTableSpec } from "./contract/table.ts"
import * as Match from "effect/Match"
import * as Type from "./contract/type.ts"
import { encodeHostValue } from "./contract/type/host-codec.ts"
import type { Bound } from "./table-index-typing.ts"
import { cloneRangeLike, isRangeLike, type RangeLike } from "./range-like.ts"

type RawRecord = Record<PropertyKey, unknown>

export type IndexValueCodec = {
  readonly encodePoint: (
    columns: ReadonlyArray<string>,
    value: unknown,
  ) => unknown
  readonly encodeRange: (
    columns: ReadonlyArray<string>,
    value: unknown,
  ) => unknown
}

export type IndexValueCodecOptions = {
  readonly makeRange?: (
    from: Bound<unknown>,
    to: Bound<unknown>,
  ) => RangeLike<unknown>
  readonly rejectFullWidthCompositeRange?: boolean
}

export const indexValueCodecOf = (
  table: AnyTableSpec,
  op: string,
  options: IndexValueCodecOptions = {},
): IndexValueCodec => {
  const fields = table.columns as Record<string, Type.AnyValueType>
  const fieldSchema = (column: string): Type.AnyValueType => {
    const schema = fields[column]
    if (schema === undefined) {
      throw new TypeError(`Unknown table column ${column} at ${op}`)
    }
    return schema
  }
  const encodeField = (column: string, value: unknown): unknown =>
    encodeHostValue(fieldSchema(column), value)
  const encodeBound = (column: string, bound: Bound<unknown>): Bound<unknown> =>
    Match.value(bound).pipe(
      Match.discriminatorsExhaustive("tag")({
        excluded: (value) => ({
          ...value,
          value: encodeField(column, value.value),
        }),
        included: (value) => ({
          ...value,
          value: encodeField(column, value.value),
        }),
        unbounded: (value) => value,
      }),
    )
  const encodeTermOrRange = (column: string, value: unknown): unknown =>
    isRangeLike(value)
      ? cloneRangeLike(
          value,
          encodeBound(column, value.from),
          encodeBound(column, value.to),
          options.makeRange,
        )
      : encodeField(column, value)

  const encodeTuple = (
    columns: ReadonlyArray<string>,
    value: unknown,
    kind: "point" | "range",
  ): ReadonlyArray<unknown> => {
    if (!Array.isArray(value)) {
      throw new TypeError(
        `${op} expected an array value for a composite ${kind} lookup`,
      )
    }
    return Match.value(kind).pipe(
      Match.when("point", () => {
        if (value.length !== columns.length) {
          throw new TypeError(
            `${op} expected ${columns.length} values for a composite point lookup`,
          )
        }
        return value.map((entry, index) => encodeField(columns[index]!, entry))
      }),
      Match.when("range", () => {
        if (value.length === 0 || value.length > columns.length) {
          throw new TypeError(
            `${op} expected between 1 and ${columns.length} values for a composite range lookup`,
          )
        }
        if (
          options.rejectFullWidthCompositeRange === true &&
          value.length === columns.length &&
          isRangeLike(value.at(-1))
        ) {
          throw new TypeError(
            `${op} cannot use a range bound in the final column of a full-width composite lookup because SpaceTimeDB 2.6.1 routes that input as a point scan; use a shorter prefix range or a full point lookup`,
          )
        }
        return value.map((entry, index) =>
          index === value.length - 1
            ? encodeTermOrRange(columns[index]!, entry)
            : encodeField(columns[index]!, entry),
        )
      }),
      Match.exhaustive,
    )
  }

  const encodeObject = (
    columns: ReadonlyArray<string>,
    value: RawRecord,
    kind: "point" | "range",
  ): ReadonlyArray<unknown> => {
    const entries: Array<unknown> = []
    for (const column of columns) {
      if (!Object.hasOwn(value, column)) break
      entries.push(value[column])
    }
    const unknownKeys = Object.keys(value).filter(
      (key) => !columns.includes(key),
    )
    if (unknownKeys.length > 0) {
      throw new TypeError(
        `${op} received unknown composite ${kind} lookup field ${unknownKeys[0]}`,
      )
    }
    Match.value(kind).pipe(
      Match.when("point", () => {
        if (entries.length !== columns.length) {
          throw new TypeError(
            `${op} expected fields ${columns.join(", ")} for a composite point lookup`,
          )
        }
      }),
      Match.when("range", () => {
        if (
          entries.length === 0 ||
          entries.length !== Object.keys(value).length
        ) {
          throw new TypeError(
            `${op} expected a contiguous prefix of fields ${columns.join(", ")} for a composite range lookup`,
          )
        }
      }),
      Match.exhaustive,
    )
    return encodeTuple(columns, entries, kind)
  }

  const encodeComposite = (
    columns: ReadonlyArray<string>,
    value: unknown,
    kind: "point" | "range",
  ): unknown =>
    Array.isArray(value)
      ? encodeTuple(columns, value, kind)
      : typeof value === "object" && value !== null
        ? encodeObject(columns, value as RawRecord, kind)
        : encodeTuple(columns, value, kind)

  return {
    encodePoint: (columns, value) =>
      columns.length === 1
        ? encodeField(columns[0]!, value)
        : encodeComposite(columns, value, "point"),
    encodeRange: (columns, value) =>
      columns.length === 1
        ? encodeTermOrRange(columns[0]!, value)
        : encodeComposite(columns, value, "range"),
  }
}
