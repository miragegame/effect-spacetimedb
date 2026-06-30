import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { StdbDecodeError } from "../decode-error.ts"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"
import type {
  ConnectionInvalidation,
  WsConnectionState,
} from "./connection-state.ts"
import type { InsertEvent, RelationHandle } from "./relation.ts"
import {
  type SubscriptionFailure,
  SubscriptionInvalidatedError,
  SubscriptionTransportError,
} from "./ws-subscription.ts"

export type TableChange<Row> = Data.TaggedEnum<{
  Insert: {
    readonly row: Row
  }
  Delete: {
    readonly row: Row
  }
  Update: {
    readonly oldRow: Row
    readonly newRow: Row
  }
}>

export type TableChangeWithContext<Row, Ctx> = Data.TaggedEnum<{
  Insert: {
    readonly row: Row
    readonly context: Ctx
  }
  Delete: {
    readonly row: Row
    readonly context: Ctx
  }
  Update: {
    readonly oldRow: Row
    readonly newRow: Row
    readonly context: Ctx
  }
}>

const makeTableChange = <Row>() => Data.taggedEnum<TableChange<Row>>()

const makeTableChangeWithContext = <Row, Ctx>() =>
  Data.taggedEnum<TableChangeWithContext<Row, Ctx>>()

type SessionStreamEmitter<A> = {
  readonly single: (value: A) => void
  readonly fail: (error: SubscriptionFailure) => void
}

export type SessionStreamBufferOptions = {
  readonly bufferSize?: number
  readonly strategy?: "sliding" | "dropping"
}

export type SnapshotSignal = "applied" | "changed"

export type EventTableStreamBufferOptions = {
  readonly bufferSize?: number
}

type RuntimeSessionStreamBufferOptions = {
  readonly bufferSize?: number
  readonly strategy?: "sliding" | "dropping" | "suspend"
}

const EventTableStreamOverflowErrorTypeId = errorTypeId(
  "EventTableStreamOverflowError",
)
export class EventTableStreamOverflowError extends Data.TaggedError(
  "EventTableStreamOverflowError",
)<{
  readonly bufferSize: number
}> {
  readonly [EventTableStreamOverflowErrorTypeId] =
    EventTableStreamOverflowErrorTypeId
  static is = hasErrorTypeId<EventTableStreamOverflowError>(
    EventTableStreamOverflowErrorTypeId,
  )

  override get message(): string {
    return `Event-table stream buffer capacity ${this.bufferSize.toString()} was exceeded`
  }
}

// Persistent-table change streams stay bounded + sliding: consumers re-read
// authoritative snapshots, so overflow is recoverable.
const SNAPSHOT_STREAM_BUFFER = {
  bufferSize: 1024,
  strategy: "sliding",
} satisfies Required<SessionStreamBufferOptions>

const normalizeStreamBuffer = (
  buffer: SessionStreamBufferOptions,
): Required<SessionStreamBufferOptions> => ({
  bufferSize: buffer.bufferSize ?? SNAPSHOT_STREAM_BUFFER.bufferSize,
  strategy: buffer.strategy ?? SNAPSHOT_STREAM_BUFFER.strategy,
})

const snapshotStreamBuffer = (
  buffer: SessionStreamBufferOptions | undefined,
): SessionStreamBufferOptions =>
  buffer === undefined ? SNAPSHOT_STREAM_BUFFER : normalizeStreamBuffer(buffer)

const EVENT_TABLE_STREAM_BUFFER = {
  bufferSize: 1024,
  strategy: "suspend",
} satisfies Required<RuntimeSessionStreamBufferOptions>

const eventTableStreamBuffer = (
  buffer: EventTableStreamBufferOptions | undefined,
): Required<RuntimeSessionStreamBufferOptions> => ({
  bufferSize: buffer?.bufferSize ?? EVENT_TABLE_STREAM_BUFFER.bufferSize,
  strategy: "suspend",
})

type SessionRegistration<A> = (
  emit: SessionStreamEmitter<A>,
) => Effect.Effect<void, SubscriptionTransportError, Scope.Scope>

type CallbackRegistration<Args extends ReadonlyArray<unknown>, A> = {
  readonly register: (callback: (...args: Args) => void) => void
  readonly unregister: (callback: (...args: Args) => void) => void
  readonly mapEvent: (...args: Args) => A
}

const invalidationFailure = (
  invalidation: ConnectionInvalidation,
): SubscriptionInvalidatedError =>
  new SubscriptionInvalidatedError({
    raw: invalidation.message,
    connectionFatal: invalidation.connectionFatal,
  })

const registerCallback =
  <A, Args extends ReadonlyArray<unknown>>(
    options: CallbackRegistration<Args, A>,
  ): SessionRegistration<A> =>
  (emit) => {
    const callback = (...args: Args) => {
      try {
        emit.single(options.mapEvent(...args))
      } catch (cause) {
        emit.fail(
          StdbDecodeError.is(cause)
            ? cause
            : new SubscriptionTransportError({
                cause,
              }),
        )
      }
    }

    return Effect.acquireRelease(
      Effect.try({
        try: () => options.register(callback),
        catch: (cause) =>
          new SubscriptionTransportError({
            cause,
          }),
      }),
      () =>
        Effect.try({
          try: () => options.unregister(callback),
          catch: (cause) =>
            new SubscriptionTransportError({
              cause,
            }),
        }).pipe(
          Effect.catchTag("SubscriptionTransportError", (error) =>
            Effect.suspend(() => {
              emit.fail(error)
              return Effect.void
            }),
          ),
        ),
    )
  }

const sessionStream = <A>(options: {
  readonly connectionState: WsConnectionState
  readonly registrations: ReadonlyArray<SessionRegistration<A>>
  readonly subscribe?: Effect.Effect<unknown, SubscriptionFailure, Scope.Scope>
  readonly emitAfterSubscribe?: () => A
  readonly buffer?: RuntimeSessionStreamBufferOptions
  readonly overflowFailure?: (bufferSize: number) => SubscriptionFailure
}) =>
  Stream.callback<A, SubscriptionFailure>((queue) => {
    const bufferSize = options.buffer?.bufferSize
    const emit: SessionStreamEmitter<A> = {
      single: (value) => {
        const offered = Queue.offerUnsafe(queue, value)
        if (!offered && options.overflowFailure != null) {
          Queue.failCauseUnsafe(
            queue,
            Cause.fail(options.overflowFailure(bufferSize ?? 0)),
          )
        }
      },
      fail: (error) => {
        Queue.failCauseUnsafe(queue, Cause.fail(error))
      },
    }
    const onInvalidation = (invalidation: ConnectionInvalidation) => {
      emit.fail(invalidationFailure(invalidation))
    }

    return options.connectionState.assertActive().pipe(
      Effect.andThen(
        Effect.gen(function* () {
          yield* Effect.forEach(
            options.registrations,
            (register) => register(emit),
            {
              discard: true,
            },
          )
          yield* options.connectionState.observeInvalidation(onInvalidation)
          if (options.subscribe != null) {
            yield* options.subscribe
          }
          if (options.emitAfterSubscribe != null) {
            emit.single(options.emitAfterSubscribe())
          }
        }),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.suspend(() => {
              Queue.failCauseUnsafe(queue, cause)
              return Effect.void
            }),
      ),
    )
  }, options.buffer)

export const streamTableChanges = <Row, MappedRow = Row, Ctx = unknown>(
  connectionState: WsConnectionState,
  relation: RelationHandle<Row, Ctx>,
  subscribe?: Effect.Effect<unknown, SubscriptionFailure, Scope.Scope>,
  mapRow: (row: Row) => MappedRow = (row) => row as unknown as MappedRow,
  buffer?: SessionStreamBufferOptions,
) => {
  const { Insert, Delete, Update } = makeTableChange<MappedRow>()

  return sessionStream<TableChange<MappedRow>>({
    connectionState,
    registrations: [
      registerCallback({
        register: (callback) => relation.onInsert(callback),
        unregister: (callback) => relation.removeOnInsert(callback),
        mapEvent: (_context: Ctx, row: Row) =>
          Insert({
            row: mapRow(row),
          }),
      }),
      registerCallback({
        register: (callback) => relation.onDelete(callback),
        unregister: (callback) => relation.removeOnDelete(callback),
        mapEvent: (_context: Ctx, row: Row) =>
          Delete({
            row: mapRow(row),
          }),
      }),
      registerCallback({
        register: (callback) => relation.onUpdate(callback),
        unregister: (callback) => relation.removeOnUpdate(callback),
        mapEvent: (_context: Ctx, oldRow: Row, newRow: Row) =>
          Update({
            oldRow: mapRow(oldRow),
            newRow: mapRow(newRow),
          }),
      }),
    ],
    ...(subscribe != null ? { subscribe } : {}),
    buffer: snapshotStreamBuffer(buffer),
  })
}

export const streamTableChangesWithContext = <
  Row,
  MappedRow = Row,
  Ctx = unknown,
>(
  connectionState: WsConnectionState,
  relation: RelationHandle<Row, Ctx>,
  subscribe?: Effect.Effect<unknown, SubscriptionFailure, Scope.Scope>,
  mapRow: (row: Row) => MappedRow = (row) => row as unknown as MappedRow,
  buffer?: SessionStreamBufferOptions,
) => {
  const { Insert, Delete, Update } = makeTableChangeWithContext<
    MappedRow,
    Ctx
  >()

  return sessionStream<TableChangeWithContext<MappedRow, Ctx>>({
    connectionState,
    registrations: [
      registerCallback({
        register: (callback) => relation.onInsert(callback),
        unregister: (callback) => relation.removeOnInsert(callback),
        mapEvent: (context: Ctx, row: Row) =>
          Insert({
            row: mapRow(row),
            context,
          }),
      }),
      registerCallback({
        register: (callback) => relation.onDelete(callback),
        unregister: (callback) => relation.removeOnDelete(callback),
        mapEvent: (context: Ctx, row: Row) =>
          Delete({
            row: mapRow(row),
            context,
          }),
      }),
      registerCallback({
        register: (callback) => relation.onUpdate(callback),
        unregister: (callback) => relation.removeOnUpdate(callback),
        mapEvent: (context: Ctx, oldRow: Row, newRow: Row) =>
          Update({
            oldRow: mapRow(oldRow),
            newRow: mapRow(newRow),
            context,
          }),
      }),
    ],
    ...(subscribe != null ? { subscribe } : {}),
    buffer: snapshotStreamBuffer(buffer),
  })
}

export const streamTableGroupChanges = <Ctx = unknown>(
  connectionState: WsConnectionState,
  relations: ReadonlyArray<RelationHandle<unknown, Ctx>>,
  subscribe?: Effect.Effect<unknown, SubscriptionFailure, Scope.Scope>,
  buffer?: SessionStreamBufferOptions,
) =>
  sessionStream<void>({
    connectionState,
    registrations: relations.flatMap((relation) =>
      relationSignalRegistrations(relation, undefined),
    ),
    ...(subscribe != null ? { subscribe } : {}),
    buffer: snapshotStreamBuffer(buffer),
  })

const relationSignalRegistrations = <Row, Ctx, A>(
  relation: RelationHandle<Row, Ctx>,
  signal: A,
) => [
  registerCallback({
    register: (callback) => relation.onInsert(callback),
    unregister: (callback) => relation.removeOnInsert(callback),
    mapEvent: () => signal,
  }),
  registerCallback({
    register: (callback) => relation.onDelete(callback),
    unregister: (callback) => relation.removeOnDelete(callback),
    mapEvent: () => signal,
  }),
  registerCallback({
    register: (callback) => relation.onUpdate(callback),
    unregister: (callback) => relation.removeOnUpdate(callback),
    mapEvent: () => signal,
  }),
]

export const streamTableSnapshotSignals = <Row, Ctx = unknown>(
  connectionState: WsConnectionState,
  relation: RelationHandle<Row, Ctx>,
  subscribe?: Effect.Effect<unknown, SubscriptionFailure, Scope.Scope>,
  buffer?: SessionStreamBufferOptions,
) =>
  sessionStream<SnapshotSignal>({
    connectionState,
    registrations: relationSignalRegistrations(relation, "changed" as const),
    ...(subscribe != null ? { subscribe } : {}),
    emitAfterSubscribe: () => "applied" as const,
    buffer: snapshotStreamBuffer(buffer),
  })

export const streamEventTable = <Row, MappedRow = Row, Ctx = unknown>(
  connectionState: WsConnectionState,
  relation: RelationHandle<Row, Ctx>,
  subscribe?: Effect.Effect<unknown, SubscriptionFailure, Scope.Scope>,
  mapRow: (row: Row) => MappedRow = (row) => row as unknown as MappedRow,
  buffer?: EventTableStreamBufferOptions,
) => {
  const eventBuffer = eventTableStreamBuffer(buffer)

  return sessionStream<InsertEvent<MappedRow, Ctx>>({
    connectionState,
    registrations: [
      registerCallback({
        register: (callback) => relation.onInsert(callback),
        unregister: (callback) => relation.removeOnInsert(callback),
        mapEvent: (context: Ctx, row: Row) => ({
          row: mapRow(row),
          context,
        }),
      }),
    ],
    ...(subscribe != null ? { subscribe } : {}),
    buffer: eventBuffer,
    overflowFailure: (bufferSize) =>
      new SubscriptionTransportError({
        cause: new EventTableStreamOverflowError({ bufferSize }),
      }),
  })
}
