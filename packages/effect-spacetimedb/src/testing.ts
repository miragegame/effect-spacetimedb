export * as ClientGeneratedWsAdapter from "./client/generated-ws-adapter.ts"
export * as ClientHttp from "./client/http.ts"
export * as ClientHttpJson from "./client/http-json.ts"
export * as ClientValueCodec from "./client/value-codec.ts"
export * as ClientWs from "./client/ws-client.ts"
export * as ContractCanonicalName from "./contract/canonical-name.ts"
export * as ContractError from "./contract/error.ts"
export * as ContractTypeCodec from "./contract/type/codec.ts"
export * as ContractTypeDescriptor from "./contract/type/descriptor.ts"
export * as ContractTypeName from "./contract/type/name.ts"
export * as ContractTypeSchemaFallback from "./contract/type/schema-fallback.ts"
export * as ContractType from "./contract/type.ts"
export * as SpacetimeSysStub from "./testing/spacetime-sys.ts"

const spacetimeSysStubSpecifier = import.meta.url.endsWith("/dist/testing.js")
  ? "../src/testing/spacetime-sys.ts"
  : "./testing/spacetime-sys.ts"
const spacetimeSysStub = decodeURIComponent(
  new URL(spacetimeSysStubSpecifier, import.meta.url).pathname,
)

export const spacetimeSysAlias = {
  "spacetime:sys@2.0": spacetimeSysStub,
  "spacetime:sys@2.1": spacetimeSysStub,
} as const

export {
  httpHandlerCallable,
  procedureCallable,
  procedureEnvelope,
  procedureResponseType,
  reducerCallable,
} from "./callable-protocol.ts"
export {
  type CallFailure,
  catchRawTags,
  DomainCallError,
  encodeArgsArray,
  type RawCallFailure,
  RemoteRejectedBody,
  RemoteRejectedError,
  StdbDecodeError,
  TransportError,
} from "./client/call-errors.ts"
export {
  decodeStdbEventContext,
  decodeStdbEventContextSync,
  StdbEventContext,
  StdbReducerOutcome,
} from "./client/event-context.ts"
export { type InsertEvent, type RelationHandle } from "./client/relation.ts"
export {
  type EventTableStreamBufferOptions,
  EventTableStreamOverflowError,
  type SessionStreamBufferOptions,
  type TableChange,
  type TableChangeWithContext,
} from "./client/session-stream.ts"
export {
  type StdbTableChangeEvent,
  type SubscriptionBuilderLike,
  type SubscriptionHandleLike,
  type TableGroup,
  type TableGroupSnapshot,
  type WsCallableTransport,
  type WsConnectionLike,
  type WsEventTableStreamOptions,
  type WsStreamOptions,
  type WsTableRow,
} from "./client/ws-client.ts"
export {
  type GeneratedWsBuilderLike,
  type GeneratedWsClientConfig,
  type GeneratedWsConnectionFactory,
  type ManagedWsConnection,
  makeScopedFromModulePlan,
  type WsBuilderConfig,
  type WsCompression,
  WsConnectError,
  type WsGeneratedConfig,
} from "./client/ws-resource.ts"
export {
  type SubscriptionFailure,
  SubscriptionInvalidatedError,
  SubscriptionRejectedError,
  SubscriptionTransportError,
} from "./client/ws-subscription.ts"
export { fromBuilder } from "./client/ws-subscription-adapter.ts"
export { ensureServerPolyfills } from "./compat/polyfills.ts"
export { fieldOptions } from "./contract/field.ts"
export { type AnyModuleSpec } from "./contract/module.ts"
export { type TableRow } from "./contract/table.ts"
export {
  encodeHostValue,
  StdbHostEncodeError,
} from "./contract/type/host-codec.ts"
export { type TypeOf } from "./contract/type.ts"
export { makeModulePlan } from "./module-plan.ts"
export { project } from "./project.ts"
export {
  type ClientQueryRoot,
  type QueryRelation,
  type TypedQuery,
} from "./query/types.ts"
export { make as makeServer, type ServerInstance } from "./server/bind.ts"
export {
  encodeHttpResult,
  HttpRequestDecodeError,
  HttpResponseEncodeError,
  type HttpResult,
  toHttpResponse,
} from "./server/callable-runtime.ts"
export { makeDbHandleFactory } from "./server/db-handle.ts"
export {
  assertOwnedHandlerBundle,
  ServerOwnerSymbol,
} from "./server/handler-ownership.ts"
export { provideConstrainedServerSupport } from "./server/runtime-layer.ts"
export { materializeTableOptions } from "./server/table-options.ts"
