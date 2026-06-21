import * as Effect from "effect/Effect"
import { type OwnedHandler, withHandlerOwner } from "./handler-ownership.ts"

export type LifecycleHandler<
  A = unknown,
  E = never,
  R = never,
> = OwnedHandler & {
  readonly kind: "lifecycle-handler"
  readonly handler: () => Effect.Effect<A, E, R>
}

const makeLifecycle = <A, E, R>(
  owner: symbol,
  handler: () => Effect.Effect<A, E, R>,
): LifecycleHandler<A, E, R> =>
  withHandlerOwner(owner, {
    kind: "lifecycle-handler",
    handler,
  })

export const init = makeLifecycle
export const clientConnected = makeLifecycle
export const clientDisconnected = makeLifecycle
