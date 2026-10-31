import * as Data from "effect/Data"
import * as Match from "effect/Match"
import { ConnectionId, deepEqual, Identity, Timestamp, Uuid } from "spacetimedb"
import { type FieldTypeId, fieldOptions } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import { outboxMetadataOf } from "../contract/outbox-table.ts"
import type { AnyTableSpec, TableRow } from "../contract/table.ts"
import type { HostOf, ValueType } from "../contract/type.ts"
import type { ServerQueryRoot } from "../query/types.ts"
import { makeDbHandleFactory } from "../server/db-handle.ts"
import { lookupPlansOf, tableCodecOf } from "../server/db-handle-codec.ts"
import { SpacetimeHostErrors } from "../server/host-errors.ts"
import { identityKey } from "../server/host-abi-runtime.ts"
import {
  type BaseReducerCtx,
  type DbShape,
  type HttpHandlerCtxLike,
  ProcedureClockNow,
  type ProcedureCtxLike,
  type ServerAnonymousViewCtx,
  type ServerEnvironmentReader,
  type ServerRandom,
  type ServerSenderAuth,
  type ServerSenderViewCtx,
} from "../server/runtime-types.ts"
import type { EffectDbView } from "../server/services.ts"
import type { RawProcedureHttp } from "../server/services.ts"
import {
  makeTestModuleEnvironment,
  type TestModuleEnvironmentUpdate,
  type TestModuleEnvironmentValues,
} from "./module-environment.ts"
import { compareRowsByColumns, matchesRange } from "./module-harness-order.ts"
import { TestHarnessTransaction } from "./transaction.ts"

export class NestedTestTransactionError extends Data.TaggedError(
  "NestedTestTransactionError",
) {}

/**
 * The seam the in-memory inter-database pump settles through: it removes one
 * outbox row, as the host does after the row's settle reducer ran. Outbox
 * handles themselves expose no delete.
 */
export const TestHarnessOutboxRemove = Symbol.for(
  "effect-spacetimedb/testing/TestHarnessOutboxRemove",
)

/** Table keys of the module's outboxes. */
export type OutboxTableKeys<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["tables"] &
    string]: Module["tables"][Key] extends {
    readonly outbox: object
  }
    ? Key
    : never
}[keyof Module["tables"] & string]

type MutableStore = Map<string, Array<Record<string, unknown>>>

/**
 * The sender auth the host gives a transaction that presented no JWT: internal
 * exactly when the sender is the database itself (SpacetimeDB 2.14), the same
 * comparison the compiled scheduler guard makes.
 */
const unauthenticatedSenderAuth = (context: {
  readonly sender: unknown
  readonly databaseIdentity: unknown
}): ServerSenderAuth => {
  const senderKey = identityKey(context.sender)
  return senderKey !== undefined &&
    senderKey === identityKey(context.databaseIdentity)
    ? { isInternal: true, hasJWT: false, jwt: null }
    : { isInternal: false, hasJWT: false, jwt: null }
}

type HarnessOverrides<Ctx> = Partial<Omit<Ctx, "db" | "from" | "withTx">>
type ProcedureHarnessOverrides<Module extends AnyModuleSpec> = HarnessOverrides<
  ProcedureCtxLike<Module>
> & {
  readonly transaction?: HarnessOverrides<BaseReducerCtx<Module>> | undefined
}

type EncodedTable<Table extends AnyTableSpec> = Omit<Table, "columns"> & {
  readonly columns: {
    readonly [Key in keyof Table["columns"]]: ValueType<
      HostOf<Table["columns"][Key]>,
      HostOf<Table["columns"][Key]>
    > &
      Pick<Table["columns"][Key], typeof FieldTypeId>
  }
}

type EncodedModule<Module extends AnyModuleSpec> = Omit<Module, "tables"> & {
  readonly tables: {
    readonly [Key in keyof Module["tables"]]: EncodedTable<
      Module["tables"][Key]
    >
  }
}

/** The SDK-shaped raw store accepts and returns native host column values (including encoded numeric magnitudes). */
export type TestModuleRawDb<Module extends AnyModuleSpec> = DbShape<
  EncodedModule<Module>
>

export type TestModuleHarness<Module extends AnyModuleSpec> = {
  readonly db: TestModuleRawDb<Module>
  readonly effectDb: EffectDbView<Module>
  /** This database's identity: every context's `databaseIdentity`. */
  readonly databaseIdentity: Identity
  /**
   * The rows waiting in an outbox, decoded, oldest first. A row stays until a
   * pump delivers it and its settle reducer runs.
   */
  readonly outboxRows: <Key extends OutboxTableKeys<Module>>(
    key: Key,
  ) => ReadonlyArray<TableRow<Module["tables"][Key]>>
  readonly [TestHarnessOutboxRemove]: (key: string, msgId: bigint) => void
  /**
   * The reader every harness context carries as `ctx.env`, with host
   * semantics: a declared key returns its value or `null`, an undeclared key
   * throws. Pass it to `SpacetimeSysStub.withEnvironment` to back the stub's
   * `env_get` while compiled SDK code runs off-host.
   */
  readonly environment: ServerEnvironmentReader
  /**
   * Applies an environment-only update, validated atomically: an invalid
   * result throws `TestModuleEnvironmentError` and leaves the values unchanged.
   * The next read in any context sees the new values.
   */
  readonly updateEnvironment: (
    values: TestModuleEnvironmentUpdate<Module>,
  ) => void
  /**
   * Returns the database to the state the harness was built in: every table
   * empty, auto-increment sequences and the uuid counter restarted, the random
   * stream reseeded. The environment keeps its current values, and write
   * observers are not told about the cleared rows. A rolled-back transaction
   * restores rows but not sequences, uuids or randomness, so a suite that
   * needs a fresh database per call resets rather than relying on rollback,
   * and a reset skips the per-table setup that building a new harness repeats.
   */
  readonly reset: () => void
  readonly makeMutationCtx: (
    overrides?: HarnessOverrides<BaseReducerCtx<Module>>,
  ) => BaseReducerCtx<Module>
  readonly makeProcedureCtx: (
    overrides?: ProcedureHarnessOverrides<Module>,
  ) => ProcedureCtxLike<Module>
  readonly makeHttpHandlerCtx: (
    overrides?: HarnessOverrides<HttpHandlerCtxLike<Module>>,
  ) => HttpHandlerCtxLike<Module>
  readonly makeViewCtx: (
    overrides?: HarnessOverrides<ServerSenderViewCtx<Module>>,
  ) => ServerSenderViewCtx<Module>
  readonly makeAnonymousViewCtx: (
    overrides?: HarnessOverrides<ServerAnonymousViewCtx<Module>>,
  ) => ServerAnonymousViewCtx<Module>
}

const makeRandom = (initialSeed: bigint): ServerRandom => {
  let state = initialSeed & 0xffff_ffff_ffff_ffffn
  const next = () => {
    state ^= state << 13n
    state ^= state >> 7n
    state ^= state << 17n
    state &= 0xffff_ffff_ffff_ffffn
    return state
  }
  const random = (() =>
    Number(next() >> 11n) / 9_007_199_254_740_992) as ServerRandom
  random.uint32 = () => Number(next() & 0xffff_ffffn)
  random.integerInRange = (min, max) =>
    min + (random.uint32() % (max - min + 1))
  random.bigintInRange = (min, max) => min + (next() % (max - min + 1n))
  random.fill = <
    T extends
      | Int8Array
      | Uint8Array
      | Uint8ClampedArray
      | Int16Array
      | Uint16Array
      | Int32Array
      | Uint32Array
      | BigInt64Array
      | BigUint64Array,
  >(
    array: T,
  ): T => {
    for (let index = 0; index < array.length; index++) {
      if (array instanceof BigInt64Array || array instanceof BigUint64Array) {
        array[index] = next() as never
      } else {
        array[index] = random.uint32() as never
      }
    }
    return array
  }
  return random
}

const uniqueColumnsOf = (
  table: AnyTableSpec,
): ReadonlyArray<ReadonlyArray<string>> => [
  ...Object.entries(table.columns)
    .filter(([, field]) => fieldOptions(field).primaryKey)
    .map(([name]) => [name]),
  ...table.constraints
    .filter((constraint) => constraint.kind === "unique")
    .map((constraint) => [...constraint.columns]),
]

const keyEquals = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  columns: ReadonlyArray<string>,
) => columns.every((column) => deepEqual(left[column], right[column]))

/**
 * A single row write, reported once the transaction that performed it has
 * committed.
 *
 * Observing writes rather than sampling rows is what lets a test see every hop
 * of a multi-write transaction, instead of only the state the row ended a
 * transaction in. Writes made by a transaction that later throws are discarded
 * with the rollback and never reported, so an observer sees committed history
 * only. Writes made outside any transaction are reported immediately.
 *
 * The end-of-transaction purge of event tables is not reported: those rows are
 * a delivery buffer, not persisted state.
 *
 * An observer that throws propagates out of the `db` call that triggered it and
 * aborts the module transaction, so keep observers total as well as
 * allocation-light.
 */
export type TestModuleRowWrite =
  | {
      readonly kind: "insert"
      readonly next: Record<string, unknown>
      readonly previous: undefined
      readonly table: string
    }
  | {
      readonly kind: "update"
      readonly next: Record<string, unknown>
      readonly previous: Record<string, unknown>
      readonly table: string
    }
  | {
      readonly kind: "delete"
      readonly next: undefined
      readonly previous: Record<string, unknown>
      readonly table: string
    }

export const makeTestModuleHarness = <Module extends AnyModuleSpec>(
  module: Module,
  options?: {
    /**
     * Values for the module's declared environment, validated like a publish:
     * a missing required key or a literal outside its set throws
     * `TestModuleEnvironmentError` here.
     */
    readonly environment?: TestModuleEnvironmentValues<Module> | undefined
    readonly http?: RawProcedureHttp | undefined
    /**
     * Called for every insert, update and delete the module commits, in write
     * order. Intended for conformance recorders; keep it allocation-light and
     * total, because it runs on every write.
     */
    readonly observeWrite?: ((write: TestModuleRowWrite) => void) | undefined
    readonly seed?: bigint | undefined
    /**
     * This database's identity. Harnesses linked by an inter-database pump
     * need distinct ones: a row's `target` names its receiver by it.
     */
    readonly databaseIdentity?: Identity | undefined
  },
): TestModuleHarness<Module> => {
  const databaseIdentity = options?.databaseIdentity ?? new Identity(2n)
  const { environment, updateEnvironment } = makeTestModuleEnvironment(
    module.environment ?? {},
    options?.environment,
  )
  const notifyWrite =
    options?.observeWrite ?? ((_write: TestModuleRowWrite) => {})
  // Writes are buffered while a transaction is open and flushed on commit, so a
  // rolled-back transaction reports nothing. Outside a transaction the write is
  // already durable, so it is reported immediately.
  let pendingWrites: Array<TestModuleRowWrite> = []
  const observeWrite = (write: TestModuleRowWrite): void => {
    if (transactionActive) {
      pendingWrites.push(write)
      return
    }
    notifyWrite(write)
  }
  const store: MutableStore = new Map(
    Object.keys(module.tables).map((key) => [key, []]),
  )
  const autoIncrement = new Map<string, bigint>()
  const eventTableKeys = Object.entries(module.tables)
    .filter(([, table]) => table.event)
    .map(([key]) => key)
  const rawDb: Record<string, unknown> = {}

  const outboxRemovers = new Map<string, (msgId: bigint) => void>()
  for (const [tableKey, table] of Object.entries(module.tables)) {
    const rows = store.get(tableKey)!
    const isOutbox = outboxMetadataOf(table) !== undefined
    const uniqueColumns = uniqueColumnsOf(table)
    const assertUnique = (
      row: Record<string, unknown>,
      ignored?: Record<string, unknown>,
    ) => {
      if (
        uniqueColumns.some((columns) =>
          rows.some(
            (candidate) =>
              candidate !== ignored && keyEquals(candidate, row, columns),
          ),
        )
      ) {
        throw new SpacetimeHostErrors.UniqueAlreadyExists(
          `${tableKey} unique constraint violated`,
        )
      }
    }
    const insert = (input: Record<string, unknown>) => {
      const row = { ...input }
      for (const [column, field] of Object.entries(table.columns)) {
        if (!fieldOptions(field).autoInc) continue
        if (
          row[column] !== undefined &&
          row[column] !== 0 &&
          row[column] !== 0n
        ) {
          continue
        }
        const key = `${tableKey}.${column}`
        const next = (autoIncrement.get(key) ?? 0n) + 1n
        autoIncrement.set(key, next)
        row[column] = typeof input[column] === "number" ? Number(next) : next
      }
      assertUnique(row)
      rows.push(row)
      observeWrite({
        kind: "insert",
        next: row,
        previous: undefined,
        table: tableKey,
      })
      return row
    }
    const tableHandle: Record<string, unknown> = {
      count: () => BigInt(rows.length),
      iter: () => [...rows].values(),
      insert,
      delete: (row: Record<string, unknown>) => {
        const index = rows.findIndex((candidate) => deepEqual(candidate, row))
        if (index < 0) return false
        const [removed] = rows.splice(index, 1)
        if (removed !== undefined) {
          observeWrite({
            kind: "delete",
            next: undefined,
            previous: removed,
            table: tableKey,
          })
        }
        return true
      },
      clear: () => {
        const count = BigInt(rows.length)
        const cleared = rows.splice(0, rows.length)
        for (const row of cleared) {
          observeWrite({
            kind: "delete",
            next: undefined,
            previous: row,
            table: tableKey,
          })
        }
        return count
      },
    }
    if (isOutbox) {
      // Mirrors the SDK's outbox view: insert and reads only. The pump removes
      // a settled row through the harness seam instead.
      outboxRemovers.set(tableKey, (msgId) => {
        const index = rows.findIndex((candidate) => candidate.msgId === msgId)
        if (index < 0) return
        const [removed] = rows.splice(index, 1)
        if (removed !== undefined) {
          observeWrite({
            kind: "delete",
            next: undefined,
            previous: removed,
            table: tableKey,
          })
        }
      })
    }
    for (const plan of lookupPlansOf(table, `db.${tableKey}`)) {
      const matchesPoint = (
        row: Record<string, unknown>,
        columns: ReadonlyArray<string>,
        value: unknown,
      ) =>
        keyEquals(
          row,
          Object.fromEntries(
            columns.map((column, index) => [
              column,
              Array.isArray(value) ? value[index] : value,
            ]),
          ),
          columns,
        )
      const matching = (value: unknown) =>
        rows
          .filter((row) =>
            Match.value(plan).pipe(
              Match.discriminatorsExhaustive("kind")({
                point: (pointPlan) =>
                  matchesPoint(row, pointPlan.columns, value),
                range: (rangePlan) =>
                  matchesRange(row, table, rangePlan.columns, value),
                unique: (uniquePlan) =>
                  matchesPoint(row, uniquePlan.columns, value),
              }),
            ),
          )
          .sort((left, right) =>
            compareRowsByColumns(table, plan.columns, left, right),
          )
      const makeFilterHandle = () => ({
        filter: (value: unknown) => matching(value).values(),
        delete: (value: unknown) => {
          const selected = matching(value)
          for (const row of selected) {
            rows.splice(rows.indexOf(row), 1)
            observeWrite({
              kind: "delete",
              next: undefined,
              previous: row,
              table: tableKey,
            })
          }
          return selected.length
        },
      })
      tableHandle[plan.key] = Match.value(plan).pipe(
        Match.discriminatorsExhaustive("kind")({
          point: makeFilterHandle,
          unique: (uniquePlan) => ({
            find: (value: unknown) => matching(value)[0],
            delete: (value: unknown) => {
              const row = matching(value)[0]
              return row === undefined
                ? false
                : (
                    tableHandle.delete as (
                      row: Record<string, unknown>,
                    ) => boolean
                  )(row)
            },
            ...(uniquePlan.update
              ? {
                  update: (next: Record<string, unknown>) => {
                    const current = matching(
                      uniquePlan.columns.length === 1
                        ? next[uniquePlan.columns[0]!]
                        : uniquePlan.columns.map((column) => next[column]),
                    )[0]
                    if (current === undefined) {
                      throw new SpacetimeHostErrors.NoSuchRow(
                        `${tableKey} row does not exist`,
                      )
                    }
                    assertUnique(next, current)
                    const index = rows.indexOf(current)
                    const replacement = { ...next }
                    rows[index] = replacement
                    observeWrite({
                      kind: "update",
                      next: replacement,
                      previous: current,
                      table: tableKey,
                    })
                    return replacement
                  },
                }
              : {}),
          }),
          range: makeFilterHandle,
        }),
      )
    }
    if (isOutbox) {
      const { delete: _delete, clear: _clear, ...outboxHandle } = tableHandle
      for (const plan of lookupPlansOf(table, `db.${tableKey}`)) {
        const lookup = tableHandle[plan.key] as Record<string, unknown>
        const { delete: _lookupDelete, update: _update, ...readOnly } = lookup
        outboxHandle[plan.key] = readOnly
      }
      rawDb[tableKey] = outboxHandle
      continue
    }
    rawDb[tableKey] = tableHandle
  }

  const db = rawDb as DbShape<Module>
  const dbHandles = makeDbHandleFactory(module)
  const effectDb = dbHandles.readwrite(db, {
    timestamp: new Timestamp(1_000n),
    databaseIdentity,
  })
  const outboxRows = (key: string): ReadonlyArray<Record<string, unknown>> => {
    const table = module.tables[key]
    if (table === undefined || outboxMetadataOf(table) === undefined) {
      throw new TypeError(`${key} is not an outbox of module ${module.name}`)
    }
    const codec = tableCodecOf(table, `outboxRows.${key}`)
    return (store.get(key) ?? [])
      .map((row) => codec.decodeRow(row) as Record<string, unknown>)
      .sort((left, right) =>
        (left.msgId as bigint) < (right.msgId as bigint) ? -1 : 1,
      )
  }
  let transactionActive = false
  let uuidCounter = 0n
  const randomSeed = options?.seed ?? 1n
  let random = makeRandom(randomSeed)
  const httpDefault: RawProcedureHttp = options?.http ?? {
    fetch: () => ({
      status: 200,
      text: () => "",
      json: () => ({}),
      bytes: () => new Uint8Array(),
    }),
  }
  const base = () => ({
    env: environment,
    sender: new Identity(1n),
    databaseIdentity,
    identity: databaseIdentity,
    timestamp: new Timestamp(1_000n),
    connectionId: new ConnectionId(1n),
    newUuidV4: () => new Uuid(++uuidCounter),
    newUuidV7: () => new Uuid(++uuidCounter),
    random,
  })

  let makeMutationCtx!: TestModuleHarness<Module>["makeMutationCtx"]
  const runTransaction = <A>(body: () => A): A => {
    if (transactionActive) throw new NestedTestTransactionError()
    const snapshot = new Map([...store].map(([key, rows]) => [key, [...rows]]))
    transactionActive = true
    pendingWrites = []
    try {
      const result = body()
      for (const key of eventTableKeys) {
        const rows = store.get(key)!
        rows.splice(0, rows.length)
      }
      const committed = pendingWrites
      pendingWrites = []
      for (const write of committed) notifyWrite(write)
      return result
    } catch (cause) {
      for (const [key, rows] of snapshot) {
        const target = store.get(key)!
        target.splice(0, target.length, ...rows)
      }
      // The rolled-back writes are discarded: an observer must see committed
      // history only.
      pendingWrites = []
      throw cause
    } finally {
      transactionActive = false
    }
  }
  const withTx = <A>(
    body: (ctx: BaseReducerCtx<Module>) => A,
    overrides: HarnessOverrides<BaseReducerCtx<Module>> = {},
  ): A => runTransaction(() => body(makeMutationCtx(overrides)))

  makeMutationCtx = (overrides = {}) => {
    const context = { ...base(), ...overrides }
    return {
      db,
      [TestHarnessTransaction]: runTransaction,
      ...context,
      senderAuth: context.senderAuth ?? unauthenticatedSenderAuth(context),
    }
  }
  const queryRoot = Object.fromEntries(
    [...store].map(([key, rows]) => {
      const relation = {
        build: () => relation,
        where: () => {
          throw new TypeError(
            `Test module harness does not evaluate where() predicates for ${key}`,
          )
        },
        toSql: () => `SELECT * FROM ${key}`,
        rows: () => rows,
      }
      return [key, relation]
    }),
  ) as unknown as ServerQueryRoot<Module>

  const makeProcedureCtx: TestModuleHarness<Module>["makeProcedureCtx"] = (
    overrides = {},
  ) => {
    const { transaction = {}, ...contextOverrides } = overrides
    const context = {
      ...base(),
      http: httpDefault,
      ...contextOverrides,
    }
    return {
      ...context,
      [ProcedureClockNow]:
        context[ProcedureClockNow] ??
        (() => Number(context.timestamp.microsSinceUnixEpoch / 1_000n)),
      withTx: (body) =>
        withTx(body, {
          env: context.env,
          sender: context.sender,
          databaseIdentity: context.databaseIdentity,
          identity: context.identity,
          timestamp: context.timestamp,
          connectionId: context.connectionId,
          newUuidV4: context.newUuidV4,
          newUuidV7: context.newUuidV7,
          random: context.random,
          ...transaction,
        }),
    }
  }

  const reset = () => {
    for (const rows of store.values()) rows.splice(0, rows.length)
    autoIncrement.clear()
    uuidCounter = 0n
    random = makeRandom(randomSeed)
  }

  return {
    db: rawDb as TestModuleRawDb<Module>,
    effectDb,
    databaseIdentity,
    outboxRows: outboxRows as TestModuleHarness<Module>["outboxRows"],
    [TestHarnessOutboxRemove]: (key, msgId) => {
      const remove = outboxRemovers.get(key)
      if (remove === undefined) {
        throw new TypeError(`${key} is not an outbox of module ${module.name}`)
      }
      remove(msgId)
    },
    environment,
    updateEnvironment,
    reset,
    makeMutationCtx,
    makeProcedureCtx,
    makeHttpHandlerCtx: (overrides = {}) => ({
      env: environment,
      timestamp: new Timestamp(1_000n),
      http: httpDefault,
      databaseIdentity,
      withTx: (body) => withTx((ctx) => body({ db: ctx.db })),
      newUuidV4: () => new Uuid(++uuidCounter),
      newUuidV7: () => new Uuid(++uuidCounter),
      random,
      ...overrides,
    }),
    makeViewCtx: (overrides = {}) => ({
      env: environment,
      sender: new Identity(1n),
      db,
      from: queryRoot,
      ...overrides,
    }),
    makeAnonymousViewCtx: (overrides = {}) => ({
      env: environment,
      db,
      from: queryRoot,
      ...overrides,
    }),
  }
}
