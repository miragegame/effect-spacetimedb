import * as Effect from "effect/Effect"

import type { AnyModuleSpec } from "../contract/module.ts"

import {
  assertOwnedHandler,
  assertOwnedHandlerBundle,
  withHandlerBundleOwner,
  type OwnedHandlerBundle,
} from "./handler-ownership.ts"

import {
  clientConnected as makeClientConnectedHandler,
  clientDisconnected as makeClientDisconnectedHandler,
  init as makeInitHandler,
  type LifecycleHandler,
} from "./lifecycle.ts"

import {
  procedure as makeProcedureHandler,
  type ProcedureHandler,
} from "./procedure.ts"

import {
  reducer as makeReducerHandler,
  type ReducerHandler,
} from "./reducer.ts"

import type {
  AnonymousViewAllowedRequirements,
  HandlerInputDefinitions,
  HandlerWithoutForbiddenRequirements,
  Handlers,
  HttpHandlerAllowedRequirements,
  HttpHandlerHandlerRecord,
  LifecycleHandlerRecord,
  ProcedureAllowedRequirements,
  ProcedureHandlerRecord,
  ReducerAllowedRequirements,
  ReducerHandlerRecord,
  SenderViewAllowedRequirements,
  ViewHandlerRecord,
  ViewKeys,
} from "./handler-types.ts"

import {
  httpHandler as makeHttpHandlerHandler,
  type HttpHandlerHandler,
} from "./http-handler.ts"

import {
  anonymousView as makeAnonymousViewHandler,
  view as makeViewHandler,
  type ViewHandler,
} from "./view.ts"

import {
  assertKnownHandlerKey,
  isOwnedHandler,
  isOwnedHandlerBundle,
} from "./bind-support.ts"

export const makeHandlerInputFactory = <
  Module extends AnyModuleSpec,
  RuntimeR,
>(options: {
  readonly module: Module
  readonly owner: symbol
}) => {
  const { module, owner } = options

  function reducer<Args, A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      (args: Args) => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ): ReducerHandler<Args, A, E, R>
  function reducer<Args, A, E, R>(
    handler: (args: Args) => Effect.Effect<A, E, R>,
  ): ReducerHandler<Args, A, E, R> {
    return makeReducerHandler(owner, handler)
  }

  function procedure<A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ProcedureAllowedRequirements
    >,
  ): ProcedureHandler<void, A, E, R>
  function procedure<Args, A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      (args: Args) => Effect.Effect<A, E, R>,
      ProcedureAllowedRequirements
    >,
  ): ProcedureHandler<Args, A, E, R>
  function procedure<Args, A, E, R>(
    handler:
      | ((args: Args) => Effect.Effect<A, E, R>)
      | (() => Effect.Effect<A, E, R>),
  ): ProcedureHandler<Args, A, E, R> {
    return makeProcedureHandler(
      owner,
      handler as (args: Args) => Effect.Effect<A, E, R>,
    )
  }

  function httpHandler<Args, A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      (args: Args) => Effect.Effect<A, E, R>,
      HttpHandlerAllowedRequirements
    >,
  ): HttpHandlerHandler<Args, A, E, R>
  function httpHandler<Args, A, E, R>(
    handler: (args: Args) => Effect.Effect<A, E, R>,
  ): HttpHandlerHandler<Args, A, E, R> {
    return makeHttpHandlerHandler(owner, handler)
  }

  function view<Args, A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      (args: Args) => Effect.Effect<A, E, R>,
      SenderViewAllowedRequirements
    >,
  ): ViewHandler<Args, A, E, R>
  function view<Args, A, E, R>(
    handler: (args: Args) => Effect.Effect<A, E, R>,
  ): ViewHandler<Args, A, E, R> {
    return makeViewHandler(owner, handler)
  }

  function anonymousView<Args, A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      (args: Args) => Effect.Effect<A, E, R>,
      AnonymousViewAllowedRequirements
    >,
  ): ViewHandler<Args, A, E, R>
  function anonymousView<Args, A, E, R>(
    handler: (args: Args) => Effect.Effect<A, E, R>,
  ): ViewHandler<Args, A, E, R> {
    return makeAnonymousViewHandler(owner, handler)
  }

  const init = <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ): LifecycleHandler<A, E, R> => makeInitHandler(owner, handler)

  const clientConnected = <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ): LifecycleHandler<A, E, R> => makeClientConnectedHandler(owner, handler)

  const clientDisconnected = <A, E, R>(
    handler: HandlerWithoutForbiddenRequirements<
      () => Effect.Effect<A, E, R>,
      ReducerAllowedRequirements
    >,
  ): LifecycleHandler<A, E, R> => makeClientDisconnectedHandler(owner, handler)

  type SimpleHandler = (
    args: unknown,
  ) => Effect.Effect<unknown, unknown, unknown>

  const wrapSimpleRecord =
    <Wrapped>(
      label: string,
      section: string,
      knownKeys: Record<string, unknown>,
      make: (owner: symbol, handler: SimpleHandler) => unknown,
    ) =>
    (handlerSpecs: Record<string, unknown> | undefined): Wrapped | undefined =>
      handlerSpecs != null
        ? (Object.fromEntries(
            Object.entries(handlerSpecs).map(([key, handler]) => {
              assertKnownHandlerKey(label, key, knownKeys)
              if (isOwnedHandler(handler)) {
                assertOwnedHandler(owner, handler, `${section}.${key}`)
                return [key, handler]
              }

              return [key, make(owner, handler as SimpleHandler)]
            }),
          ) as Wrapped)
        : undefined

  const wrapReducerRecord = wrapSimpleRecord<
    ReducerHandlerRecord<Module, RuntimeR>
  >("reducer", "reducers", module.reducers, makeReducerHandler)

  const wrapProcedureRecord = wrapSimpleRecord<
    ProcedureHandlerRecord<Module, RuntimeR>
  >("procedure", "procedures", module.procedures, makeProcedureHandler)

  const wrapHttpHandlerRecord = wrapSimpleRecord<
    HttpHandlerHandlerRecord<Module, RuntimeR>
  >("HTTP", "httpHandlers", module.httpHandlers, makeHttpHandlerHandler)

  const wrapViewRecord = (
    handlerSpecs: Record<string, unknown> | undefined,
  ): ViewHandlerRecord<Module, RuntimeR> | undefined =>
    handlerSpecs != null
      ? (Object.fromEntries(
          Object.entries(handlerSpecs).map(([key, handler]) => {
            assertKnownHandlerKey("view", key, module.views)
            if (isOwnedHandler(handler)) {
              assertOwnedHandler(owner, handler, `views.${key}`)
              return [key, handler]
            }

            const spec = module.views[key as ViewKeys<Module>]
            if (spec === undefined) {
              throw new Error(`Unknown view handler key ${key}`)
            }

            const raw = handler as (
              args: unknown,
            ) => Effect.Effect<unknown, unknown, unknown>

            switch (spec.context) {
              case "sender":
                return [key, makeViewHandler(owner, raw)]
              case "anonymous":
                return [key, makeAnonymousViewHandler(owner, raw)]
              default:
                const _exhaustive: never = spec.context
                return _exhaustive
            }
          }),
        ) as ViewHandlerRecord<Module, RuntimeR>)
      : undefined

  const wrapLifecycleRecord = (
    handlerSpecs: Record<string, unknown> | undefined,
  ): LifecycleHandlerRecord<Module, RuntimeR> | undefined =>
    handlerSpecs != null
      ? (Object.fromEntries(
          Object.entries(handlerSpecs).map(([key, handler]) => {
            assertKnownHandlerKey("lifecycle", key, module.lifecycle)
            if (isOwnedHandler(handler)) {
              assertOwnedHandler(owner, handler, `lifecycle.${key}`)
              return [key, handler]
            }

            const raw = handler as () => Effect.Effect<
              unknown,
              unknown,
              unknown
            >
            const wrapped =
              key === "init"
                ? makeInitHandler(owner, raw)
                : key === "clientConnected"
                  ? makeClientConnectedHandler(owner, raw)
                  : key === "clientDisconnected"
                    ? makeClientDisconnectedHandler(owner, raw)
                    : undefined

            if (wrapped == null) {
              throw new Error(`Unknown lifecycle handler key ${key}`)
            }

            return [key, wrapped]
          }),
        ) as LifecycleHandlerRecord<Module, RuntimeR>)
      : undefined

  function handlers(
    definitions: HandlerInputDefinitions<Module, RuntimeR>,
  ): Handlers<Module, RuntimeR>
  function handlers(definitions: OwnedHandlerBundle): Handlers<Module, RuntimeR>
  function handlers(
    definitions: HandlerInputDefinitions<Module, unknown> | OwnedHandlerBundle,
  ): Handlers<Module, RuntimeR> {
    if (isOwnedHandlerBundle(definitions)) {
      assertOwnedHandlerBundle(owner, definitions)
      return definitions as Handlers<Module, RuntimeR>
    }

    const reducers = wrapReducerRecord(definitions.reducers)
    const procedures = wrapProcedureRecord(definitions.procedures)
    const httpHandlers = wrapHttpHandlerRecord(definitions.httpHandlers)
    const views = wrapViewRecord(definitions.views)
    const lifecycle = wrapLifecycleRecord(definitions.lifecycle)

    const assembled = {
      ...(reducers != null ? { reducers } : {}),
      ...(procedures != null ? { procedures } : {}),
      ...(httpHandlers != null ? { httpHandlers } : {}),
      ...(views != null ? { views } : {}),
      ...(lifecycle != null ? { lifecycle } : {}),
    }
    return withHandlerBundleOwner(owner, assembled) as Handlers<
      Module,
      RuntimeR
    >
  }

  return {
    anonymousView,
    clientConnected,
    clientDisconnected,
    handlers,
    httpHandler,
    init,
    procedure,
    reducer,
    view,
  } as const
}
