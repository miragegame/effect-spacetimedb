import {
  AlgebraicType,
  BinaryWriter,
  ConnectionId,
  Identity,
  Timestamp,
  t,
} from "spacetimedb"

export type SdkReducerOutcome =
  | {
      readonly tag: "Ok"
      readonly value: {
        readonly retValue: Uint8Array
        readonly transactionUpdate: unknown
      }
    }
  | { readonly tag: "OkEmpty" }
  | { readonly tag: "Err"; readonly value: Uint8Array }
  | { readonly tag: "InternalError"; readonly value: string }

export type SdkEvent =
  | {
      readonly id: string
      readonly tag: "Reducer"
      readonly value: {
        readonly timestamp: Timestamp
        readonly outcome: SdkReducerOutcome
        readonly reducer: {
          readonly name: string
          readonly args: Readonly<Record<string, unknown>>
        }
      }
    }
  | { readonly id: string; readonly tag: "SubscribeApplied" }
  | { readonly id: string; readonly tag: "UnsubscribeApplied" }
  | { readonly id: string; readonly tag: "Transaction" }
  | { readonly id: string; readonly tag: "Error"; readonly value: Error }

export type SdkEventContext = {
  readonly db: unknown
  readonly reducers: unknown
  readonly isActive: boolean
  readonly subscriptionBuilder: () => unknown
  readonly disconnect: () => void
  readonly event: SdkEvent
}

export const StableTimestamp = new Timestamp(123n)
export const StableIdentity = Identity.zero()
export const StableConnectionId = new ConnectionId(17n)

const inertDbContext = {
  db: Object.freeze({
    identity: StableIdentity,
    connectionId: StableConnectionId,
  }),
  reducers: Object.freeze({}),
  isActive: true,
  subscriptionBuilder: () => Object.freeze({}),
  disconnect: () => undefined,
} as const

let nextEventId = 1

const eventId = (): string => `oracle-event-${(nextEventId++).toString()}`

export const reducerInfo = (name = "userUpsert") => ({
  name,
  args: {},
})

export const reducerOk = (
  retValue: Uint8Array = new Uint8Array(),
  transactionUpdate: unknown = {},
): SdkReducerOutcome => ({
  tag: "Ok",
  value: {
    retValue,
    transactionUpdate,
  },
})

export const reducerOkEmpty = (): SdkReducerOutcome => ({ tag: "OkEmpty" })

export const reducerErr = (value: Uint8Array): SdkReducerOutcome => ({
  tag: "Err",
  value,
})

export const reducerInternalError = (value: string): SdkReducerOutcome => ({
  tag: "InternalError",
  value,
})

export const bsatnString = (value: string): Uint8Array => {
  const writer = new BinaryWriter(16)
  AlgebraicType.makeSerializer(t.string().algebraicType)(writer, value)
  return writer.getBuffer()
}

export const eventContext = (event: SdkEvent): SdkEventContext => ({
  ...inertDbContext,
  event,
})

// Mirrors spacetimedb@2.6.1 sdk/db_connection_impl.ts:881-907 and :964-995,
// sdk/event.ts:11-18, sdk/reducer_event.ts:5-20, and sdk/client_api/types.ts:143-151.
// Re-verify these source-cited hand mirrors when the pinned SpaceTimeDB SDK changes.
export const reducerEventContext = (options: {
  readonly outcome: SdkReducerOutcome
  readonly reducer?: ReturnType<typeof reducerInfo>
  readonly timestamp?: Timestamp
}): SdkEventContext =>
  eventContext({
    id: eventId(),
    tag: "Reducer",
    value: {
      timestamp: options.timestamp ?? StableTimestamp,
      outcome: options.outcome,
      reducer: options.reducer ?? reducerInfo(),
    },
  })

export const reducerContext = reducerEventContext

export const subscribeAppliedContext = (): SdkEventContext =>
  eventContext({
    id: eventId(),
    tag: "SubscribeApplied",
  })

export const unsubscribeAppliedContext = (): SdkEventContext =>
  eventContext({
    id: eventId(),
    tag: "UnsubscribeApplied",
  })

export const transactionContext = (): SdkEventContext =>
  eventContext({
    id: eventId(),
    tag: "Transaction",
  })

export const errorContext = (error: Error): SdkEventContext =>
  eventContext({
    id: eventId(),
    tag: "Error",
    value: error,
  })
