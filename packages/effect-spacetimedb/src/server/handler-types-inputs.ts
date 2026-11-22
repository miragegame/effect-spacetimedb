import type * as Effect from "effect/Effect"

import type * as ErrorCodec from "../contract/error.ts"

import type { LifecycleName } from "../contract/lifecycle.ts"

import type { AnyModuleSpec } from "../contract/module.ts"

import type { Request, SyncResponse } from "../http-primitives.ts"

import type { ProcedureHostResultEnvelope } from "./declared-errors.ts"

import type {
  AnonymousViewCtxLike,
  BaseReducerCtx,
  HttpHandlerCtxLike,
  ProcedureCtxLike,
  ViewCtxLike,
} from "./runtime-types.ts"

import type {
  AnonymousViewAllowedRequirements,
  HttpHandlerAllowedRequirements,
  HttpHandlerErrors,
  HttpHandlerKeys,
  HttpHandlerRequestOf,
  HttpHandlerResponseOf,
  HandlerRequirements,
  ModuleLifecycleKeys,
  ParamsOf,
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
} from "./handler-types-core.ts"

export type SectionFor<Keys extends string, Name extends string, Record> = [
  Keys,
] extends [never]
  ? {
      readonly [Key in Name]?: Record
    }
  : {
      readonly [Key in Name]: Record
    }

export type RawReducerHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
  readonly [Key in ReducerKeys<Module>]: (
    args: ParamsOf<Module["reducers"][Key]>,
  ) => Effect.Effect<
    unknown,
    ReducerHandlerErrors<Module["reducers"][Key]>,
    HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
  >
}

export type RawProcedureHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR,
> = {
  readonly [Key in ProcedureKeys<Module>]: (
    args: ParamsOf<Module["procedures"][Key]>,
  ) => Effect.Effect<
    ReturnsOf<Module["procedures"][Key]>,
    ProcedureHandlerErrors<Module["procedures"][Key]>,
    HandlerRequirements<RuntimeR, ProcedureAllowedRequirements>
  >
}

export type RawHttpHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
  readonly [Key in HttpHandlerKeys<Module>]: (
    args: HttpHandlerRequestOf<Module["httpHandlers"][Key]>,
  ) => Effect.Effect<
    HttpHandlerResponseOf<Module["httpHandlers"][Key]>,
    HttpHandlerErrors<Module["httpHandlers"][Key]>,
    HandlerRequirements<RuntimeR, HttpHandlerAllowedRequirements>
  >
}

export type RawViewHandlerRecord<Module extends AnyModuleSpec, RuntimeR> = {
  readonly [Key in ViewKeys<Module>]: (
    args: ViewArgsOf<Module["views"][Key]>,
  ) => Effect.Effect<
    ViewSuccessOf<Module["views"][Key]>,
    ViewHandlerErrors,
    HandlerRequirements<
      RuntimeR,
      Module["views"][Key]["context"] extends "sender"
        ? SenderViewAllowedRequirements
        : AnonymousViewAllowedRequirements
    >
  >
}

export type RawLifecycleHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR,
> = {
  readonly [Key in ModuleLifecycleKeys<Module>]: () => Effect.Effect<
    unknown,
    unknown,
    HandlerRequirements<RuntimeR, ReducerAllowedRequirements>
  >
}

export type HandlerInputDefinitions<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = SectionFor<
  ReducerKeys<Module>,
  "reducers",
  RawReducerHandlerRecord<Module, RuntimeR>
> &
  SectionFor<
    ProcedureKeys<Module>,
    "procedures",
    RawProcedureHandlerRecord<Module, RuntimeR>
  > &
  SectionFor<
    HttpHandlerKeys<Module>,
    "httpHandlers",
    RawHttpHandlerRecord<Module, RuntimeR>
  > &
  SectionFor<
    ViewKeys<Module>,
    "views",
    RawViewHandlerRecord<Module, RuntimeR>
  > &
  SectionFor<
    ModuleLifecycleKeys<Module>,
    "lifecycle",
    RawLifecycleHandlerRecord<Module, RuntimeR>
  >

/** The handlers a build plan carries, by section. */
export type Handlers<Module extends AnyModuleSpec, RuntimeR = never> = Partial<
  HandlerInputDefinitions<Module, RuntimeR>
>

export type ReducerHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = Partial<RawReducerHandlerRecord<Module, RuntimeR>>

export type ProcedureHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = Partial<RawProcedureHandlerRecord<Module, RuntimeR>>

export type HttpHandlerHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = Partial<RawHttpHandlerRecord<Module, RuntimeR>>

export type ViewHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = Partial<RawViewHandlerRecord<Module, RuntimeR>>

export type LifecycleHandlerRecord<
  Module extends AnyModuleSpec,
  RuntimeR = never,
> = Partial<RawLifecycleHandlerRecord<Module, RuntimeR>>

export type BoundReducerExport<
  Module extends AnyModuleSpec,
  Key extends ReducerKeys<Module>,
> = {
  readonly kind: "reducer"
  readonly key: Key
  readonly spec: Module["reducers"][Key]
  readonly invoke: (
    ctx: BaseReducerCtx<Module>,
    args: ParamsOf<Module["reducers"][Key]>,
  ) => void
  /**
   * Ends a call whose arguments did not decode: a caller's bad arguments are a
   * sender error, and anything else is reported and rethrown.
   */
  readonly rejectArguments: (
    ctx: BaseReducerCtx<Module>,
    cause: unknown,
  ) => never
}

/**
 * A scheduled procedure's reply is its unit return. Every other procedure
 * answers with a result, whose `err` is the versioned string carrier.
 */
export type ProcedureReply<Returns> =
  | ProcedureHostResultEnvelope<
      Returns,
      ErrorCodec.ProcedureDeclaredErrorCarrier
    >
  | undefined

export type BoundProcedureExport<
  Module extends AnyModuleSpec,
  Key extends ProcedureKeys<Module>,
> = {
  readonly kind: "procedure"
  readonly key: Key
  readonly spec: Module["procedures"][Key]
  /** Never throws: the host rebuilds the isolate when a procedure does. */
  readonly invoke: (
    ctx: ProcedureCtxLike<Module>,
    args: ParamsOf<Module["procedures"][Key]>,
  ) => ProcedureReply<ReturnsOf<Module["procedures"][Key]>>
  /** The reply to a call whose arguments did not decode. */
  readonly rejectArguments: (
    ctx: ProcedureCtxLike<Module>,
    cause: unknown,
  ) => ProcedureReply<ReturnsOf<Module["procedures"][Key]>>
  /** The reply to use once a successful reply failed to encode. */
  readonly failReply: (
    ctx: ProcedureCtxLike<Module>,
    cause: unknown,
  ) => ProcedureReply<ReturnsOf<Module["procedures"][Key]>>
}

export type BoundHttpHandlerExport<
  Module extends AnyModuleSpec,
  Key extends HttpHandlerKeys<Module>,
> = {
  readonly kind: "httpHandler"
  readonly key: Key
  readonly spec: Module["httpHandlers"][Key]
  readonly invoke: (
    ctx: HttpHandlerCtxLike<Module>,
    req: Request,
  ) => SyncResponse
}

export type BoundViewExport<
  Module extends AnyModuleSpec,
  Key extends ViewKeys<Module>,
> = {
  readonly kind: "view"
  readonly key: Key
  readonly spec: Module["views"][Key]
  readonly invoke: (
    ctx: Module["views"][Key]["context"] extends "sender"
      ? ViewCtxLike<Module>
      : AnonymousViewCtxLike<Module>,
    args: ViewArgsOf<Module["views"][Key]>,
  ) => ViewSuccessOf<Module["views"][Key]>
  /**
   * Reports a failure after `invoke`, a result that did not encode. A view has no
   * reply, so it still throws.
   */
  readonly reportFailure: (
    ctx: Module["views"][Key]["context"] extends "sender"
      ? ViewCtxLike<Module>
      : AnonymousViewCtxLike<Module>,
    cause: unknown,
  ) => void
  /**
   * Ends a call whose arguments did not decode by rethrowing: a view has no reply.
   * Only a failure that is not the caller's is reported.
   */
  readonly rejectArguments: (
    ctx: Module["views"][Key]["context"] extends "sender"
      ? ViewCtxLike<Module>
      : AnonymousViewCtxLike<Module>,
    cause: unknown,
  ) => never
}

export type BoundLifecycleExport<
  Module extends AnyModuleSpec,
  Key extends LifecycleName,
> = {
  readonly kind: "lifecycle"
  readonly key: Key
  readonly invoke: (ctx: BaseReducerCtx<Module>) => void
}
