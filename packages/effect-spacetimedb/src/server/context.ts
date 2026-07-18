import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type { StdbDecodeError } from "../decode-error.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ModuleBrand } from "../identity-brand.ts"
import type { ServerQueryRoot } from "../query/types.ts"
import { prefixId } from "../utils.ts"
import type {
  EffectDbView,
  EffectHttpClient,
  ReadonlyEffectDbView,
  StdbHostFailure,
} from "./services.ts"
import type {
  AnonymousViewCtxLike,
  BaseReducerCtx,
  HttpHandlerCtxLike,
  ProcedureCtxLike,
  ServerDatabaseIdentity,
  ServerConnectionId,
  ServerIdentity,
  ServerRandom,
  ServerSender,
  ServerSenderAuth,
  ServerTimestamp,
  ServerUuid,
  ViewCtxLike,
} from "./runtime-types.ts"

type AnyReducerCtxService = {
  readonly sender: ServerSender
  readonly databaseIdentity: ServerDatabaseIdentity
  /** @deprecated Use `databaseIdentity` instead. */
  readonly identity: ServerIdentity
  readonly timestamp: ServerTimestamp
  readonly connectionId: ServerConnectionId
  readonly db: Record<string, unknown>
  readonly senderAuth: ServerSenderAuth
  readonly newUuidV4: () => ServerUuid
  readonly newUuidV7: () => ServerUuid
  readonly random: ServerRandom
}

type AnyProcedureCtxService = Omit<
  AnyReducerCtxService,
  "db" | "senderAuth"
> & {
  readonly http: ProcedureCtxLike<AnyModuleSpec>["http"]
  readonly withTx: <A>(body: (ctx: AnyReducerCtxService) => A) => A
}

type AnyHttpHandlerCtxService = {
  readonly timestamp: ServerTimestamp
  readonly http: HttpHandlerCtxLike<AnyModuleSpec>["http"]
  readonly databaseIdentity: ServerDatabaseIdentity
  readonly withTx: <A>(
    body: (ctx: { readonly db: Record<string, unknown> }) => A,
  ) => A
  readonly newUuidV4: () => ServerUuid
  readonly newUuidV7: () => ServerUuid
  readonly random: ServerRandom
}

type AnyViewCtxService = {
  readonly sender: ServerSender
  readonly db: Record<string, unknown>
  readonly from: unknown
}

type AnyAnonymousViewCtxService = {
  readonly db: Record<string, unknown>
  readonly from: unknown
}

type AnyQueryRelation = {
  readonly toSql: () => string
  readonly build: () => unknown
}

type AnyFromService = Record<string, AnyQueryRelation>

export type ReducerCtxService<Module extends AnyModuleSpec> =
  BaseReducerCtx<Module>

export type ProcedureCtxService<Module extends AnyModuleSpec> =
  ProcedureCtxLike<Module>

export type HttpHandlerCtxService<Module extends AnyModuleSpec> =
  HttpHandlerCtxLike<Module>

export type TxCtxService<Module extends AnyModuleSpec> = BaseReducerCtx<Module>

export type MutationCtxService<Module extends AnyModuleSpec> =
  BaseReducerCtx<Module>

export type ViewCtxService<Module extends AnyModuleSpec> = ViewCtxLike<Module>

export type AnonymousViewCtxService<Module extends AnyModuleSpec> =
  AnonymousViewCtxLike<Module>

export type DbService<Module extends AnyModuleSpec> = EffectDbView<Module>

export type ReadonlyDbService<Module extends AnyModuleSpec> =
  ReadonlyEffectDbView<Module>

export type FromService<Module extends AnyModuleSpec> = ServerQueryRoot<Module>

export type HttpService<_Module extends AnyModuleSpec> = EffectHttpClient

export type AnyServerContextRequirements =
  | ReducerCtx
  | ProcedureCtx
  | HttpHandlerCtx
  | TxCtx
  | MutationCtx
  | ViewCtx
  | AnonymousViewCtx
  | Db
  | ReadonlyDb
  | From
  | Http
  | TxRunner
  | HttpTxRunner

export type ReducerAllowedRequirements = ReducerCtx | MutationCtx | Db

// Procedures may only access Db through withTx(...).
export type ProcedureAllowedRequirements = ProcedureCtx | Http | TxRunner

export type HttpHandlerAllowedRequirements =
  | HttpHandlerCtx
  | Http
  | HttpTxRunner

export type SenderViewAllowedRequirements = ViewCtx | ReadonlyDb | From

export type AnonymousViewAllowedRequirements =
  | AnonymousViewCtx
  | ReadonlyDb
  | From

export type TxAllowedRequirements = TxCtx | MutationCtx | Db

export type ModuleScopedRequirement<
  Module extends AnyModuleSpec,
  Requirement,
> = Requirement extends Http
  ? Requirement
  : Requirement & ModuleBrand<Module["name"] & string>

export type ModuleScopedAllowedRequirements<
  Module extends AnyModuleSpec,
  Allowed,
> = Allowed extends AnyServerContextRequirements
  ? ModuleScopedRequirement<Module, Allowed>
  : never

export type ReducerAllowedRequirementsFor<Module extends AnyModuleSpec> =
  ModuleScopedAllowedRequirements<Module, ReducerAllowedRequirements>

export type ProcedureAllowedRequirementsFor<Module extends AnyModuleSpec> =
  ModuleScopedAllowedRequirements<Module, ProcedureAllowedRequirements>

export type HttpHandlerAllowedRequirementsFor<Module extends AnyModuleSpec> =
  ModuleScopedAllowedRequirements<Module, HttpHandlerAllowedRequirements>

export type SenderViewAllowedRequirementsFor<Module extends AnyModuleSpec> =
  ModuleScopedAllowedRequirements<Module, SenderViewAllowedRequirements>

export type AnonymousViewAllowedRequirementsFor<Module extends AnyModuleSpec> =
  ModuleScopedAllowedRequirements<Module, AnonymousViewAllowedRequirements>

export type TxAllowedRequirementsFor<Module extends AnyModuleSpec> =
  ModuleScopedAllowedRequirements<Module, TxAllowedRequirements>

export type HttpTxAllowedRequirementsFor<Module extends AnyModuleSpec> =
  ModuleScopedAllowedRequirements<Module, Db>

type EffectServicesOf<EffectType> = EffectType extends Effect.Effect<
  infer _A,
  infer _E,
  infer R
>
  ? R
  : never

type EffectChannelTop = {} | null | undefined

export type AnyServerEffect = Effect.Effect<
  EffectChannelTop,
  EffectChannelTop,
  EffectChannelTop
>

export type EffectWithoutForbiddenRequirements<
  EffectType extends AnyServerEffect,
  Allowed extends AnyServerContextRequirements,
> = [ForbiddenRequirements<EffectType, Allowed>] extends [never]
  ? EffectType
  : [ModuleNameOfRequirement<Allowed>] extends [never]
    ? never
    : DiagnosticRecord<
        ForbiddenRequirementDiagnosticKeys<
          ForbiddenRequirements<EffectType, Allowed>,
          ModuleNameOfRequirement<Allowed>
        >
      >

export type RemainingRequirements<
  EffectType extends AnyServerEffect,
  Provided extends AnyServerContextRequirements,
> = Exclude<EffectServicesOf<EffectType>, Provided>

type DiagnosticRecord<Keys extends string> = [Keys] extends [never]
  ? unknown
  : {
      readonly [Key in Keys]: never
    }

type ForbiddenRequirements<
  EffectType extends AnyServerEffect,
  Allowed extends AnyServerContextRequirements,
> = Exclude<
  Extract<EffectServicesOf<EffectType>, AnyServerContextRequirements>,
  Allowed
>

type ModuleNameOfRequirement<Requirement> = Requirement extends ModuleBrand<
  infer Name
>
  ? Name
  : never

type ContextServiceName<Service> = Service extends {
  readonly key: infer Key extends string
}
  ? Key extends `effect-spacetimedb/Server/${infer Name}`
    ? Name
    : Key
  : "unknown service"

type ForbiddenRequirementDiagnosticKeys<
  Requirement,
  TargetModuleName extends string,
> = Requirement extends unknown
  ? ModuleNameOfRequirement<Requirement> extends infer SourceModuleName extends
      string
    ? `Effect uses module '${SourceModuleName}' ${ContextServiceName<Requirement>} inside module '${TargetModuleName}'`
    : `Effect yields the raw ${ContextServiceName<Requirement>} tag; use this module's accessor`
  : never

export type TxRunnerService<Module extends AnyModuleSpec> = {
  readonly run: <A, E, R>(
    effect: EffectWithoutForbiddenRequirements<
      Effect.Effect<A, E, R>,
      TxAllowedRequirementsFor<Module>
    >,
  ) => Effect.Effect<
    A,
    E | StdbHostFailure | StdbDecodeError,
    Exclude<R, TxAllowedRequirementsFor<Module>>
  >
}

export type HttpTxRunnerService<Module extends AnyModuleSpec> = {
  readonly run: <A, E, R>(
    effect: EffectWithoutForbiddenRequirements<
      Effect.Effect<A, E, R>,
      HttpTxAllowedRequirementsFor<Module>
    >,
  ) => Effect.Effect<
    A,
    E | StdbHostFailure | StdbDecodeError,
    Exclude<R, HttpTxAllowedRequirementsFor<Module>>
  >
}

export class ReducerCtx extends Context.Service<
  ReducerCtx,
  AnyReducerCtxService
>()(prefixId("Server/ReducerCtx")) {}

export class ProcedureCtx extends Context.Service<
  ProcedureCtx,
  AnyProcedureCtxService
>()(prefixId("Server/ProcedureCtx")) {}

export class HttpHandlerCtx extends Context.Service<
  HttpHandlerCtx,
  AnyHttpHandlerCtxService
>()(prefixId("Server/HttpHandlerCtx")) {}

export class TxCtx extends Context.Service<TxCtx, AnyReducerCtxService>()(
  prefixId("Server/TxCtx"),
) {}

export class MutationCtx extends Context.Service<
  MutationCtx,
  AnyReducerCtxService
>()(prefixId("Server/MutationCtx")) {}

export class ViewCtx extends Context.Service<ViewCtx, AnyViewCtxService>()(
  prefixId("Server/ViewCtx"),
) {}

export class AnonymousViewCtx extends Context.Service<
  AnonymousViewCtx,
  AnyAnonymousViewCtxService
>()(prefixId("Server/AnonymousViewCtx")) {}

export class Db extends Context.Service<Db, Record<string, unknown>>()(
  prefixId("Server/Db"),
) {}

export class ReadonlyDb extends Context.Service<
  ReadonlyDb,
  Record<string, unknown>
>()(prefixId("Server/ReadonlyDb")) {}

export class From extends Context.Service<From, AnyFromService>()(
  prefixId("Server/From"),
) {}

export class Http extends Context.Service<Http, EffectHttpClient>()(
  prefixId("Server/Http"),
) {}

export class TxRunner extends Context.Service<
  TxRunner,
  TxRunnerService<AnyModuleSpec>
>()(prefixId("Server/TxRunner")) {}

export class HttpTxRunner extends Context.Service<
  HttpTxRunner,
  HttpTxRunnerService<AnyModuleSpec>
>()(prefixId("Server/HttpTxRunner")) {}

// These tags are intentionally declared over AnyModuleSpec, so their structural
// brand is widened and inert. Module accessors below manufacture the concrete
// brand at the only runtime boundary where a module is known.
const moduleScopedContextEffect = <
  Module extends AnyModuleSpec,
  A,
  Requirement extends AnyServerContextRequirements,
>(
  effect: Effect.Effect<A, never, Requirement>,
): Effect.Effect<A, never, ModuleScopedRequirement<Module, Requirement>> =>
  // Server context accessor boundary: this narrows a shared runtime tag to the
  // module that requested it; the tag identity itself remains global.
  // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off
  effect as Effect.Effect<
    A,
    never,
    ModuleScopedRequirement<Module, Requirement>
  >

export const txRunnerForModule = <Module extends AnyModuleSpec>() =>
  moduleScopedContextEffect<Module, TxRunnerService<Module>, TxRunner>(
    Effect.map(
      TxRunner,
      (txRunner) => txRunner as unknown as TxRunnerService<Module>,
    ),
  )

export const httpTxRunnerForModule = <Module extends AnyModuleSpec>() =>
  moduleScopedContextEffect<Module, HttpTxRunnerService<Module>, HttpTxRunner>(
    Effect.map(
      HttpTxRunner,
      (txRunner) => txRunner as unknown as HttpTxRunnerService<Module>,
    ),
  )
