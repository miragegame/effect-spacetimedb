import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import type { Identity } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ModulePlan } from "../module-plan.ts"
import { makeModulePlan } from "../module-plan.ts"
import { prefixId } from "../utils.ts"
import { messageFromUnknown } from "./call-errors.ts"
import { connectionStateFor } from "./connection-state.ts"
import {
  configureGeneratedWsBuilder,
  type GeneratedWsBuilderConfig,
  type GeneratedWsClientConfig,
  generatedConfig as generated,
  type ManagedWsConnection,
} from "./generated-ws-adapter.ts"
import { makeFromModulePlan as makeWsClient } from "./ws-client.ts"

export type {
  GeneratedWsBuilderLike,
  GeneratedWsClientConfig,
  GeneratedWsConnectionFactory,
  ManagedWsConnection,
  WsCompression,
} from "./generated-ws-adapter.ts"
export { WsUnsupportedBuilderFeatureError } from "./generated-ws-adapter.ts"

export type WsBuilderConfig<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = GeneratedWsBuilderConfig<Module, ErrorContext, RelationContext>

export type WsGeneratedConfig<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = GeneratedWsClientConfig<Module, ErrorContext, RelationContext>

export { generated }

type WsClientRuntime<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
> = ReturnType<typeof makeWsClient<Module, ErrorContext, RelationContext>>

export type WsSession<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = WsClientRuntime<Module, ErrorContext, RelationContext> & {
  readonly connection: ManagedWsConnection<
    Module,
    ErrorContext,
    RelationContext
  >
  readonly identity: Identity
  readonly token: string
}

/**
 * Connection acquisition failure. Unsupported generated builder capabilities
 * are exposed as `WsUnsupportedBuilderFeatureError` in `cause`.
 */
export class WsConnectError extends Data.TaggedError("WsConnectError")<{
  readonly cause: unknown
  readonly context?: unknown
}> {}

class WsDisconnectError extends Data.TaggedError("WsDisconnectError")<{
  readonly cause: unknown
}> {}

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

type PendingConnect<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
> = {
  readonly connection: ManagedWsConnection<
    Module,
    ErrorContext,
    RelationContext
  >
  readonly identity: Identity
  readonly token: string
}

type AcquisitionState<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
> = {
  readonly built:
    | ManagedWsConnection<Module, ErrorContext, RelationContext>
    | undefined
  readonly connected:
    | PendingConnect<Module, ErrorContext, RelationContext>
    | undefined
  readonly acquired:
    | ManagedWsConnection<Module, ErrorContext, RelationContext>
    | undefined
  readonly failed: WsConnectError | undefined
  readonly released: boolean
}

const sessionTagIds = new WeakMap<object, Map<string, string>>()
let nextSessionTagId = 0

const sessionTagIdForModule = (module: AnyModuleSpec, name: string): string => {
  const moduleKey = module as object
  const moduleTags = sessionTagIds.get(moduleKey) ?? new Map<string, string>()
  if (!sessionTagIds.has(moduleKey)) {
    sessionTagIds.set(moduleKey, moduleTags)
  }

  const existing = moduleTags.get(name)
  if (existing !== undefined) {
    return existing
  }

  nextSessionTagId = nextSessionTagId + 1
  const id = prefixId(`Client/WsSession/${nextSessionTagId}`)
  moduleTags.set(name, id)
  return id
}

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

const disconnectMessage = (context: unknown, error?: Error): string => {
  const message =
    error != null && error.message.length > 0
      ? error.message
      : (messageFromUnknown(context) ?? String(context))

  return message.length > 0 ? message : "WebSocket connection disconnected"
}

const disconnectManagedConnection = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  connection: ManagedWsConnection<Module, ErrorContext, RelationContext>,
) =>
  Effect.try({
    try: () => {
      connection.disconnect()
    },
    catch: (cause) => new WsDisconnectError({ cause }),
  }).pipe(Effect.ignore)

const runCallbackEffect = (effect: Effect.Effect<void>) => {
  Effect.runSync(effect)
}

const connectError = (cause: unknown, context?: unknown) =>
  new WsConnectError({
    cause,
    ...(context === undefined ? {} : { context }),
  })

const invalidateDisconnected = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  connection: ManagedWsConnection<Module, ErrorContext, RelationContext>,
  error: WsConnectError,
) => {
  connectionStateFor(connection).invalidateFromTransport(
    disconnectMessage(error.context, error.cause as Error | undefined),
    true,
  )
}

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

export const makeScopedFromModulePlan = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: WsBuilderConfig<Module, ErrorContext, RelationContext>
}) =>
  Effect.gen(function* () {
    const state = yield* Ref.make<
      AcquisitionState<Module, ErrorContext, RelationContext>
    >({
      built: undefined,
      connected: undefined,
      acquired: undefined,
      failed: undefined,
      released: false,
    })
    const latch = yield* Deferred.make<
      WsSession<Module, ErrorContext, RelationContext>,
      WsConnectError
    >()
    const disconnectedConnections = new WeakSet<object>()

    const disconnectOnce = (
      connection: ManagedWsConnection<Module, ErrorContext, RelationContext>,
    ) =>
      Effect.suspend(() => {
        if (disconnectedConnections.has(connection as object)) {
          return Effect.void
        }

        disconnectedConnections.add(connection as object)
        return disconnectManagedConnection(connection)
      })

    const succeedAcquire = (
      connection: ManagedWsConnection<Module, ErrorContext, RelationContext>,
      identity: Identity,
      token: string,
    ) => {
      const session = makeWsClient({
        plan: options.plan,
        connection,
      })

      return Deferred.succeed(latch, {
        ...session,
        connection,
        identity,
        token,
      }).pipe(Effect.asVoid)
    }

    const failLatch = (error: WsConnectError) =>
      Deferred.fail(latch, error).pipe(Effect.asVoid)

    const failForMismatch = (
      message: string,
      primary: ManagedWsConnection<Module, ErrorContext, RelationContext>,
      secondary: ManagedWsConnection<Module, ErrorContext, RelationContext>,
    ): readonly [
      Effect.Effect<void>,
      AcquisitionState<Module, ErrorContext, RelationContext>,
    ] => {
      const error = connectError(new Error(message))
      invalidateDisconnected(primary, error)
      return [
        disconnectOnce(primary).pipe(
          Effect.andThen(disconnectOnce(secondary)),
          Effect.andThen(failLatch(error)),
        ),
        {
          built: primary,
          connected: undefined,
          acquired: undefined,
          failed: error,
          released: false,
        },
      ]
    }

    const release = Ref.modify(state, (current) => {
      if (current.released) {
        return [Effect.void, current] as const
      }

      const connection =
        current.failed === undefined
          ? (current.acquired ?? current.built ?? current.connected?.connection)
          : undefined

      return [
        connection != null ? disconnectOnce(connection) : Effect.void,
        {
          ...current,
          released: true,
        },
      ] as const
    }).pipe(Effect.flatten)

    const rememberBuiltConnection = (
      connection: ManagedWsConnection<Module, ErrorContext, RelationContext>,
    ) =>
      Ref.modify(state, (current) => {
        if (current.acquired != null) {
          return [Effect.void, current] as const
        }

        if (current.released) {
          return [
            disconnectOnce(connection),
            {
              ...current,
              built: connection,
            },
          ] as const
        }

        if (current.failed != null) {
          return [
            disconnectOnce(connection),
            {
              ...current,
              built: connection,
            },
          ] as const
        }

        if (current.connected != null) {
          if (current.connected.connection === connection) {
            return [
              succeedAcquire(
                connection,
                current.connected.identity,
                current.connected.token,
              ),
              {
                ...current,
                built: connection,
                connected: undefined,
                acquired: connection,
              },
            ] as const
          }

          return failForMismatch(
            "WebSocket builder returned a different connection than onConnect emitted",
            current.connected.connection,
            connection,
          )
        }

        return [
          Effect.void,
          {
            ...current,
            built: connection,
          },
        ] as const
      }).pipe(Effect.flatten)

    const failAcquire = (
      error: WsConnectError,
      connection?: ManagedWsConnection<Module, ErrorContext, RelationContext>,
    ) =>
      Ref.modify(state, (current) => {
        if (current.released) {
          return [
            connection != null ? disconnectOnce(connection) : Effect.void,
            {
              ...current,
              built: current.built ?? connection,
            },
          ] as const
        }

        if (current.failed != null) {
          return [
            connection != null ? disconnectOnce(connection) : Effect.void,
            {
              ...current,
              built: current.built ?? connection,
            },
          ] as const
        }

        const knownConnection =
          connection ??
          current.acquired ??
          current.built ??
          current.connected?.connection

        if (current.acquired != null) {
          invalidateDisconnected(current.acquired, error)
          return [
            Effect.void,
            {
              ...current,
              failed: error,
            },
          ] as const
        }

        if (knownConnection != null) {
          invalidateDisconnected(knownConnection, error)
        }

        return [
          (knownConnection != null
            ? disconnectOnce(knownConnection)
            : Effect.void
          ).pipe(Effect.andThen(failLatch(error))),
          {
            built: knownConnection,
            connected: undefined,
            acquired: undefined,
            failed: error,
            released: false,
          },
        ] as const
      }).pipe(Effect.flatten)

    const completeSuccess = (
      connection: ManagedWsConnection<Module, ErrorContext, RelationContext>,
      identity: Identity,
      token: string,
    ) =>
      Ref.modify(state, (current) => {
        if (current.acquired != null) {
          return [Effect.void, current] as const
        }

        if (current.released) {
          return [
            disconnectOnce(connection),
            {
              ...current,
              connected: current.connected ?? {
                connection,
                identity,
                token,
              },
            },
          ] as const
        }

        if (current.failed != null) {
          return [
            disconnectOnce(connection),
            {
              ...current,
              connected: current.connected ?? {
                connection,
                identity,
                token,
              },
            },
          ] as const
        }

        if (current.connected != null) {
          return [
            current.connected.connection === connection
              ? Effect.void
              : disconnectOnce(connection),
            current,
          ] as const
        }

        if (current.built != null) {
          if (current.built === connection) {
            return [
              succeedAcquire(connection, identity, token),
              {
                ...current,
                connected: undefined,
                acquired: connection,
              },
            ] as const
          }

          return failForMismatch(
            "WebSocket onConnect emitted a different connection than build returned",
            current.built,
            connection,
          )
        }

        return [
          Effect.void,
          {
            ...current,
            connected: {
              connection,
              identity,
              token,
            },
          },
        ] as const
      }).pipe(Effect.flatten)

    const acquire = Effect.callback<
      WsSession<Module, ErrorContext, RelationContext>,
      WsConnectError
    >((resume) => {
      Result.match(
        Result.try(() => {
          const builder = configureGeneratedWsBuilder(options.config)
            .onConnect((connection, identity, token) => {
              runCallbackEffect(completeSuccess(connection, identity, token))
            })
            .onDisconnect((context, error) => {
              connectError(error ?? context, context).pipe(
                failAcquire,
                runCallbackEffect,
              )
            })
            .onConnectError((context, error) => {
              connectError(error, context).pipe(failAcquire, runCallbackEffect)
            })

          const connection = builder.build()
          runCallbackEffect(rememberBuiltConnection(connection))
        }),
        {
          onFailure: (cause) =>
            connectError(cause).pipe(failAcquire, runCallbackEffect),
          onSuccess: () => undefined,
        },
      )

      resume(Deferred.await(latch).pipe(Effect.onInterrupt(() => release)))
      return release
    })

    return yield* acquire.pipe(
      Effect.onInterrupt(() => release),
      Effect.tap(() => Effect.addFinalizer(() => release)),
    )
  })

export const makeScoped = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly module: Module
  readonly config: WsBuilderConfig<Module, ErrorContext, RelationContext>
}) =>
  makeScopedFromModulePlan({
    plan: makeModulePlan(options.module),
    config: options.config,
  })

export const makeScopedGenerated = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly module: Module
  readonly config: WsGeneratedConfig<Module, ErrorContext, RelationContext>
}) =>
  makeScoped({
    module: options.module,
    config: generated(options.config),
  })

export const layerFromModulePlan = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: WsBuilderConfig<Module, ErrorContext, RelationContext>
  readonly name?: string
}) =>
  Layer.effect(
    sessionTagFromModulePlan<Module, ErrorContext, RelationContext>(
      options.plan,
      options.name,
    ),
    makeScopedFromModulePlan(options),
  )

export const layer = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly module: Module
  readonly config: WsBuilderConfig<Module, ErrorContext, RelationContext>
  readonly name?: string
}) =>
  layerFromModulePlan({
    plan: makeModulePlan(options.module),
    config: options.config,
    ...(options.name === undefined ? {} : { name: options.name }),
  })

export const layerGenerated = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly module: Module
  readonly config: WsGeneratedConfig<Module, ErrorContext, RelationContext>
  readonly name?: string
}) =>
  layer({
    module: options.module,
    config: generated(options.config),
    ...(options.name === undefined ? {} : { name: options.name }),
  })
