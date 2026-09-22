import * as Effect from "effect/Effect"
import {
  ConnectionLostError,
  type TransportError,
  WsRpcInvokeError,
} from "./call-errors.ts"
import type { WsConnectionState } from "./connection-state.ts"
import {
  missingWsRpcTransport,
  type WsCallableTransport,
} from "./websocket-contract.ts"

type WsCallFailure = ConnectionLostError | TransportError | WsRpcInvokeError

export const makeWsConnectionAwareCalls = (options: {
  readonly connectionState: WsConnectionState
  readonly transport: WsCallableTransport | undefined
}): {
  readonly invokeProcedure: (
    name: string,
    params: object,
  ) => Effect.Effect<unknown, WsCallFailure>
  readonly invokeReducer: (
    name: string,
    params: object,
  ) => Effect.Effect<void, WsCallFailure>
} => {
  const connectionLost = options.connectionState
    .awaitInvalidation()
    .pipe(
      Effect.flatMap((invalidation) =>
        Effect.fail(new ConnectionLostError({ raw: invalidation.message })),
      ),
    )

  const invokeWithConnection = <A>(
    invoke: () => Promise<A>,
  ): Effect.Effect<A, ConnectionLostError | WsRpcInvokeError> =>
    Effect.suspend<A, ConnectionLostError | WsRpcInvokeError, never>(() => {
      const invalidation = options.connectionState.invalidation()
      if (invalidation != null) {
        return Effect.fail(
          new ConnectionLostError({ raw: invalidation.message }),
        )
      }

      return Effect.tryPromise({
        try: invoke,
        catch: (cause) => new WsRpcInvokeError({ cause }),
      })
    }).pipe(Effect.raceFirst(connectionLost))

  const transport = options.transport

  return {
    invokeProcedure: (name, params) =>
      transport != null
        ? invokeWithConnection(() =>
            transport.callProcedureWithParams(
              name,
              undefined,
              params,
              undefined,
            ),
          )
        : missingWsRpcTransport,
    invokeReducer: (name, params) =>
      transport != null
        ? invokeWithConnection(() =>
            transport.callReducerWithParams(name, undefined, params),
          )
        : missingWsRpcTransport,
  }
}
