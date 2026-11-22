import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { identityKey } from "./host-abi-runtime.ts"
import { OutboxRowTooLargeError } from "../contract/outbox-table.ts"
import {
  hostValueBsatnBytes,
  OutboxSelfTargetDefect,
  type OutboxSendContext,
  OutboxSendOutsideMutationDefect,
} from "./outbox.ts"
import {
  asRecord,
  callHostMethod,
  tableCall,
  writeCall,
  iteratorValueFirst,
  normalizeFindResult,
  streamIterator,
  wrapIteratorResult,
} from "./db-handle-runtime.ts"
import type { DbCapabilityMode } from "./db-handle-codec.ts"
import type {
  LookupPlan,
  OutboxTablePlan,
  RawRecord,
  TableCodec,
  TablePlan,
} from "./db-handle-runtime.ts"

const writeRow = (
  raw: RawRecord,
  codec: TableCodec,
  op: string,
  method: "insert" | "update",
  encoded: unknown,
) =>
  writeCall(codec, op, method, () =>
    callHostMethod(raw, method, op, [encoded]),
  ).pipe(
    Effect.flatMap((row) =>
      tableCall(codec.context.table, op, () => codec.decodeRow(row)),
    ),
  )

const iteratorReads = (
  table: string,
  op: string,
  open: () => unknown,
  decode: (row: unknown) => unknown,
) => {
  const iterator = tableCall(table, op, open)
  const stream = () =>
    Stream.unwrap(
      Effect.map(iterator, (value) => streamIterator(value, table, op, decode)),
    )
  return {
    stream,
    toArray: () => Stream.runCollect(stream()),
    first: () =>
      Effect.flatMap(iterator, (value) =>
        iteratorValueFirst(value, table, op, decode),
      ),
    unsafe: () =>
      tableCall(table, op, () => wrapIteratorResult(open(), table, op, decode)),
  }
}

export const buildLookup = (
  mode: DbCapabilityMode,
  rawLookup: RawRecord,
  codec: TableCodec,
  plan: LookupPlan,
): Record<string, unknown> => {
  const table = codec.context.table
  const encode =
    plan.kind === "range" ? codec.encodeLookupRange : codec.encodeLookupPoint
  const lookup = (method: string, value: unknown) =>
    callHostMethod(rawLookup, method, `${plan.op}.${method}`, [
      encode(plan.columns, value),
    ])
  const remove = (value: unknown) =>
    tableCall(table, `${plan.op}.delete`, () => lookup("delete", value))
  const mutation = mode === "readwrite" ? { delete: remove } : {}
  if (plan.kind === "unique") {
    const find = (value: unknown) =>
      tableCall(table, `${plan.op}.find`, () => {
        const row = normalizeFindResult(lookup("find", value))
        return row === undefined ? undefined : codec.decodeRow(row)
      })
    const update = (row: unknown) => {
      const op = `${plan.op}.update`
      return Effect.flatMap(
        tableCall(table, op, () => codec.encodeRow(row)),
        (encoded) => writeRow(rawLookup, codec, op, "update", encoded),
      )
    }
    return Object.freeze({
      find,
      exists: (value: unknown) =>
        Effect.map(find(value), (row) => row !== undefined),
      findOrFail: <E>(value: unknown, makeError: (value: unknown) => E) =>
        Effect.flatMap(find(value), (row) =>
          row === undefined
            ? Effect.fail(makeError(value))
            : Effect.succeed(row),
        ),
      ...mutation,
      ...(mode === "readwrite" && plan.update ? { update } : {}),
    })
  }
  const reads = (value: unknown) =>
    iteratorReads(
      table,
      `${plan.op}.filter`,
      () => lookup("filter", value),
      codec.decodeRow,
    )
  return Object.freeze({
    ...mutation,
    filterStream: (value: unknown) => reads(value).stream(),
    filterToArray: (value: unknown) => reads(value).toArray(),
    unsafe: Object.freeze({
      filter: (value: unknown) => reads(value).unsafe(),
    }),
  })
}

export const buildBaseTable = (
  rawTable: RawRecord,
  plan: TablePlan,
): Record<string, unknown> => {
  const table = plan.codec.context.table
  const op = `${plan.op}.iter`
  const reads = iteratorReads(
    table,
    op,
    () => callHostMethod(rawTable, "iter", op, []),
    plan.codec.decodeRow,
  )
  return Object.freeze({
    count: () =>
      tableCall(table, `${plan.op}.count`, () =>
        callHostMethod(rawTable, "count", `${plan.op}.count`, []),
      ),
    first: reads.first,
    stream: reads.stream,
    toArray: reads.toArray,
    unsafe: Object.freeze({ iter: reads.unsafe }),
  })
}

export const buildReadwriteTable = (
  rawTable: RawRecord,
  plan: TablePlan,
): Record<string, unknown> => {
  const table = plan.codec.context.table
  const op = `${plan.op}.insert`
  const insertOne = (row: unknown) =>
    Effect.flatMap(
      tableCall(table, op, () => plan.codec.encodeRow(row)),
      (encoded) => writeRow(rawTable, plan.codec, op, "insert", encoded),
    )

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
    delete: (row: unknown) =>
      tableCall(table, `${plan.op}.delete`, () =>
        callHostMethod(rawTable, "delete", `${plan.op}.delete`, [
          plan.codec.encodeRow(row),
        ]),
      ),
    clear: () =>
      tableCall(table, `${plan.op}.clear`, () =>
        callHostMethod(rawTable, "clear", `${plan.op}.clear`, []),
      ),
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

/**
 * An outbox's handle: reads and read-only lookups, plus an `insert` that fills
 * `msgId` (auto-increment) and `enqueuedAt` (the sending transaction's time),
 * refuses a row whose encoded size is over the outbox bound, and dies on a row
 * addressed to this database. No update, delete or clear: the host owns a row
 * from insert until its settle reducer runs.
 */
export const buildOutboxTable = (
  rawTable: RawRecord,
  plan: TablePlan,
  outbox: OutboxTablePlan,
  send: OutboxSendContext | undefined,
): Record<string, unknown> => {
  const insert = Effect.fnUntraced(function* (input: unknown) {
    if (send === undefined) {
      return yield* Effect.die(
        new OutboxSendOutsideMutationDefect({ table: outbox.tableName }),
      )
    }

    const row = asRecord(input)
    const targetKey = identityKey(row.target)
    if (
      targetKey !== undefined &&
      targetKey === identityKey(send.databaseIdentity)
    ) {
      return yield* Effect.die(
        new OutboxSelfTargetDefect({
          table: outbox.tableName,
          target: targetKey,
        }),
      )
    }

    const encodedRow = yield* tableCall(
      outbox.tableName,
      `${plan.op}.insert`,
      () =>
        plan.codec.encodeRow({
          ...row,
          msgId: 0n,
          enqueuedAt: send.timestamp,
        }),
    )
    const rowBytes = hostValueBsatnBytes(outbox.row, encodedRow)
    if (rowBytes > outbox.rowBytesMax) {
      return yield* new OutboxRowTooLargeError({
        table: outbox.tableName,
        rowBytes,
        rowBytesMax: outbox.rowBytesMax,
      })
    }

    return yield* writeRow(
      rawTable,
      plan.codec,
      `${plan.op}.insert`,
      "insert",
      encodedRow,
    )
  })

  const tableHandle: Record<string, unknown> = {
    ...buildBaseTable(rawTable, plan),
    insert,
  }
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
