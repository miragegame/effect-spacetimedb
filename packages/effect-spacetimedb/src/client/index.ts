import "./http.ts"

export type {
  ArgsFor,
  ErrorsFor,
  HttpHandlerArgsFor,
  HttpHandlerErrorsFor,
  HttpHandlerSuccessFor,
  ProcedureArgsFor,
  ProcedureErrorsFor,
  ProcedureSuccessFor,
  ReducerArgsFor,
  ReducerErrorsFor,
  ReducerSuccessFor,
  SuccessFor,
  ViewArgsFor,
  ViewErrorsFor,
  ViewSuccessFor,
} from "../builder/handler-types.ts"
export {
  declaredErrorGuard,
  type ErrorInstances,
} from "../contract/error.ts"
export {
  compareTimestampAsc,
  compareTimestampDesc,
  timestampAddMillis,
  timestampIsDue,
  timestampToDate,
  timestampToIso,
  timestampToMillis,
} from "../timestamp.ts"
export {
  type CallFailure,
  catchRawTags,
  DomainCallError,
  type RawCallFailure,
  RemoteRejectedBody,
  RemoteRejectedError,
  StdbDecodeError,
  TransportError,
} from "./call-errors.ts"
export {
  decodeStdbEventContext,
  decodeStdbEventContextSync,
  StdbEventContext,
  type StdbEventContext as StdbEventContextType,
  StdbReducerOutcome,
  type StdbReducerOutcome as StdbReducerOutcomeType,
} from "./event-context.ts"
export type { ResultValuesOf } from "./result-values.ts"
export {
  type HttpClientConfig,
  type HttpClientOptions,
  type GroupIdsOf,
  groupFromModulePlan as httpGroupFromModulePlan,
  layerFromModulePlan,
  make as httpMake,
  type ProjectedHttpClient,
  type ProjectedHttpGroupClient,
  type ProjectedHttpClientTag,
  type ProjectedHttpClientTagIdentifier,
} from "./http.ts"
export type { HttpHandlerCallOptions } from "./rpc.ts"
export type {
  EventTableStreamBufferOptions,
  SessionStreamBufferOptions,
  TableChange,
  TableChangeWithContext,
} from "./session-stream.ts"
export {
  EventTableStreamOverflowError,
  TableStreamOverflowError,
} from "./session-stream.ts"
export {
  canonicalizeTableGroupKeys,
  canonicalRowKey,
  canonicalTableGroupKey,
  canonicalTableKey,
  canonicalValueKey,
  type RowRef,
  type RowRefValue,
  subscribeRowRef,
  subscribeSnapshotRef,
  subscribeTableGroupRef,
  subscribeTableRef,
  type TableGroupRef,
  type TableGroupRefValue,
  type TableRef,
  type TableRefFailure,
  type TableRefValue,
} from "./table-ref.ts"
export {
  make as makeWsClient,
  type PublicCache,
  type NativeSubscriptionHandleLike as WsNativeSubscriptionHandleLike,
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
  type WaitUntilOptions,
  WaitUntilTimeoutError,
  unsubscribeThen,
} from "./ws-client.ts"
export {
  GeneratedArtifactShapeError,
  type GeneratedConnectionClassLike,
  type GeneratedConnectionOf,
  type GeneratedErrorContextOf,
  type GeneratedWsBuilderLike,
  type GeneratedWsClientConfig,
  type GeneratedWsConnectionFactory,
  type GeneratedWsErrorContext,
  generatedConnection,
  layer as wsLayer,
  layerGenerated as wsLayerGenerated,
  type ManagedWsConnection,
  type MismatchedGeneratedModuleDiagnostic,
  makeScoped as wsScoped,
  makeScopedGenerated as wsScopedGenerated,
  type SessionOf,
  sessionTag,
  type WsBuilderConfig,
  type WsCompression,
  WsConnectError,
  WsConnectTimeoutError,
  type WsGeneratedConfig,
  type WsSession,
  type WsSessionTag,
  type WsSessionTagIdentifier,
  WsUnsupportedBuilderFeatureError,
} from "./ws-resource.ts"
export { connectAndSubscribe } from "./connect-and-subscribe.ts"
export {
  type SubscriptionFailure,
  SubscriptionInvalidatedError,
  SubscriptionRejectedError,
  SubscriptionTransportError,
} from "./ws-subscription.ts"
