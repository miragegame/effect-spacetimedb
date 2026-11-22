import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { fieldOptions } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import { sameIndexColumns } from "../table-index-typing.ts"
import type { OutboxSendContext } from "./outbox.ts"
import type { DbShape } from "./runtime-types.ts"
import {
  type EffectDbView,
  StdbTableOperationDefect,
  StdbUniqueAlreadyExistsError,
  StdbAutoIncOverflowError,
  StdbNoSuchRowError,
  StdbScheduleDelayTooLongError,
  type ReadonlyEffectDbView,
  type DbFailure,
  toHostFailure,
} from "./services.ts"

export {
  cloneRangeLike,
  isRangeLike,
  type RangeLike,
} from "./host-abi-runtime.ts"

export type RawRecord = Record<PropertyKey, unknown>

export type DecodeContext = {
  readonly table: string
  readonly op: string
}

// Keep the wrapper input structural; native Range<T> is nominal because of
// private fields, but its bounds are the native bound union.
export type LookupPlan =
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

export type TableCodec = {
  readonly hasAutoIncrement: boolean
  readonly hasUniqueConstraint: boolean
  readonly scheduled: boolean
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

/** What an outbox table handle needs beyond the generic table plan. */
export type OutboxTablePlan = {
  readonly tableName: string
  readonly row: AnyTableSpec["row"]
  readonly rowBytesMax: number
}

export type TablePlan = {
  readonly key: string
  readonly op: string
  readonly scheduled: boolean
  readonly outbox: OutboxTablePlan | undefined
  readonly codec: TableCodec
  readonly lookups: ReadonlyArray<LookupPlan>
}

export type DbHandleFactory<Module extends AnyModuleSpec> = {
  /**
   * `send` is the transaction an outbox insert stamps and checks its target
   * against. Without it (an HTTP handler transaction) an outbox insert dies:
   * calls are sent only from reducers and procedure transactions.
   */
  readonly readwrite: (
    rawDb: DbShape<Module>,
    send?: OutboxSendContext,
  ) => EffectDbView<Module>
  readonly readonly: (rawDb: DbShape<Module>) => ReadonlyEffectDbView<Module>
}

const tableSync = <A>(table: string, op: string, run: () => A): A => {
  try {
    return run()
  } catch (cause) {
    throw new StdbTableOperationDefect({ table, op, cause })
  }
}

export const tableCall = <A>(table: string, op: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new StdbTableOperationDefect({ table, op, cause }),
  }).pipe(Effect.orDie)

export const writeCall = <A>(
  codec: TableCodec,
  op: string,
  method: "insert" | "update",
  run: () => A,
): Effect.Effect<A, DbFailure> =>
  Effect.try({ try: run, catch: (cause) => toHostFailure(op, cause) }).pipe(
    Effect.catch((error): Effect.Effect<never, DbFailure> => {
      if (
        (StdbUniqueAlreadyExistsError.is(error) && codec.hasUniqueConstraint) ||
        (StdbAutoIncOverflowError.is(error) && codec.hasAutoIncrement) ||
        (StdbNoSuchRowError.is(error) && method === "update") ||
        (StdbScheduleDelayTooLongError.is(error) && codec.scheduled)
      )
        return Effect.fail(error)
      return Effect.die(
        new StdbTableOperationDefect({
          table: codec.context.table,
          op,
          cause: error.cause,
        }),
      )
    }),
  )

export const asRecord = (value: unknown): RawRecord =>
  typeof value === "object" && value !== null
    ? (value as RawRecord)
    : Object.create(null)

export const callHostMethod = <A>(
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

export const mapIteratorStep = (
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

export const wrapIteratorObject = (
  iterator: unknown,
  table: string,
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
        return tableSync(table, `${op}.${key}`, () =>
          mapIteratorStep(method.apply(rawIterator, args), mapValue),
        )
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

export const wrapIteratorResult = (
  value: unknown,
  table: string,
  op: string,
  mapValue: (value: unknown) => unknown = (value) => value,
): unknown => {
  if (typeof value !== "object" || value === null) {
    return value
  }

  return typeof (value as RawRecord).next === "function"
    ? wrapIteratorObject(value, table, op, mapValue)
    : value
}

const closeIterator = (iterator: unknown, table: string, op: string) =>
  tableCall(table, `${op}.return`, () => {
    const method = asRecord(iterator).return
    if (typeof method === "function") method.apply(iterator)
  })

const nextRow = (
  iterator: unknown,
  table: string,
  op: string,
  decode: (value: unknown) => unknown,
) =>
  tableCall(table, `${op}.next`, () => {
    const step = callHostMethod<IteratorResult<unknown>>(
      asRecord(iterator),
      "next",
      `${op}.next`,
      [],
    )
    return step.done ? undefined : ([decode(step.value), iterator] as const)
  })

export const streamIterator = (
  iterator: unknown,
  table: string,
  op: string,
  decode: (value: unknown) => unknown,
): Stream.Stream<unknown> =>
  Stream.unwrap(
    Effect.acquireRelease(Effect.succeed(iterator), (current) =>
      closeIterator(current, table, op),
    ).pipe(
      Effect.map((acquired) =>
        Stream.unfold(acquired, (current) =>
          nextRow(current, table, op, decode),
        ),
      ),
    ),
  )

export const iteratorValueFirst = (
  iterator: unknown,
  table: string,
  op: string,
  decode: (value: unknown) => unknown,
) =>
  Effect.acquireUseRelease(
    Effect.succeed(iterator),
    (current) =>
      nextRow(current, table, op, decode).pipe(Effect.map((step) => step?.[0])),
    (current) => closeIterator(current, table, op),
  )

export const normalizeFindResult = <A>(
  value: A | null | undefined,
): A | undefined => (value === null ? undefined : value)

export const primaryKeyColumnsOf = (
  table: AnyTableSpec,
): ReadonlyArray<string> =>
  Object.entries(table.columns)
    .filter(([, column]) => fieldOptions(column).primaryKey)
    .map(([columnKey]) => columnKey)

export const uniqueConstraintColumnsOf = (
  table: AnyTableSpec,
  primaryKeyColumns: ReadonlyArray<string>,
): ReadonlyArray<ReadonlyArray<string>> => [
  ...primaryKeyColumns.map((columnKey) => [columnKey]),
  ...table.constraints
    .filter((constraint) => constraint.kind === "unique")
    .map((constraint) => [...constraint.columns]),
]

export const hasUniqueConstraintFor = (
  columns: ReadonlyArray<string>,
  uniqueConstraintColumns: ReadonlyArray<ReadonlyArray<string>>,
): boolean =>
  uniqueConstraintColumns.some((constraintColumns) =>
    sameIndexColumns(columns, constraintColumns),
  )
