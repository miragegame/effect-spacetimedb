// This entrypoint is intentionally separate from `effect-spacetimedb` and
// `effect-spacetimedb/server`.
//
// Importing `spacetimedb/server` in ordinary Bun/Vitest contexts pulls in the
// SpaceTimeDB module loader surface (`spacetime:sys@2.0`), which is only valid
// for actual STDB module compilation/evaluation. Keeping the compiler behind a
// dedicated subpath makes that boundary explicit.

import "./server-polyfills.ts"
import { planModule } from "./builder/build-plan.ts"
import { internalStdbBuildPlan } from "./builder/internal-build-plan.ts"
import {
  type AnyBuilderImpl,
  type AnyModule,
  type BuildArgsWithoutRuntime,
  type BuildArgsWithRuntime,
  type BuildArgsWithRuntimeMode,
  type BuildOptions,
  type BuildSpec,
  type RuntimeROfImpls,
  type BuildPlan,
} from "./builder.ts"
import { type CompiledModule, compileModule } from "./server/compile-module.ts"
import {
  assertCompilerHostAbiCapabilities,
  CaseConversionPolicy,
  isRowTypedQuery,
  Range,
  Router,
  remoteModule,
  SenderError,
  schema,
  t,
  table,
} from "./server/host-abi-compiler.ts"
import { installServerRangeFactory } from "./server/db-handle-codec.ts"

installServerRangeFactory((from, to) => new Range(from, to))

assertCompilerHostAbiCapabilities({
  CaseConversionPolicy,
  isRowTypedQuery,
  Range,
  Router,
  remoteModule,
  schema,
  SenderError,
  t,
  table,
})

export function build<
  Module extends AnyModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithoutRuntime<Module, Impls>
): CompiledModule<BuildSpec<Module, Impls>>
export function build<
  Module extends AnyModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithRuntimeMode<Module, Impls>
): CompiledModule<BuildSpec<Module, Impls>>
export function build<
  Module extends AnyModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  ...args: BuildArgsWithRuntime<Module, Impls>
): CompiledModule<BuildSpec<Module, Impls>>
export function build<
  Module extends AnyModule,
  const Impls extends ReadonlyArray<AnyBuilderImpl>,
>(
  module: Module,
  impls: Impls,
  options?: BuildOptions<RuntimeROfImpls<Impls>>,
): CompiledModule<BuildSpec<Module, Impls>> {
  const plan =
    options === undefined
      ? planModule(module, impls as never)
      : planModule(module, impls as never, options as never)
  const typedPlan = plan as BuildPlan<
    BuildSpec<Module, Impls>,
    RuntimeROfImpls<Impls>
  >

  return compileModule<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>(
    internalStdbBuildPlan<BuildSpec<Module, Impls>, RuntimeROfImpls<Impls>>(
      typedPlan,
    ),
    // Receiver bindings import `spacetimedb/server`, so only this host-only
    // entrypoint takes them; `planModule` and the test harness need none.
    { receiverBindings: options?.receiverBindings ?? [] },
  )
}

export type { CompiledModule }
export type { ModuleExport as ModuleExportGroup } from "spacetimedb/server"
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
  BuildArgsWithoutRuntime,
  BuildArgsWithRuntime,
  BuildArgsWithRuntimeMode,
  BuildImplsWithoutRuntime,
  BuildImplsWithRuntime,
  BuildOptions,
  BuildOptionsWithoutRuntime,
  BuildOptionsWithRuntime,
  BuildRuntime,
  BuildSpec,
  CoverAllGroups,
  CoverBuildImpls,
  CoverOutboxResultBindings,
  CoverScheduleBindings,
  DuplicateImplGroups,
  DuplicateMountKeys,
  GroupImpl,
  GroupNames,
  ImplGroupName,
  ImplModuleMismatchDiagnosticKeys,
  LifecycleHooksOfImpl,
  LifecycleImpl,
  LifecycleSpecsOfImpls,
  MissingGroups,
  MissingScheduleTargets,
  ModuleNameOf,
  ModuleNameOfImpl,
  MountCoverage,
  MountImpl,
  MountKeyOfImpl,
  NoImplModuleMismatches,
  OutboxTableNames,
  RejectWidenedImplArray,
  RuntimeROfImpl,
  RuntimeROfImpls,
  ScheduledTableNames,
  SchedulePairsOfModule,
  SettledOutboxTableNames,
  SpecWithLifecycle,
  TableNames,
  TupleIndexKeys,
  UnregisteredScheduleTargetTables,
  UnregisteredSettledOutboxTables,
  UnsettledOutboxTables,
} from "./builder/handler-types.ts"
export type {
  Group,
  HttpGroup,
} from "./builder/http-builders.ts"
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
  LifecycleKeysOf,
  LifecycleNamesFromDecls,
  LifecycleRecordFromNames,
  LifecycleRecordsFromDecls,
  LiteralLifecycleName,
  MergeConstrainedRecordUnion,
  MergeErrorDefinitions,
  MergeRecordUnion,
  NonEmptyReadonlyArray,
  OutboxTableNameOf,
  ProcedureRecordsFromDecls,
  ProcedureRecordsFromDeclsWithGroupErrors,
  ProcedureRecordsFromDeclsWithOptionalGroupErrors,
  RecordFromDecls,
  RecordFromDeclsWithGroupErrors,
  ReducerRecordsFromDecls,
  ReducerRecordsFromDeclsWithGroupErrors,
  ReducerRecordsFromDeclsWithOptionalGroupErrors,
  SchedulePair,
  SettledOutboxTableNamesOf,
  SpecOfModule,
  SpecWithGroupErrors,
  UnionToIntersection,
  ViewRecordsFromDecls,
  WithErrors,
} from "./builder/type-utils.ts"
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
  ProcedureDeclaredErrorCarrier,
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
export type { ProcedureSpec } from "./contract/procedure.ts"
export type { ReducerSpec } from "./contract/reducer.ts"
export type {
  AnyRemoteInterface,
  AnyRemoteInterfaceBinding,
  RemoteInterface,
  RemoteInterfaceBinding,
  RemoteModuleBinding,
  RemoteReducerBinding,
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
export type { CompiledExports } from "./server/compile-module.ts"
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
export type { ProcedureHostResultEnvelope } from "./server/declared-errors.ts"
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
  BoundHttpHandlerExports,
  BoundLifecycleExports,
  BoundModule,
  BoundProcedureExports,
  BoundReducerExports,
  BoundViewExports,
} from "./server/handler-types-exports.ts"
export type {
  BoundHttpHandlerExport,
  BoundLifecycleExport,
  BoundProcedureExport,
  BoundReducerExport,
  BoundViewExport,
  HttpHandlerHandlerRecord,
  LifecycleHandlerRecord,
  ProcedureHandlerRecord,
  ProcedureReply,
  RawHttpHandlerRecord,
  RawLifecycleHandlerRecord,
  RawProcedureHandlerRecord,
  RawReducerHandlerRecord,
  RawViewHandlerRecord,
  ReducerHandlerRecord,
  ViewHandlerRecord,
} from "./server/handler-types-inputs.ts"
export type { ConstrainedServerRuntimeMode } from "./server/runtime-layer.ts"
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
  ServerConnectionId,
  ServerDatabaseIdentity,
  ServerJsonValue,
  ServerJwtClaims,
  ServerRandom,
  ServerSender,
  ServerSenderAuth,
  ServerTimestamp,
  ServerUuid,
  TableHandle,
  TableKey,
  TableSpecOf,
  UniqueAccessorFromColumns,
  ViewCtxLike,
} from "./server/runtime-types.ts"
export {
  type EffectHttpClient,
  type HostFailure,
  type HttpResponseLike,
  type NativeProcedureHttpRequestOptions,
  type ProcedureHttpHeadersInit,
  type ProcedureHttpRequestOptions,
  StdbAutoIncOverflowError,
  StdbDeclaredErrorEncodingError,
  StdbHostCallError,
  StdbNoSuchRowError,
  StdbScheduleDelayTooLongError,
  StdbSenderError,
  StdbUniqueAlreadyExistsError,
} from "./server/services.ts"
export type { SyncRunner } from "./server/sync-runner.ts"
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
