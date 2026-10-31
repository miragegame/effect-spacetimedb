import * as Context from "effect/Context"
import type { Identity } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ModulePlan } from "../module-plan.ts"
import { prefixId } from "../utils.ts"
import type {
  GeneratedErrorContextOf,
  ManagedWsConnection,
} from "./generated-ws-adapter.ts"
import { canonicalValueKey } from "./table-ref.ts"
import type { makeFromModulePlan as makeWsClient } from "./ws-client.ts"

/**
 * The session a WebSocket client resource yields, and the Context keys that
 * carry it: one key per module name and session name.
 */

type Simplify<Value> = { readonly [Key in keyof Value]: Value[Key] } & {}

type WsClientRuntime<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
> = Simplify<
  ReturnType<typeof makeWsClient<Module, ErrorContext, RelationContext>>
>

export type WsSession<
  Module extends AnyModuleSpec,
  ErrorContext = unknown,
  RelationContext = unknown,
> = Simplify<
  WsClientRuntime<Module, ErrorContext, RelationContext> & {
    readonly connection: ManagedWsConnection<
      Module,
      ErrorContext,
      RelationContext
    >
    readonly identity: Identity
    readonly token: string
  }
>

export type SessionOf<
  Module extends AnyModuleSpec,
  ConnectionClass,
  RelationContext = unknown,
> = WsSession<Module, GeneratedErrorContextOf<ConnectionClass>, RelationContext>

export declare const WsSessionTagTypeId: unique symbol

export type WsSessionTagIdentifier<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
> = {
  readonly [WsSessionTagTypeId]: {
    readonly module: Module["name"]
    readonly errorContext: ErrorContext
    readonly relationContext: RelationContext
  }
}

export type WsSessionTag<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
> = Context.Key<
  WsSessionTagIdentifier<Module, ErrorContext, RelationContext>,
  WsSession<Module, ErrorContext, RelationContext>
>

const sessionTagIdForModule = (module: AnyModuleSpec, name: string): string =>
  // Same-named module objects intentionally share a Context key, matching the
  // HTTP client tag precedent; use name to distinguish multiple WS sessions.
  prefixId(`Client/WsSession/${canonicalValueKey([module.name, name])}`)

const sessionTagForModule = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  module: Module,
  name = "default",
): WsSessionTag<Module, ErrorContext, RelationContext> =>
  Context.Service<
    WsSessionTagIdentifier<Module, ErrorContext, RelationContext>,
    WsSession<Module, ErrorContext, RelationContext>
  >(sessionTagIdForModule(module, name))

export const sessionTag = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  module: Module,
  name?: string,
) => sessionTagForModule<Module, ErrorContext, RelationContext>(module, name)

export const sessionTagFromModulePlan = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  plan: ModulePlan<Module>,
  name?: string,
) =>
  sessionTagForModule<Module, ErrorContext, RelationContext>(plan.module, name)
