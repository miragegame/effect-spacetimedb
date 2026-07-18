import * as Data from "effect/Data"
import * as Match from "effect/Match"
import { ConnectionId, deepEqual, Identity, Timestamp, Uuid } from "spacetimedb"
import { type AnyFieldType, fieldOptions } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec } from "../contract/table.ts"
import { type AnyValueType, type TypeKind, typeInfo } from "../contract/type.ts"
import type { ServerQueryRoot } from "../query/types.ts"
import { makeDbHandleFactory } from "../server/db-handle.ts"
import { lookupPlansOf } from "../server/db-handle-codec.ts"
import { SpacetimeHostErrors } from "../server/host-errors.ts"
import type {
  BaseReducerCtx,
  DbShape,
  HttpHandlerCtxLike,
  ProcedureCtxLike,
  ServerAnonymousViewCtx,
  ServerRandom,
  ServerSenderViewCtx,
} from "../server/runtime-types.ts"
import type { EffectDbView } from "../server/services.ts"
import { TestHarnessTransaction } from "./transaction.ts"

export class NestedTestTransactionError extends Data.TaggedError(
  "NestedTestTransactionError",
) {}

type MutableStore = Map<string, Array<Record<string, unknown>>>

type HarnessOverrides<Ctx> = Partial<Omit<Ctx, "db" | "from" | "withTx">>
type ProcedureHarnessOverrides<Module extends AnyModuleSpec> = HarnessOverrides<
  ProcedureCtxLike<Module>
> & {
  readonly transaction?: HarnessOverrides<BaseReducerCtx<Module>> | undefined
}

export type TestModuleHarness<Module extends AnyModuleSpec> = {
  readonly db: DbShape<Module>
  readonly effectDb: EffectDbView<Module>
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
  if (left === undefined || left === null) return -1
  if (right === undefined || right === null) return 1

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

const compareRowsByColumns = (
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

const matchesRange = (
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

export const makeTestModuleHarness = <Module extends AnyModuleSpec>(
  module: Module,
  options?: { readonly seed?: bigint | undefined },
): TestModuleHarness<Module> => {
  const store: MutableStore = new Map(
    Object.keys(module.tables).map((key) => [key, []]),
  )
  const autoIncrement = new Map<string, bigint>()
  const eventTableKeys = Object.entries(module.tables)
    .filter(([, table]) => table.event)
    .map(([key]) => key)
  const rawDb: Record<string, unknown> = {}

  for (const [tableKey, table] of Object.entries(module.tables)) {
    const rows = store.get(tableKey)!
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
      return row
    }
    const tableHandle: Record<string, unknown> = {
      count: () => BigInt(rows.length),
      iter: () => [...rows].values(),
      insert,
      delete: (row: Record<string, unknown>) => {
        const index = rows.findIndex((candidate) => deepEqual(candidate, row))
        if (index < 0) return false
        rows.splice(index, 1)
        return true
      },
      clear: () => {
        const count = BigInt(rows.length)
        rows.splice(0, rows.length)
        return count
      },
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
                    return replacement
                  },
                }
              : {}),
          }),
          range: makeFilterHandle,
        }),
      )
    }
    rawDb[tableKey] = tableHandle
  }

  const db = rawDb as DbShape<Module>
  const dbHandles = makeDbHandleFactory(module)
  const effectDb = dbHandles.readwrite(db)
  let transactionActive = false
  let uuidCounter = 0n
  const random = makeRandom(options?.seed ?? 1n)
  const defaultHttp = {
    fetch: () => ({
      text: () => "",
      json: () => ({}),
      bytes: () => new Uint8Array(),
    }),
  }
  const base = () => ({
    sender: new Identity(1n),
    databaseIdentity: new Identity(2n),
    identity: new Identity(2n),
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
    try {
      const result = body()
      for (const key of eventTableKeys) {
        const rows = store.get(key)!
        rows.splice(0, rows.length)
      }
      return result
    } catch (cause) {
      for (const [key, rows] of snapshot) {
        const target = store.get(key)!
        target.splice(0, target.length, ...rows)
      }
      throw cause
    } finally {
      transactionActive = false
    }
  }
  const withTx = <A>(
    body: (ctx: BaseReducerCtx<Module>) => A,
    overrides: HarnessOverrides<BaseReducerCtx<Module>> = {},
  ): A => runTransaction(() => body(makeMutationCtx(overrides)))

  makeMutationCtx = (overrides = {}) => ({
    ...base(),
    db,
    senderAuth: { isInternal: false, hasJWT: false, jwt: null },
    [TestHarnessTransaction]: runTransaction,
    ...overrides,
  })
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
      http: defaultHttp,
      ...contextOverrides,
    }
    return {
      ...context,
      withTx: (body) =>
        withTx(body, {
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

  return {
    db,
    effectDb,
    makeMutationCtx,
    makeProcedureCtx,
    makeHttpHandlerCtx: (overrides = {}) => ({
      timestamp: new Timestamp(1_000n),
      http: defaultHttp,
      databaseIdentity: new Identity(2n),
      withTx: (body) => withTx((ctx) => body({ db: ctx.db })),
      newUuidV4: () => new Uuid(++uuidCounter),
      newUuidV7: () => new Uuid(++uuidCounter),
      random,
      ...overrides,
    }),
    makeViewCtx: (overrides = {}) => ({
      sender: new Identity(1n),
      db,
      from: queryRoot,
      ...overrides,
    }),
    makeAnonymousViewCtx: (overrides = {}) => ({
      db,
      from: queryRoot,
      ...overrides,
    }),
  }
}
