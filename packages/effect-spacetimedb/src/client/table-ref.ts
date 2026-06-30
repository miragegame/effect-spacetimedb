import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import type { StdbDecodeError } from "../decode-error.ts"
import type { SnapshotSignal } from "./session-stream.ts"
import type { SubscriptionFailure } from "./ws-subscription.ts"

export type TableRefFailure = SubscriptionFailure | StdbDecodeError

export type TableRefValue<Row, E = TableRefFailure> = AsyncResult.AsyncResult<
  ReadonlyArray<Row>,
  E
>

export type RowRefValue<Row, E = TableRefFailure> = AsyncResult.AsyncResult<
  Option.Option<Row>,
  E
>

export type TableGroupRefValue<
  Snapshot,
  E = TableRefFailure,
> = AsyncResult.AsyncResult<Snapshot, E>

export type TableRef<
  Row,
  E = TableRefFailure,
> = SubscriptionRef.SubscriptionRef<TableRefValue<Row, E>>

export type RowRef<Row, E = TableRefFailure> = SubscriptionRef.SubscriptionRef<
  RowRefValue<Row, E>
>

export type TableGroupRef<
  Snapshot,
  E = TableRefFailure,
> = SubscriptionRef.SubscriptionRef<TableGroupRefValue<Snapshot, E>>

const encodeCanonicalJson = Schema.encodeSync(
  Schema.fromJsonString(Schema.Unknown),
)

const asyncResultFailureFromCause = <A, E>(
  cause: Cause.Cause<E>,
): AsyncResult.AsyncResult<A, E> =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => AsyncResult.failure<A, E>(cause),
    onSome: (error) => AsyncResult.fail<E, A>(error),
  })

const publishFailureFromCause = <A, E>(
  ref: SubscriptionRef.SubscriptionRef<AsyncResult.AsyncResult<A, E>>,
  cause: Cause.Cause<E>,
) => SubscriptionRef.set(ref, asyncResultFailureFromCause<A, E>(cause))

export const subscribeSnapshotRef = <Snapshot, E>(options: {
  readonly readSnapshot: Effect.Effect<Snapshot, E>
  readonly signals: Stream.Stream<SnapshotSignal, E, Scope.Scope>
}): Effect.Effect<
  SubscriptionRef.SubscriptionRef<AsyncResult.AsyncResult<Snapshot, E>>,
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    let applied = false
    const ref = yield* SubscriptionRef.make<
      AsyncResult.AsyncResult<Snapshot, E>
    >(AsyncResult.initial<Snapshot, E>(true))
    const publishSnapshot = options.readSnapshot.pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          SubscriptionRef.set(ref, AsyncResult.fail<E, Snapshot>(error)),
        onSuccess: (snapshot) =>
          SubscriptionRef.set(ref, AsyncResult.success<Snapshot, E>(snapshot)),
      }),
    )

    yield* options.signals.pipe(
      Stream.chunks,
      Stream.runForEach((signals) => {
        if (signals.some((signal) => signal === "applied")) {
          applied = true
        }
        return applied ? publishSnapshot : Effect.void
      }),
      Effect.matchCauseEffect({
        onFailure: (cause) => publishFailureFromCause(ref, cause),
        onSuccess: () => Effect.void,
      }),
      Effect.forkScoped,
    )

    return ref
  })

export const subscribeTableRef = <Row, E>(options: {
  readonly readSnapshot: Effect.Effect<ReadonlyArray<Row>, E>
  readonly signals: Stream.Stream<SnapshotSignal, E, Scope.Scope>
}): Effect.Effect<TableRef<Row, E>, never, Scope.Scope> =>
  subscribeSnapshotRef(options)

export const subscribeRowRef = <Row, E>(options: {
  readonly table: Effect.Effect<TableRef<Row, E>, never, Scope.Scope>
  readonly predicate: (row: Row) => boolean
}): Effect.Effect<RowRef<Row, E>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const table = yield* options.table
    const select = (result: TableRefValue<Row, E>): RowRefValue<Row, E> =>
      AsyncResult.map(result, (rows) =>
        Option.fromUndefinedOr(rows.find(options.predicate)),
      )
    const ref = yield* table.pipe(
      SubscriptionRef.get,
      Effect.map(select),
      Effect.flatMap(SubscriptionRef.make<RowRefValue<Row, E>>),
    )

    yield* SubscriptionRef.changes(table).pipe(
      Stream.runForEach((result) => SubscriptionRef.set(ref, select(result))),
      Effect.forkScoped,
    )

    return ref
  })

export const subscribeTableGroupRef = <Snapshot, E>(options: {
  readonly readSnapshot: Effect.Effect<Snapshot, E>
  readonly signals: Stream.Stream<SnapshotSignal, E, Scope.Scope>
}): Effect.Effect<TableGroupRef<Snapshot, E>, never, Scope.Scope> =>
  subscribeSnapshotRef(options)

const hasHexString = (
  value: unknown,
): value is { readonly toHexString: () => string } =>
  typeof value === "object" &&
  value !== null &&
  "toHexString" in value &&
  typeof value.toHexString === "function"

const unsupportedCanonicalValue = (kind: string): never => {
  throw new TypeError(`Cannot build a stable subscription key for ${kind}`)
}

const canonicalValuePart = (value: unknown): unknown => {
  if (value instanceof Uint8Array) {
    return ["bytes", Encoding.encodeHex(value)] as const
  }
  if (hasHexString(value)) {
    return ["hex", value.toHexString()] as const
  }
  if (Array.isArray(value)) {
    return ["array", value.map(canonicalValuePart)] as const
  }

  return Match.value(typeof value).pipe(
    Match.when(
      "bigint",
      () => ["bigint", (value as bigint).toString()] as const,
    ),
    Match.when("boolean", () => ["boolean", value] as const),
    Match.when("number", () => ["number", value] as const),
    Match.when("string", () => ["string", value] as const),
    Match.when("symbol", () => unsupportedCanonicalValue("symbol primary key")),
    Match.when("undefined", () => ["undefined"] as const),
    Match.when("object", () => {
      if (value === null) {
        return ["null"] as const
      }
      const entries = Object.entries(Object(value)).sort(([left], [right]) =>
        left.localeCompare(right),
      )
      return [
        "object",
        entries.map(
          ([key, entryValue]) => [key, canonicalValuePart(entryValue)] as const,
        ),
      ] as const
    }),
    Match.when("function", () =>
      unsupportedCanonicalValue("function primary key"),
    ),
    Match.exhaustive,
  )
}

export const canonicalValueKey = (value: unknown): string =>
  encodeCanonicalJson(canonicalValuePart(value))

export const canonicalTableKey = (moduleName: string, key: string): string =>
  canonicalValueKey(["table", moduleName, key] as const)

export const canonicalRowKey = (
  moduleName: string,
  key: string,
  primaryKey: unknown,
): string => canonicalValueKey(["row", moduleName, key, primaryKey] as const)

export const canonicalTableGroupKey = (
  moduleName: string,
  keys: ReadonlyArray<string>,
): string =>
  canonicalValueKey([
    "group",
    moduleName,
    canonicalizeTableGroupKeys(keys),
  ] as const)

export const canonicalizeTableGroupKeys = <Key extends string>(
  keys: ReadonlyArray<Key>,
): ReadonlyArray<Key> => Array.from(new Set(keys)).sort()
