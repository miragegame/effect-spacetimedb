import * as Effect from "effect/Effect"

import * as Stream from "effect/Stream"

import { StdbDecodeError } from "../decode-error.ts"

import { type StdbHostFailure } from "./services.ts"

import {
  asRecord,
  callHostMethod,
  collectIterator,
  decodeCall,
  decodeSync,
  encodeCall,
  firstIteratorValue,
  hostCall,
  normalizeFindResult,
  streamIterator,
  wrapIteratorResult,
} from "./db-handle-runtime.ts"

import type { DbCapabilityMode } from "./db-handle-codec.ts"

import type {
  LookupPlan,
  RawRecord,
  TableCodec,
  TablePlan,
} from "./db-handle-runtime.ts"

export const buildLookup = (
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

export const buildBaseTable = (
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

      return yield* firstIteratorValue(iterator, `${plan.op}.iter`, (row) =>
        decodeSync(() => plan.codec.decodeRow(row), {
          ...plan.codec.context,
          op: `${plan.op}.iter`,
        }),
      )
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

export const buildReadwriteTable = (
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

export const buildReadonlyTable = (
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
