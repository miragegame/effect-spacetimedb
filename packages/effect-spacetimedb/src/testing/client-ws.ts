export { make, makeFromModulePlan } from "../client/ws-client.ts"
export type {
  PublicCache,
  PublicTableCache,
  NativeSubscriptionHandleLike,
  StdbTableChangeEvent,
  SubscriptionBuilderLike,
  SubscriptionHandleLike,
  TableGroup,
  TableGroupSnapshot,
  WsCallableTransport,
  WsClientOptions,
  WsConnectionLike,
  WsDbShape,
  WsEventTableStreamOptions,
  WsStreamOptions,
  WsTableRow,
  WaitUntilOptions,
} from "../client/ws-client.ts"
export { unsubscribeThen, WaitUntilTimeoutError } from "../client/ws-client.ts"
