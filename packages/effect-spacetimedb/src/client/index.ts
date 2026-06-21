// lint-ignore: unused-exports - package export map exposes these public client helpers.
import "./http.ts"
import { generated as generatedWsAdapter } from "./ws-resource.ts"

export {
  decodeStdbEventContext,
  decodeStdbEventContextSync,
  StdbEventContext,
  type StdbEventContext as StdbEventContextType,
  StdbReducerOutcome,
  type StdbReducerOutcome as StdbReducerOutcomeType,
} from "./event-context.ts"
export {
  type HttpClientConfig,
  type HttpClientOptions,
  layerFetchFromModulePlan,
  layerFromModulePlan,
  make as httpMake,
  type ProjectedHttpClient,
  type ProjectedHttpClientTag,
  type ProjectedHttpClientTagIdentifier,
} from "./http.ts"
export type { HttpHandlerCallOptions } from "./rpc.ts"
export {
  make as makeWsClient,
  type PublicCache,
  type StdbTableChangeEvent,
  type SubscriptionBuilderLike as WsSubscriptionBuilderLike,
  type SubscriptionHandleLike as WsSubscriptionHandleLike,
  type TableGroup,
  type TableGroupSnapshot,
  type WsCallableTransport,
  type WsClientOptions,
  type WsConnectionLike,
  type WsEventTableStreamOptions,
  type WsStreamOptions,
  type WsTableRow,
} from "./ws-client.ts"
export {
  type GeneratedWsBuilderLike,
  type GeneratedWsClientConfig,
  type GeneratedWsConnectionFactory,
  layer as wsLayer,
  layerGenerated as wsLayerGenerated,
  type ManagedWsConnection,
  makeScoped as wsScoped,
  makeScopedGenerated as wsScopedGenerated,
  sessionTag,
  type WsBuilderConfig,
  type WsCompression,
  WsConnectError,
  type WsGeneratedConfig,
  type WsSession,
  type WsSessionTag,
  type WsSessionTagIdentifier,
  WsUnsupportedBuilderFeatureError,
} from "./ws-resource.ts"

export const GeneratedWs = {
  adapter: generatedWsAdapter,
} as const

export {
  type CallFailure,
  DomainCallError,
  type RawCallFailure,
  RemoteRejectedError,
  StdbDecodeError,
  TransportError,
} from "./call-errors.ts"
export type {
  EventTableStreamBufferOptions,
  SessionStreamBufferOptions,
  TableChange,
  TableChangeWithContext,
} from "./session-stream.ts"
export { EventTableStreamOverflowError } from "./session-stream.ts"
export {
  type SubscriptionFailure,
  SubscriptionInvalidatedError,
  SubscriptionRejectedError,
  SubscriptionTransportError,
} from "./ws-subscription.ts"
