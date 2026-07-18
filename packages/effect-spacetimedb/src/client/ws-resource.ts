import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
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
  GeneratedArtifactShapeError,
  generatedArtifactShapeError,
} from "./generated-artifact-shape.ts"
import {
  configureGeneratedWsBuilder,
  type GeneratedConnectionClassLike,
  type GeneratedErrorContextOf,
  type GeneratedWsBuilderConfig,
  type GeneratedWsClientConfig,
  generatedConfig as generated,
  type ManagedWsConnection,
  type MismatchedGeneratedModuleDiagnostic,
} from "./generated-ws-adapter.ts"
import { canonicalValueKey } from "./table-ref.ts"
import { makeFromModulePlan as makeWsClient } from "./ws-client.ts"
import {
  type AcquisitionState,
  WsConnectError,
  WsConnectTimeoutError,
  WsDisconnectError,
} from "./ws-resource-lifecycle.ts"

export type {
  GeneratedConnectionOf,
  GeneratedConnectionClassLike,
  GeneratedErrorContextOf,
  GeneratedWsErrorContext,
  GeneratedWsBuilderLike,
  GeneratedWsClientConfig,
  GeneratedWsConnectionFactory,
  ManagedWsConnection,
  MismatchedGeneratedModuleDiagnostic,
  WsCompression,
} from "./generated-ws-adapter.ts"
export {
  generatedConnection,
  WsUnsupportedBuilderFeatureError,
} from "./generated-ws-adapter.ts"
export { GeneratedArtifactShapeError } from "./generated-artifact-shape.ts"
export {
  WsConnectError,
  WsConnectTimeoutError,
} from "./ws-resource-lifecycle.ts"

type Simplify<Value> = { readonly [Key in keyof Value]: Value[Key] } & {}

export type WsBuilderConfig<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext = unknown,
> = GeneratedWsBuilderConfig<Module, ErrorContext, RelationContext>

export type WsGeneratedConfig<
  Module extends AnyModuleSpec,
  ConnectionClass extends GeneratedConnectionClassLike,
  RelationContext = unknown,
> = GeneratedWsClientConfig<Module, ConnectionClass, RelationContext>

export { generated }

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

const GeneratedArtifactValidation = Symbol(
  "effect-spacetimedb/GeneratedArtifactValidation",
)

type InternalWsBuilderConfig<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  ValidationError,
> = WsBuilderConfig<Module, ErrorContext, RelationContext> & {
  readonly [GeneratedArtifactValidation]?: [ValidationError] extends [never]
    ? never
    : true
}

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

const runCallbackEffectSafely = (
  effect: Effect.Effect<void>,
  onDefect: (cause: unknown) => void,
): void => {
  try {
    Effect.runSync(effect)
  } catch (cause) {
    onDefect(cause)
  }
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
  ValidationError = never,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: InternalWsBuilderConfig<
    Module,
    ErrorContext,
    RelationContext,
    ValidationError
  >
}) =>
  Effect.gen(function* () {
    type AcquireError = WsConnectError | ValidationError
    const state = yield* Ref.make<
      AcquisitionState<Module, ErrorContext, RelationContext, ValidationError>
    >({
      built: undefined,
      connected: undefined,
      acquired: undefined,
      failed: undefined,
      released: false,
    })
    const latch = yield* Deferred.make<
      WsSession<Module, ErrorContext, RelationContext>,
      AcquireError
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

    const failLatch = (error: AcquireError) =>
      Deferred.fail(latch, error).pipe(Effect.asVoid)

    const failForMismatch = (
      message: string,
      primary: ManagedWsConnection<Module, ErrorContext, RelationContext>,
      secondary: ManagedWsConnection<Module, ErrorContext, RelationContext>,
    ): readonly [
      Effect.Effect<void>,
      AcquisitionState<Module, ErrorContext, RelationContext, ValidationError>,
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
      error: AcquireError,
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
          if (WsConnectError.is(error)) {
            invalidateDisconnected(current.acquired, error)
          }
          return [
            Effect.void,
            {
              ...current,
              failed: error,
            },
          ] as const
        }

        if (knownConnection != null) {
          if (WsConnectError.is(error)) {
            invalidateDisconnected(knownConnection, error)
          }
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

    const runCallbackEffect = (
      effect: Effect.Effect<void>,
      connection?: ManagedWsConnection<Module, ErrorContext, RelationContext>,
    ): void => {
      runCallbackEffectSafely(effect, (cause) => {
        const error = connectError(cause)
        runCallbackEffectSafely(failAcquire(error, connection), () => {
          Deferred.doneUnsafe(latch, Effect.fail(error))
          if (connection != null) {
            try {
              connection.disconnect()
            } catch {
              // The latch is already settled; native callback boundaries must
              // never receive a second defect from cleanup.
            }
          }
        })
      })
    }

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

    let builtConnection:
      | ManagedWsConnection<Module, ErrorContext, RelationContext>
      | undefined
    const acquire: Effect.Effect<
      WsSession<Module, ErrorContext, RelationContext>,
      AcquireError
    > = Effect.suspend(() => {
      Result.match(
        Result.try(() => {
          const builder = configureGeneratedWsBuilder(options.config)
            .onConnect((connection, identity, token) => {
              runCallbackEffect(
                completeSuccess(connection, identity, token),
                connection,
              )
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
          builtConnection = connection
          if (options.config[GeneratedArtifactValidation] === true) {
            const shapeError = generatedArtifactShapeError(
              options.plan,
              connection,
            )
            if (shapeError !== undefined) {
              runCallbackEffect(
                failAcquire(shapeError as ValidationError, connection),
              )
              return
            }
          }
          runCallbackEffect(rememberBuiltConnection(connection))
        }),
        {
          onFailure: (cause) =>
            connectError(cause).pipe(
              (error) => failAcquire(error, builtConnection),
              runCallbackEffect,
            ),
          onSuccess: () => undefined,
        },
      )

      return Deferred.await(latch)
    })

    const connectTimeoutMillis = options.config.connectTimeoutMillis
    const timedAcquire =
      connectTimeoutMillis === undefined
        ? acquire
        : acquire.pipe(
            Effect.timeoutOrElse({
              duration: Duration.millis(connectTimeoutMillis),
              orElse: () => {
                const error = connectError(
                  new WsConnectTimeoutError({
                    timeoutMillis: connectTimeoutMillis,
                  }),
                )
                return failAcquire(error, builtConnection).pipe(
                  Effect.andThen(Effect.fail(error)),
                )
              },
            }),
          )

    return yield* timedAcquire.pipe(
      Effect.onInterrupt(() => release),
      Effect.tap(() => Effect.addFinalizer(() => release)),
    )
  })

export const makeScoped = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  ValidationError = never,
>(options: {
  readonly module: Module
  readonly config: InternalWsBuilderConfig<
    Module,
    ErrorContext,
    RelationContext,
    ValidationError
  >
}) =>
  makeScopedFromModulePlan<
    Module,
    ErrorContext,
    RelationContext,
    ValidationError
  >({
    plan: makeModulePlan(options.module),
    config: options.config,
  })

export const makeScopedGenerated = <
  Module extends AnyModuleSpec,
  ConnectionClass extends GeneratedConnectionClassLike,
  RelationContext,
>(options: {
  readonly module: Module
  readonly config: WsGeneratedConfig<Module, ConnectionClass, RelationContext> &
    MismatchedGeneratedModuleDiagnostic<Module, ConnectionClass>
}) => {
  const config: InternalWsBuilderConfig<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    GeneratedArtifactShapeError
  > = {
    ...generated(options.config),
    [GeneratedArtifactValidation]: true,
  }

  return makeScoped<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    GeneratedArtifactShapeError
  >({
    module: options.module,
    config,
  })
}

export const layerFromModulePlan = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  ValidationError = never,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: InternalWsBuilderConfig<
    Module,
    ErrorContext,
    RelationContext,
    ValidationError
  >
  readonly name?: string | undefined
}) =>
  Layer.effect(
    sessionTagFromModulePlan<Module, ErrorContext, RelationContext>(
      options.plan,
      options.name,
    ),
    makeScopedFromModulePlan<
      Module,
      ErrorContext,
      RelationContext,
      ValidationError
    >(options),
  )

export const layer = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  ValidationError = never,
>(options: {
  readonly module: Module
  readonly config: InternalWsBuilderConfig<
    Module,
    ErrorContext,
    RelationContext,
    ValidationError
  >
  readonly name?: string | undefined
}) =>
  layerFromModulePlan<Module, ErrorContext, RelationContext, ValidationError>({
    plan: makeModulePlan(options.module),
    config: options.config,
    name: options.name,
  })

export const layerGenerated = <
  Module extends AnyModuleSpec,
  ConnectionClass extends GeneratedConnectionClassLike,
  RelationContext,
>(options: {
  readonly module: Module
  readonly config: WsGeneratedConfig<Module, ConnectionClass, RelationContext> &
    MismatchedGeneratedModuleDiagnostic<Module, ConnectionClass>
  readonly name?: string | undefined
}) => {
  const config: InternalWsBuilderConfig<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    GeneratedArtifactShapeError
  > = {
    ...generated(options.config),
    [GeneratedArtifactValidation]: true,
  }

  return layer<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    GeneratedArtifactShapeError
  >({
    module: options.module,
    config,
    name: options.name,
  })
}
