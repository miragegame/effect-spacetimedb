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
  "spacetime:sys@2.2": spacetimeSysStub,
} as const

export type {
  DeclRecordUnion,
  DeclRecordUnionWithGroupErrors,
  EndpointsOfGroup,
  ErrorsOfGroup,
  Expand,
  GroupEndpointPair,
  HttpGroupPair,
  HttpHandlerRecordsFromDecls,
  HttpHandlerRecordsFromDeclsWithGroupErrors,
  HttpHandlerRecordsFromDeclsWithOptionalGroupErrors,
  LifecycleNamesFromDecls,
  LifecycleRecordFromNames,
  LifecycleRecordsFromDecls,
  LiteralLifecycleName,
  MergeConstrainedRecordUnion,
  MergeErrorDefinitions,
  MergeRecordUnion,
  NonEmptyReadonlyArray,
  ProcedureRecordsFromDecls,
  ProcedureRecordsFromDeclsWithGroupErrors,
  ProcedureRecordsFromDeclsWithOptionalGroupErrors,
  RecordFromDecls,
  RecordFromDeclsWithGroupErrors,
  ReducerRecordsFromDecls,
  ReducerRecordsFromDeclsWithGroupErrors,
  ReducerRecordsFromDeclsWithOptionalGroupErrors,
  SchedulePair,
  SpecWithGroupErrors,
  UnionToIntersection,
  ViewRecordsFromDecls,
  WithErrors,
} from "./builder/type-utils.ts"
export {
  bindCallables,
  type BindCallablesOptions,
  type BoundCallable,
  type BoundCallableRecord,
  type HandlerInput,
  type HandlerSection,
  type RawHandlerRecord,
  type RawSectionedHandlers,
  type TestCallables,
} from "./testing/bind-callables.ts"
export * as IdcPump from "./testing/idc-pump.ts"
export {
  IdcDelivery,
  type IdcPumpDatabase,
  type IdcPumpHarness,
  type IdcPumpLink,
  type IdcPumpReceiver,
  type IdcPumpRecordingReceiver,
  type IdcRecordedCall,
  makeIdcPump,
  type PumpCallable,
} from "./testing/idc-pump.ts"
export {
  TestModuleEnvironmentDefect,
  type TestModuleEnvironmentUpdate,
  type TestModuleEnvironmentValues,
} from "./testing/module-environment.ts"
export {
  type HarnessOverrides,
  makeTestModuleHarness,
  NestedTestTransactionDefect,
  type OutboxTableKeys,
  type ProcedureHarnessOverrides,
  type TestModuleHarness,
  type TestModuleRowWrite,
} from "./testing/module-harness.ts"
export type {
  AnonymousViewDecl,
  AnyCallableDecl,
  AnyEndpointDecl,
  AnyGroup,
  AnyHttpRouteDecl,
  LifecycleDecl,
  ProcedureDecl,
  RawHttpRouteDecl,
  ReducerDecl,
  RuntimeModuleState,
  ScheduledCallableMetadata,
  ScheduledParams,
  ScheduledProcedureDecl,
  ScheduledProcedureSpec,
  ScheduledReducerDecl,
  ScheduledReducerSpec,
  SenderViewDecl,
  TypedHttpRouteDecl,
} from "./builder/declarations.ts"
export type {
  AnyBuilderImpl,
  AnyModule,
  BuildPlan,
  GroupImpl,
  LifecycleImpl,
  MountImpl,
} from "./builder/handler-types.ts"
export type {
  Group,
  HttpGroup,
} from "./builder/http-builders.ts"
export type {
  HttpHandlerCallableDescriptor,
  ProcedureCallableDescriptor,
  ReducerCallableDescriptor,
} from "./callable-protocol.ts"
export type {
  ConstraintSpec,
  UniqueConstraintSpec,
} from "./contract/constraint.ts"
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
} from "./contract/diagnostic.ts"
export type {
  Declaration,
  Declarations,
  LiteralDeclaration,
  LiteralValues,
  SecretDeclaration,
  StringDeclaration,
  SuppliedValueOf,
} from "./contract/environment.ts"
export type {
  AnyErrorDefinition,
  ClassesOfInput,
  ClassesOfItem,
  DefinitionOfInput,
  DefinitionOfInputOrUndefined,
  ErrorDefinition,
  ErrorInstanceOf,
  ErrorInstances,
  ErrorsInput,
  ErrorsInputItem,
  ErrorTagOf,
  PickedErrorClass,
  PickedErrorClasses,
  ProcedureDeclaredErrorType,
  TaggedErrorClass,
} from "./contract/error.ts"
export type {
  AnyFieldType,
  AnyNormalizedFieldOptions,
  FieldOptions,
  FieldOptionsOf,
  FieldType,
  FieldValue,
  NormalizedFieldOptions,
} from "./contract/field.ts"
export type {
  HttpHandlerMethod,
  HttpHandlerSpec,
  RawHttpHandlerSpec,
  TypedHttpHandlerSpec,
} from "./contract/http-handler.ts"
export type {
  LifecycleName,
  LifecycleSpec,
  LifecycleSpecs,
} from "./contract/lifecycle.ts"
export type {
  AnyModuleSpec,
  ModuleSpec,
  ModuleWireNames,
} from "./contract/module.ts"
export type {
  ModuleMount,
  MountRecord,
  MountsOf,
  NativeMount,
} from "./contract/mount.ts"
export type { OutboxResult } from "./contract/outbox-result.ts"
export {
  type OutboxMetadata,
  OutboxRowTooLargeError,
} from "./contract/outbox-table.ts"
export type { ProcedureSpec } from "./contract/procedure.ts"
export type { ReducerSpec } from "./contract/reducer.ts"
export type {
  AnyRemoteInterface,
  PeerIdentity,
  RemoteInterface,
} from "./contract/remote-interface.ts"
export type {
  CaseConversionPolicy,
  ModuleSettings,
} from "./contract/settings.ts"
export type { TableCachePolicy } from "./contract/table-cache-policy.ts"
export type {
  IndexAlgorithm,
  IndexSpec,
} from "./contract/table-index.ts"
export type {
  ColumnKey,
  PrimaryKeyNames,
  SinglePrimaryKeyName,
  SingleUnionMember,
} from "./contract/table-keys.ts"
export type {
  AnyScheduledTableSpec,
  AnyTableSpec,
  TableRow,
  TableSpec,
} from "./contract/table.ts"
export {
  type AnyValueType,
  type ArrayLengthBounds,
  type ArrayValueType,
  type Encoded,
  type EncodedOf,
  type HostOf,
  type HostStruct,
  type HostValue,
  type MergeTableFieldOptions,
  type NormalizedStructFieldOptions,
  type OptionValueType,
  StdbValueCodecError,
  type StringValueType,
  type StructFieldOptions,
  type StructFields,
  type StructFieldType,
  type StructLikeValueType,
  type StructValueType,
  type TableFieldOptionsOfValue,
  type Type,
  type TypeKind,
  type TypeOf,
  type UnitValueType,
  type ValueType,
} from "./contract/type/core.ts"
export type {
  OptionalKeys,
  OptionalStructField,
  OptionWire,
  RequiredKeys,
  StructType,
  UnitWire,
} from "./contract/type/shapes.ts"
export type {
  AnyViewSpec,
  BaseViewSpec,
  EmptyViewParamsType,
  ViewSpec,
} from "./contract/view.ts"
export {
  StdbDecodeError,
  type StdbDecodePhase,
} from "./decode-error.ts"
export type {
  BodyInit,
  Headers,
  HeadersInit,
  Request,
  RequestInit,
  ResponseInit,
  SyncResponse,
} from "./http-primitives.ts"
export type { ModuleBrand } from "./identity-brand.ts"
export type {
  Below,
  Entries,
  MembersByPath,
  MountedEntries,
  NestedMembers,
  Prefix,
} from "./member-path.ts"
export type {
  ModulePlan,
  PlannedMember,
  PlanSection,
} from "./module-plan.ts"
export type {
  HostInvokedFunction,
  HttpHandlers,
  OutboxResultBinding,
  PublicEventTables,
  PublicPersistentTables,
  PublicProcedures,
  PublicReducers,
  PublicViewKeys,
  PublicViews,
  ScheduleBinding,
  ViewCallArgsOf,
  ViewItemOf,
  ViewRowOf,
  ViewTakesArgs,
} from "./module-projection.ts"
export type {
  QueryRelation,
  QueryRelationOfTable,
  QueryRowOfType,
  ServerQueryRelationOfTable,
  ServerQueryRoot,
  StdbColumnExpr,
  StdbLiteralColumn,
  StdbPredicate,
  StdbRowExpr,
  TypedQuery,
  TypedQueryRelation,
  ViewQueryResult,
} from "./query/types.ts"
export type {
  AnonymousViewCtx,
  AnyAnonymousViewCtxService,
  AnyFromService,
  AnyHttpHandlerCtxService,
  AnyProcedureCtxService,
  AnyQueryRelation,
  AnyReducerCtxService,
  AnyServerContextRequirements,
  AnyServerEffect,
  AnyViewCtxService,
  ContextServiceName,
  Db,
  EffectServicesOf,
  EffectWithoutForbiddenRequirements,
  Env,
  EnvRequirementFor,
  From,
  Http,
  HttpHandlerCtx,
  HttpTxAllowedRequirements,
  HttpTxAllowedRequirementsFor,
  HttpTxRunner,
  HttpTxRunnerService,
  ModuleNameOfRequirement,
  ModuleScopedAllowedRequirements,
  ModuleScopedRequirement,
  MutationCtx,
  ProcedureCtx,
  ReadonlyDb,
  ReducerCtx,
  TxAllowedRequirements,
  TxAllowedRequirementsFor,
  TxCtx,
  TxRunner,
  TxRunnerService,
  ViewCtx,
  WithEnv,
} from "./server/context.ts"
export type {
  AnyEnvService,
  EnvironmentOfSpec,
  ServerEnvironmentReader,
} from "./server/environment.ts"
export type {
  AnonymousViewAllowedRequirements,
  DeclaredErrorsOf,
  ExtraRequirements,
  HandlerBaseErrors,
  HandlerRequirements,
  HttpHandlerAllowedRequirements,
  HttpHandlerErrors,
  HttpHandlerKeys,
  HttpHandlerRequestOf,
  HttpHandlerResponseOf,
  ModuleLifecycleKeys,
  ParamsOf,
  PresentKeys,
  ProcedureAllowedRequirements,
  ProcedureHandlerErrors,
  ProcedureKeys,
  ReducerAllowedRequirements,
  ReducerHandlerErrors,
  ReducerKeys,
  ReturnsOf,
  SenderViewAllowedRequirements,
  ViewArgsOf,
  ViewHandlerErrors,
  ViewKeys,
  ViewSuccessOf,
} from "./server/handler-types-core.ts"
export type {
  HandlerInputDefinitions,
  Handlers,
  RawHttpHandlerRecord,
  RawLifecycleHandlerRecord,
  RawProcedureHandlerRecord,
  RawReducerHandlerRecord,
  RawViewHandlerRecord,
  SectionFor,
} from "./server/handler-types-inputs.ts"
export type {
  AnonymousViewCtxLike,
  BaseCallableCtx,
  BaseReducerCtx,
  DbShape,
  ExplicitIndexAccessor,
  HttpHandlerCtxLike,
  ImplicitPrimaryKeyAccessor,
  IntArray,
  NativeProcedureHttp,
  PointAccessorFromColumns,
  PrimaryKeyAccessorFromColumns,
  ProcedureCtxLike,
  RangeAccessorFromColumns,
  ServerAnonymousViewCtx,
  ServerConnectionId,
  ServerDatabaseIdentity,
  ServerJsonValue,
  ServerJwtClaims,
  ServerRandom,
  ServerSender,
  ServerSenderAuth,
  ServerSenderViewCtx,
  ServerTimestamp,
  ServerUuid,
  TableHandle,
  TableKey,
  TableSpecOf,
  UniqueAccessorFromColumns,
  ViewCtxLike,
} from "./server/runtime-types.ts"
export {
  type DbEffect,
  type DbFailure,
  type InsertFailure,
  type DbHandleFor,
  type DbStream,
  type EffectDbView,
  type EffectHttpClient,
  type EffectTableHandle,
  type HostFailure,
  type HttpResponseLike,
  type MountedDb,
  type NativeProcedureHttpRequestOptions,
  type OutboxInsertRow,
  type OutboxTableHandle,
  type ProcedureHttpHeadersInit,
  type ProcedureHttpRequestOptions,
  type RawProcedureHttp,
  type ReadonlyDbHandleFor,
  type ReadonlyEffectDbView,
  type ScheduledInsertRow,
  StdbAutoIncOverflowError,
  StdbDeclaredErrorEncodingError,
  StdbHostCallError,
  StdbNoSuchRowError,
  StdbScheduleDelayTooLongError,
  StdbSenderError,
  StdbUniqueAlreadyExistsError,
  type TableAccessors,
  type TableHandleFor,
} from "./server/services.ts"
export type {
  AllPublicTablesSubscriptionTarget,
  EventTableSubscriptionTarget,
  FlatSubscriptionTargets,
  ProjectedSubscriptionTargets,
  PublicEventTableKeys,
  PublicPersistentTableKeys,
  PublicTableKeys,
  QuerySubscriptionTarget,
  TableSubscriptionTarget,
  TableTargetName,
  ViewSubscriptionTarget,
  ViewTargetOf,
} from "./subscription-target.ts"
export type {
  Bound,
  CollapseIndexPoint,
  CompositeIndexRangeBounds,
  CompositeIndexRangeObject,
  ContainsAllColumns,
  ExplicitIndexSpec,
  HasExplicitUniqueConstraint,
  HasImplicitPrimaryKeyUniqueness,
  IndexPoint,
  IndexPointObject,
  IndexPointTuple,
  IndexRange,
  IndexRangeBounds,
  IndexRangeMode,
  IsSameColumnSet,
  IsUniqueIndexColumns,
  Range,
  RangeInput,
  StructuralRange,
} from "./table-index-typing.ts"
export {
  StdbHostEncodeError,
  type StdbHostEncodeErrorFields,
} from "./contract/type/host-codec.ts"
export {
  SpacetimeHostError,
  SpacetimeHostErrorCodes,
  type SpacetimeHostErrorConstructor,
  SpacetimeHostErrors,
  SpacetimeHostErrorsByCode,
} from "./server/host-errors.ts"
export type {
  EncodedModule,
  EncodedTable,
  TestModuleRawDb,
} from "./testing/raw-db.ts"
