// Type-only reachability for the server-compiler export-map entrypoint. This
// keeps ordinary root imports runtime-free while satisfying repo unused-file
// analysis for the dedicated compiler subpath.

export {
  type AnonymousViewDecl,
  type AnyCallableDecl,
  type AnyEndpointDecl,
  type AnyHttpRouteDecl,
  type AnyStdbModule,
  type GroupCheckedHandlers,
  type GroupHandlersRecord,
  type GroupImpl,
  type LifecycleDecl,
  type LifecycleImpl,
  type ProcedureDecl,
  type RawHttpRouteDecl,
  type ReducerDecl,
  type ScheduledProcedureDecl,
  type ScheduledProcedureSpec,
  type ScheduledReducerDecl,
  type ScheduledReducerSpec,
  type SenderViewDecl,
  StdbBuilder,
  StdbFn,
  StdbGroup,
  type StdbGroup as StdbGroupType,
  StdbHttp,
  StdbHttpGroup,
  type StdbHttpGroup as StdbHttpGroupType,
  StdbModule,
  type StdbModule as StdbModuleType,
  type TypedHttpRouteDecl,
} from "./builder.ts"
export type { CallFailure, RawCallFailure } from "./client/call-errors.ts"
export {
  httpApiBaseUrl,
  type ProjectedHttpApi,
  StdbHttpProjectionError,
  toHttpApi,
} from "./client/http-api.ts"
export type {
  ProjectedHttpClientTag,
  ProjectedHttpClientTagIdentifier,
  WsSessionTag,
  WsSessionTagIdentifier,
} from "./client/index.ts"
export {
  type EventTableStreamBufferOptions,
  EventTableStreamOverflowError,
  type SessionStreamBufferOptions,
} from "./client/session-stream.ts"
export type { SubscriptionFailure } from "./client/ws-subscription.ts"
export {
  type ConstraintSpec,
  type UniqueConstraintSpec,
  unique,
} from "./contract/constraint.ts"
export {
  type AnyErrorDefinition,
  type DefinitionOfInput,
  type DefinitionOfInputOrUndefined,
  define as errors,
  type ErrorDefinition,
  type ErrorInstances,
  type ErrorSpec,
  type ErrorsInput,
  type ErrorTags,
  error,
  type NamespacedErrorDefinition,
} from "./contract/error.ts"
export {
  type AnyFieldType,
  type FieldOptions,
  type FieldOptionsOf,
  type FieldType,
  type FieldValue,
} from "./contract/field.ts"
export {
  type HttpHandlerMethod,
  type HttpHandlerSpec,
  HttpRouterExportKey,
  type RawHttpHandlerSpec,
  type TypedHttpHandlerSpec,
} from "./contract/http-handler.ts"
export {
  define as index,
  type IndexAlgorithm,
  type IndexSpec,
} from "./contract/index.ts"
export {
  type LifecycleName,
  type LifecycleSpec,
  type LifecycleSpecs,
} from "./contract/lifecycle.ts"
export { type AnyModuleSpec, type ModuleSpec } from "./contract/module.ts"
export {
  assertValidModule as assertValid,
  formatModuleDiagnostics,
  StdbDiagnostic,
  type StdbDiagnosticCode,
  type StdbDiagnosticSeverity,
  StdbValidationError,
  validateModule as validate,
} from "./contract/module-validation.ts"
export { type ProcedureSpec } from "./contract/procedure.ts"
export { type ReducerSpec } from "./contract/reducer.ts"
export * as ScheduleAt from "./contract/schedule-at.ts"
export { type ModuleSettings } from "./contract/settings.ts"
export {
  type AnyScheduledTableSpec,
  type AnyTableSpec,
  rowType,
  scheduledTable,
  type TableRow,
  type TableSpec,
  table,
} from "./contract/table.ts"
export {
  descriptor as describe,
  type StdbTypeDescriptor,
} from "./contract/type/descriptor.ts"
export { StdbHostEncodeError } from "./contract/type/host-codec.ts"
export type {
  AnyValueType,
  ArrayValueType,
  BigIntValueType,
  BoolValueType,
  BytesValueType,
  Encoded,
  EncodedOf,
  F32ValueType,
  F64ValueType,
  I8ValueType,
  I16ValueType,
  I32ValueType,
  I64ValueType,
  I128ValueType,
  I256ValueType,
  LazyValueType,
  LiteralValueType,
  NumberValueType,
  OptionValueType,
  ResultValueType,
  StdbValueType,
  StringValueType,
  StructFieldOptions,
  StructFields,
  StructFieldsOf,
  StructFieldType,
  StructLikeValueType,
  StructValueType,
  SumValueType,
  SumVariants,
  Type,
  TypeKind,
  TypeOf,
  U8ValueType,
  U16ValueType,
  U32ValueType,
  U64ValueType,
  U128ValueType,
  U256ValueType,
  UnitValueType,
  ValueCodec,
  ValueType,
  ValueTypeInfo,
} from "./contract/type.ts"
export {
  array,
  bigint,
  bool,
  bytes,
  connectionId,
  custom,
  dbCodec,
  enum_ as enum,
  enum_ as enumType,
  f32,
  f64,
  httpCodec,
  i8,
  i16,
  i32,
  i64,
  i128,
  i256,
  identity,
  isUnitValueType,
  lazy,
  literal,
  option,
  optional,
  result,
  StdbValueCodecError,
  scheduleAt,
  string,
  struct,
  sum,
  timeDuration,
  timestamp,
  u8,
  u16,
  u32,
  u64,
  u128,
  u256,
  unit,
  uuid,
  wsCodec,
} from "./contract/type.ts"
export {
  type AnyViewSpec,
  type ViewSpec,
} from "./contract/view.ts"
export { StdbDecodeError } from "./decode-error.ts"
export { Headers, Request, Router, SyncResponse } from "./http-primitives.ts"
export { project } from "./project.ts"
export type {
  ReducerAsyncNotAllowedError,
  ReducerGlobalRandomNotAllowedError,
  ReducerWallClockNotAllowedError,
  StdbAutoIncOverflowError,
  StdbHostCallError,
  StdbHostFailure,
  StdbNoSuchRowError,
  StdbScheduleDelayTooLongError,
  StdbSenderFailure,
  StdbUniqueAlreadyExistsError,
} from "./server/services.ts"
export type { CompiledModule as ServerCompilerBoundary } from "./server-compiler.ts"
export { prefixId } from "./utils.ts"

export const effectSpacetimeDbEntrypoint = "effect-spacetimedb" as const
