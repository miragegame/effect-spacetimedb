import * as Effect from "effect/Effect"
import { type OwnedHandler, withHandlerOwner } from "./handler-ownership.ts"

export type ViewHandler<
  Args,
  A = unknown,
  E = never,
  R = never,
> = OwnedHandler & {
  readonly kind: "view-handler"
  readonly handler: (args: Args) => Effect.Effect<A, E, R>
}

export const view = <Args, A, E, R>(
  owner: symbol,
  handler: (args: Args) => Effect.Effect<A, E, R>,
): ViewHandler<Args, A, E, R> =>
  withHandlerOwner(owner, {
    kind: "view-handler",
    handler,
  })

export const anonymousView = <Args, A, E, R>(
  owner: symbol,
  handler: (args: Args) => Effect.Effect<A, E, R>,
): ViewHandler<Args, A, E, R> => view(owner, handler)
