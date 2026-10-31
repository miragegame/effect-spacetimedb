import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import type { Identity } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ModulePlan } from "../module-plan.ts"
import { makeModulePlan } from "../module-plan.ts"
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
  type WsAttemptCredentials,
} from "./generated-ws-adapter.ts"
import { attemptCredentials, liveToken } from "./ws-attempt-credentials.ts"
import {
  awaitReplayOnAutomaticReconnect,
  beginReportedRecovery,
  watchReconnectAttempts,
} from "./ws-automatic-reconnect.ts"
import { makeFromModulePlan as makeWsClient } from "./ws-client.ts"
import {
  type AcquisitionState,
  assertAutomaticReconnectBounded,
  assertConnectTimeoutBounded,
  connectError,
  connectErrorOfReport,
  disconnectMessage,
  invalidateDisconnected,
  knownConnection,
  WsConnectError,
  WsConnectTimeoutError,
  WsDisconnectError,
} from "./ws-resource-lifecycle.ts"
import type { WsSession } from "./ws-session-tag.ts"

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
  WsAutomaticReconnect,
  WsCompression,
  WsToken,
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

export const GeneratedArtifactValidation = Symbol(
  "effect-spacetimedb/GeneratedArtifactValidation",
)

export type InternalWsBuilderConfig<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  ValidationError,
> = WsBuilderConfig<Module, ErrorContext, RelationContext> & {
  readonly [GeneratedArtifactValidation]?: [ValidationError] extends [never]
    ? never
    : true
}

const releasedConnectionMessage = "WebSocket connection released"

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

// Every WebSocket entry point (scoped, layered, supervised) builds its
// acquisition here, so validating before the Effect is returned rejects an
// unbounded connect when the client is constructed rather than at first use.
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
  /**
   * The acquisition's owner enables automatic-reconnect recovery itself, once
   * the session is live (a session supervisor, after connecting, subscribing
   * and setup). Otherwise the acquisition enables it when it completes.
   */
  readonly recoveryEnabledByOwner?: boolean | undefined
}) => {
  assertConnectTimeoutBounded(options.config.connectTimeoutMillis)
  assertAutomaticReconnectBounded(options.config.automaticReconnect)
  return Effect.gen(function* () {
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
        get token() {
          return liveToken(connection, token)
        },
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

    // The SDK never rejects outstanding calls when its socket closes, and a
    // client-side disconnect may never fire `onDisconnect` at all (a silent
    // partition), so release invalidates the connection itself: calls still
    // in flight, and any made later through a stale handle, fail with
    // `ConnectionLostError` instead of waiting forever on a closed socket.
    const invalidateAndDisconnect = (
      connection: ManagedWsConnection<Module, ErrorContext, RelationContext>,
    ) =>
      Effect.suspend(() => {
        connectionStateFor(connection).invalidateFromTransport(
          releasedConnectionMessage,
        )
        return disconnectOnce(connection)
      })

    const release = Ref.modify(state, (current) => {
      if (current.released) {
        return [Effect.void, current] as const
      }

      const connection =
        current.failed === undefined
          ? (current.acquired ?? current.built ?? current.connected?.connection)
          : undefined

      return [
        connection != null ? invalidateAndDisconnect(connection) : Effect.void,
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

    // With automatic reconnect, a drop the SDK will retry (it reports the
    // next attempt) only puts a live session's connection into recovery.
    // Every other report (no retry scheduled, or a session not live yet) ends
    // it, so the SDK's own retries never outlive the session's owner.
    const automaticReconnect = options.config.automaticReconnect !== undefined
    const reportEnd = (
      context: ErrorContext,
      error: Error | undefined,
      reconnectAttempt: number | undefined,
      reconnectDelayMillis: number | undefined,
    ) =>
      Ref.get(state).pipe(
        Effect.flatMap((current) => {
          const connection = knownConnection(current)
          const recovering =
            automaticReconnect &&
            reconnectAttempt !== undefined &&
            connection != null &&
            beginReportedRecovery(
              connection,
              error,
              reconnectAttempt,
              reconnectDelayMillis,
            )
          if (recovering) {
            return Effect.void
          }
          const ended = failAcquire(connectErrorOfReport(error, context))
          // The SDK scheduled a retry for a session that is not live: stop it,
          // since nobody would ever own the connection it reopens.
          return reconnectAttempt !== undefined && connection != null
            ? ended.pipe(Effect.andThen(disconnectOnce(connection)))
            : ended
        }),
      )

    // The SDK's token refreshes run here. The reconnect attempt's bound (the
    // watcher below) limits them, and an overrun while one is still running
    // is the token's, not the transport's. A refresh that does not succeed
    // ends the connection so the owner's retry policy decides; a defect stays
    // a defect. A refresh still running when the connection ends is dropped.
    let refreshesInFlight = 0
    const endOnRefreshExit = (exit: Exit.Exit<string, WsConnectError>) =>
      Ref.get(state).pipe(
        Effect.flatMap((current) => {
          const connection = knownConnection(current)
          if (Exit.isSuccess(exit) || connection == null) {
            return Effect.void
          }
          const connectionState = connectionStateFor(connection)
          const failure = Cause.findErrorOption(exit.cause)
          if (Option.isSome(failure)) {
            connectionState.invalidateForFailedCredentials(
              `Token refresh failed: ${disconnectMessage(failure.value)}`,
              failure.value.cause,
            )
          } else {
            const defect = Cause.squash(exit.cause)
            connectionState.invalidateForCredentialsDefect(
              `Token refresh died: ${disconnectMessage(defect)}`,
              defect,
            )
          }
          return disconnectOnce(connection)
        }),
      )
    const connectionEnded = Ref.get(state).pipe(
      Effect.flatMap((current) => {
        const connection = knownConnection(current)
        return connection == null
          ? Effect.never
          : connectionStateFor(connection)
              .awaitInvalidation()
              .pipe(
                Effect.flatMap((invalidation) =>
                  Effect.fail(connectError(new Error(invalidation.message))),
                ),
              )
      }),
    )
    const superviseRefresh = (refresh: Effect.Effect<string, WsConnectError>) =>
      Effect.suspend(() => {
        refreshesInFlight += 1
        return refresh
      }).pipe(
        Effect.raceFirst(connectionEnded),
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            refreshesInFlight -= 1
            return endOnRefreshExit(exit)
          }),
        ),
      )

    let builtConnection:
      | ManagedWsConnection<Module, ErrorContext, RelationContext>
      | undefined
    const acquireWith = (
      credentials: WsAttemptCredentials,
    ): Effect.Effect<
      WsSession<Module, ErrorContext, RelationContext>,
      AcquireError
    > =>
      Effect.suspend(() => {
        Result.match(
          Result.try(() => {
            let builder = configureGeneratedWsBuilder(
              options.config,
              credentials,
            )
              .onConnect((connection, identity, token) => {
                runCallbackEffect(
                  completeSuccess(connection, identity, token),
                  connection,
                )
              })
              // A socket error raised after the handshake never reaches
              // `onConnectError`: the SDK stashes it, closes the socket, and
              // delivers it here as the second argument. Keep it as the cause
              // so connection loss stays distinguishable from a close with no
              // reported error, which arrives with `error` undefined.
              .onDisconnect((context, error, reconnectAttempt, delayMs) => {
                runCallbackEffect(
                  reportEnd(context, error, reconnectAttempt, delayMs),
                )
              })
              // With automatic reconnect this also reports each failed
              // reconnect attempt; one with a successor scheduled keeps the
              // connection recovering.
              .onConnectError((context, error, reconnectAttempt, delayMs) => {
                runCallbackEffect(
                  reportEnd(context, error, reconnectAttempt, delayMs),
                )
              })
            if (automaticReconnect) {
              builder = awaitReplayOnAutomaticReconnect(builder)
            }

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
    // A token Effect is evaluated for this attempt inside the connect bound;
    // with automatic reconnect it is also the SDK's refresh, run with this
    // acquisition's services.
    const acquisitionServices = yield* Effect.context<never>()
    const acquire = attemptCredentials(options.config.token, {
      automaticReconnect,
      services: acquisitionServices,
      superviseRefresh,
    }).pipe(Effect.flatMap(acquireWith))
    const timedAcquire = acquire.pipe(
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

    const endRecoveringConnection =
      (
        connection: ManagedWsConnection<Module, ErrorContext, RelationContext>,
      ) =>
      (message: string) =>
        Effect.suspend(() => {
          const connectionState = connectionStateFor(connection)
          if (refreshesInFlight > 0) {
            connectionState.invalidateForFailedCredentials(
              `Token refresh did not complete: ${message}`,
              new WsConnectTimeoutError({
                timeoutMillis: connectTimeoutMillis,
              }),
            )
          } else {
            connectionState.invalidateFromTransport(message)
          }
          return disconnectOnce(connection)
        })

    return yield* timedAcquire.pipe(
      Effect.onInterrupt(() => release),
      Effect.tap(() => Effect.addFinalizer(() => release)),
      Effect.tap((session) =>
        Effect.suspend(() => {
          if (!automaticReconnect) {
            return Effect.void
          }
          const connectionState = connectionStateFor(session.connection)
          if (options.recoveryEnabledByOwner !== true) {
            connectionState.enableRecovery()
          }
          return watchReconnectAttempts(
            connectionState,
            connectTimeoutMillis,
            endRecoveringConnection(session.connection),
          ).pipe(Effect.forkScoped, Effect.asVoid)
        }),
      ),
    )
  })
}

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
