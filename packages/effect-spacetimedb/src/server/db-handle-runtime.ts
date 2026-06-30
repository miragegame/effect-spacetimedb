import * as Effect from "effect/Effect"

import * as Stream from "effect/Stream"

import type { Bound } from "spacetimedb/server"
import { fieldOptions } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import { type AnyTableSpec } from "../contract/table.ts"
import {
  addDecodeContext,
  StdbDecodeError,
  type StdbDecodePhase,
} from "../decode-error.ts"

import type { DbShape } from "./runtime-types.ts"

import {
  type EffectDbView,
  isStdbHostFailure,
  type ReadonlyEffectDbView,
  type StdbHostFailure,
  toHostFailure,
} from "./services.ts"

export type RawRecord = Record<PropertyKey, unknown>

export type DecodeContext = {
  readonly table?: string
  readonly op?: string
}

// Keep the wrapper input structural; native Range<T> is nominal because of
// private fields, but its bounds are the native bound union.
export type RangeLike<T> = {
  readonly from: Bound<T>
  readonly to: Bound<T>
}

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

export type TablePlan = {
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

export const hostCall = <A>(
  op: string,
  run: () => A,
): Effect.Effect<A, StdbHostFailure> =>
  Effect.try({
    try: run,
    catch: (cause) => toHostFailure(op, cause),
  })

export const decodeSync = <A>(run: () => A, context: DecodeContext = {}): A => {
  try {
    return run()
  } catch (cause) {
    throw StdbDecodeError.is(cause)
      ? addDecodeContext(cause, context)
      : new StdbDecodeError({
          phase: "row",
          cause,
          ...context,
        })
  }
}

export const decodeCall = <A>(
  run: () => A,
  context: DecodeContext = {},
): Effect.Effect<A, StdbDecodeError> =>
  Effect.try({
    try: () => decodeSync(run, context),
    catch: (cause) =>
      StdbDecodeError.is(cause)
        ? cause
        : new StdbDecodeError({
            phase: "row",
            cause,
            ...context,
          }),
  })

export const encodeCall = <A>(
  phase: StdbDecodePhase,
  run: () => A,
  context: DecodeContext = {},
): Effect.Effect<A, StdbDecodeError> =>
  Effect.try({
    try: run,
    catch: (cause) =>
      StdbDecodeError.is(cause)
        ? addDecodeContext(cause, context)
        : new StdbDecodeError({
            phase,
            cause,
            ...context,
          }),
  })

export const asRecord = (value: unknown): RawRecord =>
  typeof value === "object" && value !== null
    ? (value as RawRecord)
    : Object.create(null)

export const isRangeLike = (value: unknown): value is RangeLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "from" in value &&
  "to" in value

export const cloneRangeLike = (
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
          if (StdbDecodeError.is(cause)) {
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

export const wrapIteratorResult = (
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

export const closeIterator = (
  iterator: unknown,
  op: string,
): Effect.Effect<void> =>
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

export const streamIterator = (
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
              StdbDecodeError.is(cause)
                ? cause
                : toHostFailure(`${op}.next`, cause),
          })
        }),
      ),
    ),
  )

export const collectIterator = (
  iterator: unknown,
  op: string,
  mapValue: (value: unknown) => unknown = (value) => value,
): Effect.Effect<ReadonlyArray<unknown>, StdbHostFailure | StdbDecodeError> =>
  streamIterator(iterator, op, mapValue).pipe(
    Stream.runCollect,
    Effect.map((values) => values as ReadonlyArray<unknown>),
  )

export const normalizeFindResult = <A>(
  value: A | null | undefined,
): A | undefined => (value === null ? undefined : value)

export const firstValue = <A>(values: ReadonlyArray<A>): A | undefined =>
  values[0]

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

export const sameColumnSet = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean =>
  left.length === right.length &&
  left.every((column) => right.includes(column)) &&
  right.every((column) => left.includes(column))

export const hasUniqueConstraintFor = (
  columns: ReadonlyArray<string>,
  uniqueConstraintColumns: ReadonlyArray<ReadonlyArray<string>>,
): boolean =>
  uniqueConstraintColumns.some((constraintColumns) =>
    sameColumnSet(columns, constraintColumns),
  )
