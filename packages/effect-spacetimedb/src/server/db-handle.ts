// lint-ignore: prefer-match-for-literal-union-branching - current branch logic stays local and exhaustive refactor is outside the restack fix.
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { Bound } from "spacetimedb/server"
import {
  addDecodeContext,
  StdbDecodeError,
  type StdbDecodePhase,
} from "../decode-error.ts"
import { fieldOptions } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import { rowType, type AnyTableSpec } from "../contract/table.ts"
import * as Type from "../contract/type.ts"
import { encodeHostValue } from "../contract/type/host-codec.ts"
import type { DbShape } from "./runtime-types.ts"
import {
  type EffectDbView,
  type ReadonlyEffectDbView,
  isStdbHostFailure,
  type StdbHostFailure,
  toHostFailure,
} from "./services.ts"

type RawRecord = Record<PropertyKey, unknown>

type DecodeContext = {
  readonly table?: string
  readonly op?: string
}

// Keep the wrapper input structural; native Range<T> is nominal because of
// private fields, but its bounds are the native bound union.
type RangeLike<T> = {
  readonly from: Bound<T>
  readonly to: Bound<T>
}

type LookupPlan =
  | {
      readonly kind: "unique"
      readonly key: string
      readonly columns: ReadonlyArray<string>
      readonly op: string
      readonly update: boolean
    }
  | {
      readonly kind: "range"
      readonly key: string
      readonly columns: ReadonlyArray<string>
      readonly op: string
    }
  | {
      readonly kind: "point"
      readonly key: string
      readonly columns: ReadonlyArray<string>
      readonly op: string
    }

type TableCodec = {
  readonly context: DecodeContext
  readonly encodeRow: (row: unknown) => unknown
  readonly decodeRow: (row: unknown) => unknown
  readonly encodeLookupPoint: (
    columns: ReadonlyArray<string>,
    value: unknown,
  ) => unknown
  readonly encodeLookupRange: (
    columns: ReadonlyArray<string>,
    value: unknown,
  ) => unknown
}

type TablePlan = {
  readonly key: string
  readonly op: string
  readonly scheduled: boolean
  readonly codec: TableCodec
  readonly lookups: ReadonlyArray<LookupPlan>
}

export type DbHandleFactory<Module extends AnyModuleSpec> = {
  readonly readwrite: (rawDb: DbShape<Module>) => EffectDbView<Module>
  readonly readonly: (rawDb: DbShape<Module>) => ReadonlyEffectDbView<Module>
}

const hostCall = <A>(
  op: string,
  run: () => A,
): Effect.Effect<A, StdbHostFailure> =>
  Effect.try({
    try: run,
    catch: (cause) => toHostFailure(op, cause),
  })

const decodeSync = <A>(run: () => A, context: DecodeContext = {}): A => {
  try {
    return run()
  } catch (cause) {
    throw cause instanceof StdbDecodeError
      ? addDecodeContext(cause, context)
      : new StdbDecodeError({
          phase: "row",
          cause,
          ...context,
        })
  }
}

const decodeCall = <A>(
  run: () => A,
  context: DecodeContext = {},
): Effect.Effect<A, StdbDecodeError> =>
  Effect.try({
    try: () => decodeSync(run, context),
    catch: (cause) =>
      cause instanceof StdbDecodeError
        ? cause
        : new StdbDecodeError({
            phase: "row",
            cause,
            ...context,
          }),
  })

const encodeCall = <A>(
  phase: StdbDecodePhase,
  run: () => A,
  context: DecodeContext = {},
): Effect.Effect<A, StdbDecodeError> =>
  Effect.try({
    try: run,
    catch: (cause) =>
      cause instanceof StdbDecodeError
        ? addDecodeContext(cause, context)
        : new StdbDecodeError({
            phase,
            cause,
            ...context,
          }),
  })

const asRecord = (value: unknown): RawRecord =>
  typeof value === "object" && value !== null
    ? (value as RawRecord)
    : Object.create(null)

const isRangeLike = (value: unknown): value is RangeLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "from" in value &&
  "to" in value

const cloneRangeLike = (
  range: RangeLike<unknown>,
  from: Bound<unknown>,
  to: Bound<unknown>,
): RangeLike<unknown> => {
  const constructor = (range as { readonly constructor?: unknown }).constructor
  if (typeof constructor === "function" && constructor !== Object) {
    return new (
      constructor as new (
        from?: Bound<unknown>,
        to?: Bound<unknown>,
      ) => RangeLike<unknown>
    )(from, to)
  }

  return {
    from,
    to,
  }
}

const callHostMethod = <A>(
  source: RawRecord,
  key: string,
  op: string,
  args: ReadonlyArray<unknown>,
): A => {
  const candidate = source[key]
  if (typeof candidate !== "function") {
    throw new TypeError(`Missing host method at ${op}`)
  }

  return candidate.apply(source, args) as A
}

const mapIteratorStep = (
  step: unknown,
  mapValue: (value: unknown) => unknown,
): unknown => {
  if (typeof step !== "object" || step === null || !("done" in step)) {
    return step
  }

  const iteratorResult = step as IteratorResult<unknown, unknown>
  return (iteratorResult.done ?? false)
    ? iteratorResult
    : {
        done: false,
        value: mapValue(iteratorResult.value),
      }
}

const wrapIteratorObject = (
  iterator: unknown,
  op: string,
  mapValue: (value: unknown) => unknown = (value) => value,
): unknown => {
  if (typeof iterator !== "object" || iterator === null) {
    return iterator
  }

  const rawIterator = iterator as RawRecord
  const wrapped = Object.create(Object.getPrototypeOf(rawIterator)) as RawRecord

  const defineIteratorMethod = (key: "next" | "return" | "throw") => {
    const method = rawIterator[key]
    if (typeof method !== "function") {
      return
    }

    Object.defineProperty(wrapped, key, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: (...args: ReadonlyArray<unknown>) => {
        try {
          return mapIteratorStep(method.apply(rawIterator, args), mapValue)
        } catch (cause) {
          if (cause instanceof StdbDecodeError) {
            throw cause
          }

          throw toHostFailure(`${op}.${key}`, cause)
        }
      },
    })
  }

  defineIteratorMethod("next")
  defineIteratorMethod("return")
  defineIteratorMethod("throw")

  Object.defineProperty(wrapped, Symbol.iterator, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: () => wrapped,
  })

  return Object.freeze(wrapped)
}

const wrapIteratorResult = (
  value: unknown,
  op: string,
  mapValue: (value: unknown) => unknown = (value) => value,
): unknown => {
  if (typeof value !== "object" || value === null) {
    return value
  }

  return typeof (value as RawRecord).next === "function"
    ? wrapIteratorObject(value, op, mapValue)
    : value
}

const closeIterator = (iterator: unknown, op: string): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (typeof iterator !== "object" || iterator === null) {
      return Effect.void
    }

    const method = (iterator as RawRecord).return
    if (typeof method !== "function") {
      return Effect.void
    }

    // Safe streams close by finalizing the native iterator; iterator.throw is
    // reserved for explicit unsafe-iterator consumer errors.
    return Effect.try({
      try: () => {
        method.apply(iterator)
      },
      catch: (cause) => toHostFailure(`${op}.return`, cause),
    }).pipe(
      Effect.catchIf(isStdbHostFailure, (error) =>
        Effect.logWarning(
          `Failed to close SpaceTimeDB iterator at ${error.op}`,
        ),
      ),
    )
  })

const streamIterator = (
  iterator: unknown,
  op: string,
  mapValue: (value: unknown) => unknown = (value) => value,
): Stream.Stream<unknown, StdbHostFailure | StdbDecodeError> =>
  Stream.unwrap(
    Effect.acquireRelease(Effect.succeed(iterator), (current) =>
      closeIterator(current, op),
    ).pipe(
      Effect.map((acquiredIterator) =>
        Stream.unfold(acquiredIterator, (current) => {
          if (typeof current !== "object" || current === null) {
            return Effect.fail(
              toHostFailure(
                `${op}.next`,
                new TypeError(`Missing iterator object at ${op}`),
              ),
            )
          }
          const method = (current as RawRecord).next
          if (typeof method !== "function") {
            return Effect.fail(
              toHostFailure(
                `${op}.next`,
                new TypeError(`Missing iterator next method at ${op}`),
              ),
            )
          }
          return Effect.try({
            try: () => {
              const step = method.apply(current) as IteratorResult<
                unknown,
                unknown
              >
              if (step.done ?? false) {
                return undefined
              }

              return [mapValue(step.value), current] as const
            },
            catch: (cause) =>
              cause instanceof StdbDecodeError
                ? cause
                : toHostFailure(`${op}.next`, cause),
          })
        }),
      ),
    ),
  )

const collectIterator = (
  iterator: unknown,
  op: string,
  mapValue: (value: unknown) => unknown = (value) => value,
): Effect.Effect<ReadonlyArray<unknown>, StdbHostFailure | StdbDecodeError> =>
  streamIterator(iterator, op, mapValue).pipe(
    Stream.runCollect,
    Effect.map((values) => values as ReadonlyArray<unknown>),
  )

const normalizeFindResult = <A>(value: A | null | undefined): A | undefined =>
  value === null ? undefined : value

const firstValue = <A>(values: ReadonlyArray<A>): A | undefined => values[0]

const primaryKeyColumnsOf = (table: AnyTableSpec): ReadonlyArray<string> =>
  Object.entries(table.columns)
    .filter(([, column]) => fieldOptions(column).primaryKey)
    .map(([columnKey]) => columnKey)

const uniqueConstraintColumnsOf = (
  table: AnyTableSpec,
  primaryKeyColumns: ReadonlyArray<string>,
): ReadonlyArray<ReadonlyArray<string>> => [
  ...primaryKeyColumns.map((columnKey) => [columnKey]),
  ...table.constraints
    .filter((constraint) => constraint.kind === "unique")
    .map((constraint) => [...constraint.columns]),
]

const sameColumnSet = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean =>
  left.length === right.length &&
  left.every((column) => right.includes(column)) &&
  right.every((column) => left.includes(column))

const hasUniqueConstraintFor = (
  columns: ReadonlyArray<string>,
  uniqueConstraintColumns: ReadonlyArray<ReadonlyArray<string>>,
): boolean =>
  uniqueConstraintColumns.some((constraintColumns) =>
    sameColumnSet(columns, constraintColumns),
  )

const lookupPlansOf = (
  table: AnyTableSpec,
  tableOp: string,
): ReadonlyArray<LookupPlan> =>
  (() => {
    const primaryKeyColumns = primaryKeyColumnsOf(table)
    const uniqueConstraintColumns = uniqueConstraintColumnsOf(
      table,
      primaryKeyColumns,
    )

    const primaryKeyLookups = primaryKeyColumns.map((columnKey) => ({
      kind: "unique" as const,
      key: columnKey,
      columns: [columnKey],
      op: `${tableOp}.${columnKey}`,
      update: primaryKeyColumns.length === 1,
    }))

    const explicitIndexLookups = table.indexes.map((index) => {
      const unique = hasUniqueConstraintFor(
        index.columns,
        uniqueConstraintColumns,
      )
      const update =
        unique &&
        primaryKeyColumns.length === 1 &&
        index.columns.length === 1 &&
        index.columns[0] === primaryKeyColumns[0]

      if (unique) {
        return {
          kind: "unique" as const,
          key: index.name,
          columns: [...index.columns],
          op: `${tableOp}.${index.name}`,
          update,
        }
      }

      const kind: "point" | "range" =
        index.algorithm === "hash" ? "point" : "range"

      return {
        kind,
        key: index.name,
        columns: [...index.columns],
        op: `${tableOp}.${index.name}`,
      }
    })

    return [...primaryKeyLookups, ...explicitIndexLookups]
  })()

const tableCodecOf = (table: AnyTableSpec, tableOp: string): TableCodec => {
  const fields = table.columns as Record<string, Type.AnyValueType>
  const rowCodec = Type.dbCodec<unknown, unknown>(
    rowType(table) as Type.AnyValueType,
  )
  const context = { table: table.name, op: tableOp } as const

  const fieldSchema = (column: string): Type.AnyValueType => {
    const schema = fields[column]
    if (schema == null) {
      throw new TypeError(`Unknown table column ${column} at ${tableOp}`)
    }
    return schema
  }

  const encodeFieldValue = (column: string, value: unknown): unknown =>
    encodeHostValue(fieldSchema(column), value)

  const encodeRangeBound = (
    column: string,
    bound: Bound<unknown>,
  ): Bound<unknown> =>
    bound.tag === "unbounded"
      ? bound
      : {
          ...bound,
          value: encodeFieldValue(column, bound.value),
        }

  const encodeTermOrRange = (column: string, value: unknown): unknown =>
    isRangeLike(value)
      ? cloneRangeLike(
          value,
          encodeRangeBound(column, value.from),
          encodeRangeBound(column, value.to),
        )
      : encodeFieldValue(column, value)

  const encodeCompositeTuple = (
    columns: ReadonlyArray<string>,
    value: unknown,
    kind: "point" | "range",
  ): ReadonlyArray<unknown> => {
    if (!Array.isArray(value)) {
      throw new TypeError(
        `${tableOp} expected an array value for a composite ${kind} lookup`,
      )
    }

    if (kind === "point" && value.length !== columns.length) {
      throw new TypeError(
        `${tableOp} expected ${columns.length} values for a composite point lookup`,
      )
    }

    if (
      kind === "range" &&
      (value.length === 0 || value.length > columns.length)
    ) {
      throw new TypeError(
        `${tableOp} expected between 1 and ${columns.length} values for a composite range lookup`,
      )
    }

    return value.map((entry, index) =>
      kind === "range" && index === value.length - 1
        ? encodeTermOrRange(columns[index]!, entry)
        : encodeFieldValue(columns[index]!, entry),
    )
  }

  const encodeCompositeObject = (
    columns: ReadonlyArray<string>,
    value: Record<PropertyKey, unknown>,
    kind: "point" | "range",
  ): ReadonlyArray<unknown> => {
    const entries: Array<unknown> = []

    for (const column of columns) {
      if (!Object.hasOwn(value, column)) {
        break
      }
      entries.push(value[column])
    }

    const unknownKeys = Object.keys(value).filter(
      (key) => !columns.includes(key),
    )
    if (unknownKeys.length > 0) {
      throw new TypeError(
        `${tableOp} received unknown composite ${kind} lookup field ${unknownKeys[0]}`,
      )
    }

    if (kind === "point" && entries.length !== columns.length) {
      throw new TypeError(
        `${tableOp} expected fields ${columns.join(", ")} for a composite point lookup`,
      )
    }

    if (kind === "range") {
      if (
        entries.length === 0 ||
        entries.length !== Object.keys(value).length
      ) {
        throw new TypeError(
          `${tableOp} expected a contiguous prefix of fields ${columns.join(", ")} for a composite range lookup`,
        )
      }
    }

    return encodeCompositeTuple(columns, entries, kind)
  }

  const encodeCompositeLookup = (
    columns: ReadonlyArray<string>,
    value: unknown,
    kind: "point" | "range",
  ): unknown =>
    Array.isArray(value)
      ? encodeCompositeTuple(columns, value, kind)
      : typeof value === "object" && value !== null
        ? encodeCompositeObject(columns, value as RawRecord, kind)
        : encodeCompositeTuple(columns, value, kind)

  return {
    context,
    encodeRow: (row) => encodeHostValue(rowType(table), row),
    decodeRow: (row) => {
      try {
        return rowCodec.decodeUnknownSync(row)
      } catch (cause) {
        throw new StdbDecodeError({
          phase: "row",
          cause,
          ...context,
        })
      }
    },
    encodeLookupPoint: (columns, value) =>
      columns.length === 1
        ? encodeFieldValue(columns[0]!, value)
        : encodeCompositeLookup(columns, value, "point"),
    encodeLookupRange: (columns, value) =>
      columns.length === 1
        ? encodeTermOrRange(columns[0]!, value)
        : encodeCompositeLookup(columns, value, "range"),
  }
}

type DbCapabilityMode = "readonly" | "readwrite"

const buildLookup = (
  mode: DbCapabilityMode,
  rawLookup: RawRecord,
  codec: TableCodec,
  plan: LookupPlan,
): Record<string, unknown> => {
  const buildFilteredLookup = (
    encodeLookup: (columns: ReadonlyArray<string>, value: unknown) => unknown,
    options: { readonly deleteAll: boolean },
  ) => {
    const deleteMatches = Effect.fnUntraced(function* (value: unknown) {
      const encodedValue = yield* encodeCall(
        "args",
        () => encodeLookup(plan.columns, value),
        {
          ...codec.context,
          op: plan.op,
        },
      )

      return yield* hostCall(`${plan.op}.delete`, () =>
        callHostMethod(rawLookup, "delete", `${plan.op}.delete`, [
          encodedValue,
        ]),
      )
    })

    return Object.freeze({
      ...(mode === "readwrite"
        ? {
            delete: deleteMatches,
            ...(options.deleteAll ? { deleteAll: deleteMatches } : {}),
          }
        : {}),
      filterStream: (value: unknown) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const encodedValue = yield* encodeCall(
              "args",
              () => encodeLookup(plan.columns, value),
              {
                ...codec.context,
                op: plan.op,
              },
            )

            const iterator = yield* hostCall(`${plan.op}.filter`, () =>
              callHostMethod(rawLookup, "filter", `${plan.op}.filter`, [
                encodedValue,
              ]),
            )

            return streamIterator(iterator, `${plan.op}.filter`, (row) =>
              decodeSync(() => codec.decodeRow(row), {
                ...codec.context,
                op: `${plan.op}.filter`,
              }),
            )
          }),
        ),
      filterToArray: Effect.fnUntraced(function* (value: unknown) {
        const encodedValue = yield* encodeCall(
          "args",
          () => encodeLookup(plan.columns, value),
          {
            ...codec.context,
            op: plan.op,
          },
        )

        const iterator = yield* hostCall(`${plan.op}.filter`, () =>
          callHostMethod(rawLookup, "filter", `${plan.op}.filter`, [
            encodedValue,
          ]),
        )

        return yield* collectIterator(iterator, `${plan.op}.filter`, (row) =>
          decodeSync(() => codec.decodeRow(row), {
            ...codec.context,
            op: `${plan.op}.filter`,
          }),
        )
      }),
      unsafe: Object.freeze({
        filter: Effect.fnUntraced(function* (value: unknown) {
          const encodedValue = yield* encodeCall(
            "args",
            () => encodeLookup(plan.columns, value),
            {
              ...codec.context,
              op: plan.op,
            },
          )

          return yield* hostCall(`${plan.op}.filter`, () =>
            wrapIteratorResult(
              callHostMethod(rawLookup, "filter", `${plan.op}.filter`, [
                encodedValue,
              ]),
              `${plan.op}.filter`,
              (row) => codec.decodeRow(row),
            ),
          )
        }),
      }),
    })
  }

  if (plan.kind === "unique") {
    const find = Effect.fnUntraced(function* (value: unknown) {
      const encodedValue = yield* encodeCall(
        "args",
        () => codec.encodeLookupPoint(plan.columns, value),
        {
          ...codec.context,
          op: plan.op,
        },
      )

      return yield* hostCall(`${plan.op}.find`, () =>
        normalizeFindResult(
          callHostMethod(rawLookup, "find", `${plan.op}.find`, [encodedValue]),
        ),
      ).pipe(
        Effect.flatMap((row) =>
          row === undefined
            ? Effect.void
            : decodeCall(() => codec.decodeRow(row), {
                ...codec.context,
                op: `${plan.op}.find`,
              }),
        ),
      )
    })
    const replace = Effect.fnUntraced(function* (row: unknown) {
      const encodedRow = yield* encodeCall("row", () => codec.encodeRow(row), {
        ...codec.context,
        op: `${plan.op}.update`,
      })

      return yield* hostCall(`${plan.op}.update`, () =>
        callHostMethod(rawLookup, "update", `${plan.op}.update`, [encodedRow]),
      ).pipe(
        Effect.flatMap((nextRow) =>
          decodeCall(() => codec.decodeRow(nextRow), {
            ...codec.context,
            op: `${plan.op}.update`,
          }),
        ),
      )
    })
    const findOrFail = <E>(
      value: unknown,
      makeError: (value: unknown) => E,
    ): Effect.Effect<unknown, E | StdbHostFailure | StdbDecodeError> =>
      Effect.gen(function* () {
        const row = yield* find(value)
        if (row === undefined) {
          return yield* Effect.fail(makeError(value))
        }

        return row
      })

    return Object.freeze({
      find,
      exists: Effect.fnUntraced(function* (value) {
        const row = yield* find(value)
        return row !== undefined
      }),
      findOrFail,
      ...(mode === "readwrite"
        ? {
            delete: Effect.fnUntraced(function* (value) {
              const encodedValue = yield* encodeCall(
                "args",
                () => codec.encodeLookupPoint(plan.columns, value),
                {
                  ...codec.context,
                  op: plan.op,
                },
              )

              return yield* hostCall(`${plan.op}.delete`, () =>
                callHostMethod(rawLookup, "delete", `${plan.op}.delete`, [
                  encodedValue,
                ]),
              )
            }),
            ...(plan.update
              ? {
                  replace,
                  update: replace,
                }
              : {}),
          }
        : {}),
    })
  }

  if (plan.kind === "point") {
    return buildFilteredLookup(codec.encodeLookupPoint, { deleteAll: false })
  }

  if (plan.kind === "range") {
    return buildFilteredLookup(codec.encodeLookupRange, { deleteAll: true })
  }

  const _exhaustive: never = plan
  return _exhaustive
}

const buildBaseTable = (
  rawTable: RawRecord,
  plan: TablePlan,
): Record<string, unknown> =>
  Object.freeze({
    count: Effect.fnUntraced(function* () {
      return yield* hostCall(`${plan.op}.count`, () =>
        callHostMethod(rawTable, "count", `${plan.op}.count`, []),
      )
    }),
    first: Effect.fnUntraced(function* () {
      const iterator = yield* hostCall(`${plan.op}.iter`, () =>
        callHostMethod(rawTable, "iter", `${plan.op}.iter`, []),
      )

      const rows = yield* collectIterator(iterator, `${plan.op}.iter`, (row) =>
        decodeSync(() => plan.codec.decodeRow(row), {
          ...plan.codec.context,
          op: `${plan.op}.iter`,
        }),
      )
      return firstValue(rows)
    }),
    stream: () =>
      Stream.unwrap(
        hostCall(`${plan.op}.iter`, () =>
          callHostMethod(rawTable, "iter", `${plan.op}.iter`, []),
        ).pipe(
          Effect.map((iterator) =>
            streamIterator(iterator, `${plan.op}.iter`, (row) =>
              decodeSync(() => plan.codec.decodeRow(row), {
                ...plan.codec.context,
                op: `${plan.op}.iter`,
              }),
            ),
          ),
        ),
      ),
    toArray: Effect.fnUntraced(function* () {
      const iterator = yield* hostCall(`${plan.op}.iter`, () =>
        callHostMethod(rawTable, "iter", `${plan.op}.iter`, []),
      )

      return yield* collectIterator(iterator, `${plan.op}.iter`, (row) =>
        decodeSync(() => plan.codec.decodeRow(row), {
          ...plan.codec.context,
          op: `${plan.op}.iter`,
        }),
      )
    }),
    unsafe: Object.freeze({
      iter: Effect.fnUntraced(function* () {
        return yield* hostCall(`${plan.op}.iter`, () =>
          wrapIteratorResult(
            callHostMethod(rawTable, "iter", `${plan.op}.iter`, []),
            `${plan.op}.iter`,
            (row) => plan.codec.decodeRow(row),
          ),
        )
      }),
    }),
  })

const buildReadwriteTable = (
  rawTable: RawRecord,
  plan: TablePlan,
): Record<string, unknown> => {
  const insertOne = Effect.fnUntraced(function* (row: unknown) {
    const encodedRow = yield* encodeCall(
      "row",
      () => plan.codec.encodeRow(row),
      {
        ...plan.codec.context,
        op: `${plan.op}.insert`,
      },
    )

    return yield* hostCall(`${plan.op}.insert`, () =>
      callHostMethod(rawTable, "insert", `${plan.op}.insert`, [encodedRow]),
    ).pipe(
      Effect.flatMap((nextRow) =>
        decodeCall(() => plan.codec.decodeRow(nextRow), {
          ...plan.codec.context,
          op: `${plan.op}.insert`,
        }),
      ),
    )
  })

  const tableHandle = {
    ...buildBaseTable(rawTable, plan),
    insert: insertOne,
    insertAll: Effect.fnUntraced(function* (rows: Iterable<unknown>) {
      const inserted: Array<unknown> = []
      for (const row of rows) {
        const nextRow = yield* insertOne(row)
        inserted.push(nextRow)
      }

      return inserted
    }),
    delete: Effect.fnUntraced(function* (row: unknown) {
      const encodedRow = yield* encodeCall(
        "row",
        () => plan.codec.encodeRow(row),
        {
          ...plan.codec.context,
          op: `${plan.op}.delete`,
        },
      )

      return yield* hostCall(`${plan.op}.delete`, () =>
        callHostMethod(rawTable, "delete", `${plan.op}.delete`, [encodedRow]),
      )
    }),
    clear: Effect.fnUntraced(function* () {
      return yield* hostCall(`${plan.op}.clear`, () =>
        callHostMethod(rawTable, "clear", `${plan.op}.clear`, []),
      )
    }),
  } as Record<string, unknown>

  if (plan.scheduled) {
    tableHandle.schedule = Effect.fnUntraced(function* (row: unknown) {
      return yield* insertOne({
        ...asRecord(row),
        scheduledId: 0n,
      })
    })
  }

  for (const lookupPlan of plan.lookups) {
    tableHandle[lookupPlan.key] = buildLookup(
      "readwrite",
      asRecord(rawTable[lookupPlan.key]),
      plan.codec,
      lookupPlan,
    )
  }

  return Object.freeze(tableHandle)
}

const buildReadonlyTable = (
  rawTable: RawRecord,
  plan: TablePlan,
): Record<string, unknown> => {
  const tableHandle = { ...buildBaseTable(rawTable, plan) }

  for (const lookupPlan of plan.lookups) {
    tableHandle[lookupPlan.key] = buildLookup(
      "readonly",
      asRecord(rawTable[lookupPlan.key]),
      plan.codec,
      lookupPlan,
    )
  }

  return Object.freeze(tableHandle)
}

export const makeDbHandleFactory = <Module extends AnyModuleSpec>(
  module: Module,
): DbHandleFactory<Module> => {
  const tablePlans = Object.keys(module.tables).map((tableKey) => {
    const table = module.tables[tableKey] as AnyTableSpec
    const op = `db.${tableKey}`

    return {
      key: tableKey,
      op,
      scheduled: table.scheduled,
      codec: tableCodecOf(table, op),
      lookups: lookupPlansOf(table, op),
    } satisfies TablePlan
  })

  return {
    readwrite: (rawDb) => {
      const dbRecord = asRecord(rawDb)
      const dbHandle = Object.create(null) as Record<string, unknown>

      for (const tablePlan of tablePlans) {
        dbHandle[tablePlan.key] = buildReadwriteTable(
          asRecord(dbRecord[tablePlan.key]),
          tablePlan,
        )
      }

      return dbHandle as EffectDbView<Module>
    },
    readonly: (rawDb) => {
      const dbRecord = asRecord(rawDb)
      const dbHandle = Object.create(null) as Record<string, unknown>

      for (const tablePlan of tablePlans) {
        dbHandle[tablePlan.key] = buildReadonlyTable(
          asRecord(dbRecord[tablePlan.key]),
          tablePlan,
        )
      }

      return dbHandle as ReadonlyEffectDbView<Module>
    },
  }
}
