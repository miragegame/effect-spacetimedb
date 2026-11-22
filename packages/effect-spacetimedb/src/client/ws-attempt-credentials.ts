import * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { CredentialsInvalidation } from "./connection-state.ts"
import type { WsAttemptCredentials, WsToken } from "./generated-ws-adapter.ts"
import {
  connectError,
  disconnectMessage,
  type WsConnectError,
} from "./ws-resource-lifecycle.ts"

/**
 * What a token Effect's end says of the connection it was for. One that was
 * interrupted counts with one that died: its bound cut it off, or nobody is left
 * to ask.
 */
export const credentialsInvalidation = (
  cause: Cause.Cause<WsConnectError>,
): CredentialsInvalidation => {
  const failure = Cause.findErrorOption(cause)
  if (Option.isSome(failure)) {
    return {
      kind: "credentialsFailed",
      message: `Token refresh failed: ${disconnectMessage(failure.value)}`,
      cause: failure.value.cause,
    }
  }
  const defect = Cause.squash(cause)
  return {
    kind: "credentialsDefect",
    message: `Token refresh died: ${disconnectMessage(defect)}`,
    defect,
  }
}

/** Told when an attempt's token Effect ended without producing a token. */
export type TokenUnavailable = (
  invalidation: CredentialsInvalidation,
) => Effect.Effect<void>

type RefreshOptions = {
  readonly services: Context.Context<never>
  /**
   * Runs each token refresh the SDK starts during a reconnect. The acquisition
   * owns it: the reconnect attempt's bound (not a timer of its own) limits it,
   * and any refresh that does not succeed (a failure, a defect, an
   * interruption) ends the connection, so the SDK never retries a token that
   * may never come back (a signed-out user) and the session's owner decides.
   */
  readonly superviseRefresh: (
    refresh: Effect.Effect<string, WsConnectError>,
  ) => Effect.Effect<string, WsConnectError>
}

/**
 * The credentials one connection attempt presents. A fixed token is used as
 * is. A token Effect is evaluated now (the caller bounds the attempt), its
 * failure becoming the attempt's `WsConnectError` cause; with automatic
 * reconnect it is also the SDK's refresh, run with `services` under
 * `superviseRefresh`. `onUnavailable` is how this attempt's owner tells a token
 * that did not come from a socket that did not connect: the failure alone reads
 * the same, and a token's defect is not a failure at all.
 */
export const attemptCredentials = (
  token: WsToken | undefined,
  options: RefreshOptions & {
    readonly automaticReconnect: boolean
    readonly onUnavailable: TokenUnavailable
  },
): Effect.Effect<WsAttemptCredentials, WsConnectError> => {
  if (token === undefined || typeof token === "string") {
    return Effect.succeed({ token, refreshToken: undefined })
  }
  const evaluated = token.pipe(Effect.mapError((cause) => connectError(cause)))
  const run = Effect.runPromiseWith(options.services)
  const refresh = options.superviseRefresh(evaluated)
  const refreshToken = options.automaticReconnect
    ? () => run(refresh)
    : undefined
  return evaluated.pipe(
    Effect.onError((cause) =>
      options.onUnavailable(credentialsInvalidation(cause)),
    ),
    Effect.map((resolved) => ({ token: resolved, refreshToken })),
  )
}

/**
 * The token the connection authenticates with now: the SDK keeps
 * `connection.token` current when an automatic reconnect refreshes it.
 * Connections without one (test doubles) keep the token they connected with.
 */
export const liveToken = (
  connection: { readonly token?: string | undefined },
  connectedWith: string,
): string =>
  typeof connection.token === "string" && connection.token.length > 0
    ? connection.token
    : connectedWith
