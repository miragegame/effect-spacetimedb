import { withDeadline } from "./call-duration.ts"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
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
import {
  attemptCredentials,
  credentialsInvalidation,
  liveToken,
  type TokenUnavailable,
} from "./ws-attempt-credentials.ts"
import {
  awaitReplayOnAutomaticReconnect,
  beginReportedRecovery,
  watchReconnectAttempts,
} from "./ws-automatic-reconnect.ts"
import { makeFromModulePlan as wsMake } from "./ws-client.ts"
import {
  type AcquisitionState,
  wsTimeBounds,
  connectError,
  connectErrorOfReport,
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
  wsGeneratedConnection,
  WsUnsupportedBuilderFeatureError,
} from "./generated-ws-adapter.ts"
export { GeneratedArtifactShapeError } from "./generated-artifact-shape.ts"
export {
  connectDurationMaxDefault,
  WsConnectError,
  WsConnectTimeoutError,
  WsProtocolError,
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

// Validating before the Effect is returned rejects an unbounded connect when the
// client is constructed rather than at first use.
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
  readonly timeBounds?: ReturnType<typeof wsTimeBounds>
  /**
   * The acquisition's owner enables automatic-reconnect recovery itself, once
   * the session is live (a session supervisor, after connecting, subscribing
   * and setup). Otherwise the acquisition enables it when it completes.
   */
  readonly recoveryEnabledByOwner?: boolean | undefined
  /** See `attemptCredentials`: only an owner that retains a session needs it. */
  readonly onTokenUnavailable?: TokenUnavailable | undefined
}) => {
  const { connectMillis, automaticReconnect: nativeReconnect } =
    options.timeBounds ?? wsTimeBounds(options.config)
  return Effect.gen(function* () {
    type AcquireError = WsConnectError | ValidationError
    type Connection = ManagedWsConnection<Module, ErrorContext, RelationContext>
    type Acquisition = AcquisitionState<Module, ErrorContext, RelationContext>
    /** What leaving a stage has to do, and the stage it leaves for. */
    type Step = readonly [Effect.Effect<void>, Acquisition]
    const state = yield* Ref.make<Acquisition>({ stage: "idle" })
    const latch = yield* Deferred.make<
      WsSession<Module, ErrorContext, RelationContext>,
      AcquireError
    >()
    const disconnectedConnections = new WeakSet<object>()

    const disconnectOnce = (connection: Connection) =>
      Effect.suspend(() => {
        if (disconnectedConnections.has(connection as object)) {
          return Effect.void
        }

        disconnectedConnections.add(connection as object)
        return disconnectManagedConnection(connection)
      })

    const succeedAcquire = (
      connection: Connection,
      identity: Identity,
      token: string,
    ) => {
      const session = wsMake({
        plan: options.plan,
        connection,
        callDurationMax: options.config.callDurationMax,
        endConnection: (message) =>
          invalidateAndDisconnect(connection, message),
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
      primary: Connection,
      secondary: Connection,
    ): Step => {
      const error = connectError(new Error(message))
      invalidateDisconnected(primary, error)
      return [
        disconnectOnce(primary).pipe(
          Effect.andThen(disconnectOnce(secondary)),
          Effect.andThen(failLatch(error)),
        ),
        { stage: "failed", connection: primary },
      ]
    }

    // Without automatic reconnect, the SDK leaves outstanding calls unsettled
    // on ordinary socket loss. Its protocol-error handler settles them itself.
    // A client-side disconnect may never fire `onDisconnect` at all (a silent
    // partition), so release invalidates the connection itself: calls still
    // in flight, and any made later through a stale handle, fail with
    // `ConnectionLostError` instead of waiting forever on a closed socket.
    const invalidateAndDisconnect = (connection: Connection, message: string) =>
      Effect.suspend(() => {
        connectionStateFor(connection).invalidateFromTransport(message)
        return disconnectOnce(connection)
      })

    const release = Ref.modify(state, (current): Step => {
      if (current.stage === "released") {
        return [Effect.void, current]
      }
      const connection = knownConnection(current)
      return [
        connection != null
          ? invalidateAndDisconnect(connection, releasedConnectionMessage)
          : Effect.void,
        { stage: "released", connection },
      ]
    }).pipe(Effect.flatten)

    const rememberBuiltConnection = (connection: Connection) =>
      Ref.modify(state, (current): Step => {
        switch (current.stage) {
          case "acquired":
            return [Effect.void, current]
          case "released":
          case "failed":
            return [disconnectOnce(connection), { ...current, connection }]
          case "connectedEarly":
            return current.connection === connection
              ? [
                  succeedAcquire(connection, current.identity, current.token),
                  { stage: "acquired", connection },
                ]
              : failForMismatch(
                  "WebSocket builder returned a different connection than onConnect emitted",
                  current.connection,
                  connection,
                )
          case "idle":
          case "built":
            return [Effect.void, { stage: "built", connection }]
        }
      }).pipe(Effect.flatten)

    const failAcquire = (error: AcquireError, connection?: Connection) =>
      Ref.modify(state, (current): Step => {
        switch (current.stage) {
          case "released":
          case "failed":
            return [
              connection != null ? disconnectOnce(connection) : Effect.void,
              { ...current, connection: current.connection ?? connection },
            ]
          // The latch is settled, but its waiter may never own this connection:
          // if the bound ran out as `onConnect` landed, no finalizer exists, so
          // this is the last place that can close it.
          case "acquired":
            if (WsConnectError.is(error)) {
              invalidateDisconnected(current.connection, error)
            }
            return [
              disconnectOnce(current.connection),
              { stage: "failed", connection: current.connection },
            ]
          case "idle":
          case "built":
          case "connectedEarly": {
            const known = connection ?? knownConnection(current)
            if (known != null && WsConnectError.is(error)) {
              invalidateDisconnected(known, error)
            }
            return [
              (known != null ? disconnectOnce(known) : Effect.void).pipe(
                Effect.andThen(failLatch(error)),
              ),
              { stage: "failed", connection: known },
            ]
          }
        }
      }).pipe(Effect.flatten)

    const runCallbackEffect = (
      effect: Effect.Effect<void>,
      connection?: Connection,
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
      connection: Connection,
      identity: Identity,
      token: string,
    ) =>
      Ref.modify(state, (current): Step => {
        switch (current.stage) {
          case "acquired":
            return [Effect.void, current]
          case "released":
          case "failed":
            return [
              disconnectOnce(connection),
              { ...current, connection: current.connection ?? connection },
            ]
          case "connectedEarly":
            return [
              current.connection === connection
                ? Effect.void
                : disconnectOnce(connection),
              current,
            ]
          case "built":
            return current.connection === connection
              ? [
                  succeedAcquire(connection, identity, token),
                  { stage: "acquired", connection },
                ]
              : failForMismatch(
                  "WebSocket onConnect emitted a different connection than build returned",
                  current.connection,
                  connection,
                )
          case "idle":
            return [
              Effect.void,
              { stage: "connectedEarly", connection, identity, token },
            ]
        }
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
          connectionStateFor(connection).invalidateForCredentials(
            credentialsInvalidation(exit.cause),
          )
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

    const acquireWith = (
      credentials: WsAttemptCredentials,
    ): Effect.Effect<
      WsSession<Module, ErrorContext, RelationContext>,
      AcquireError
    > =>
      Effect.suspend(() => {
        // Only for a throw between build and the state hearing of the connection.
        let built: Connection | undefined
        Result.match(
          Result.try(() => {
            let builder = configureGeneratedWsBuilder(
              options.config,
              credentials,
              nativeReconnect,
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
              builder = awaitReplayOnAutomaticReconnect(
                builder,
                (connection) => {
                  runCallbackEffect(
                    Effect.suspend(() => {
                      connectionStateFor(connection).beginReplay()
                      return Effect.void
                    }),
                    connection,
                  )
                },
              )
            }

            const connection = builder.build()
            built = connection
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
                (error) => failAcquire(error, built),
                runCallbackEffect,
              ),
            onSuccess: () => undefined,
          },
        )

        return Deferred.await(latch)
      })

    // A token Effect is evaluated for this attempt inside the connect bound;
    // with automatic reconnect it is also the SDK's refresh, run with this
    // acquisition's services.
    const acquisitionServices = yield* Effect.context<never>()
    const acquire = attemptCredentials(options.config.token, {
      automaticReconnect,
      services: acquisitionServices,
      superviseRefresh,
      onUnavailable: options.onTokenUnavailable ?? (() => Effect.void),
    }).pipe(Effect.flatMap(acquireWith))
    const timedAcquire = acquire.pipe(
      withDeadline({
        duration: Duration.millis(connectMillis),
        orElse: () => {
          const error = connectError(
            new WsConnectTimeoutError({
              timeoutMillis: connectMillis,
            }),
          )
          return failAcquire(error).pipe(Effect.andThen(Effect.fail(error)))
        },
      }),
    )

    const endRecoveringConnection =
      (connection: Connection) => (message: string) =>
        Effect.suspend(() => {
          const connectionState = connectionStateFor(connection)
          if (refreshesInFlight > 0) {
            connectionState.invalidateForCredentials({
              kind: "credentialsFailed",
              message: `Token refresh did not complete: ${message}`,
              cause: new WsConnectTimeoutError({
                timeoutMillis: connectMillis,
              }),
            })
          } else {
            connectionState.invalidateFromTransport(message)
          }
          return disconnectOnce(connection)
        })

    // Masked so that nothing can interrupt between an acquired connection and the
    // finalizer that owns it. The interrupt handler stays for a caller whose scope
    // outlives an abandoned acquisition, which should not hold a socket until then.
    return yield* Effect.uninterruptibleMask((restore) =>
      restore(timedAcquire).pipe(
        Effect.onInterrupt(() => release),
        Effect.tap(() => Effect.addFinalizer(() => release)),
      ),
    ).pipe(
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
            connectMillis,
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

export const makeScopedGeneratedFromModulePlan = <
  Module extends AnyModuleSpec,
  ConnectionClass extends GeneratedConnectionClassLike,
  RelationContext,
>(options: {
  readonly plan: ModulePlan<Module>
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

  return makeScopedFromModulePlan<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    GeneratedArtifactShapeError
  >({
    plan: options.plan,
    config,
  })
}

export const makeScopedGenerated = <
  Module extends AnyModuleSpec,
  ConnectionClass extends GeneratedConnectionClassLike,
  RelationContext,
>(options: {
  readonly module: Module
  readonly config: WsGeneratedConfig<Module, ConnectionClass, RelationContext> &
    MismatchedGeneratedModuleDiagnostic<Module, ConnectionClass>
}) =>
  makeScopedGeneratedFromModulePlan<Module, ConnectionClass, RelationContext>({
    plan: makeModulePlan(options.module),
    config: options.config,
  })
