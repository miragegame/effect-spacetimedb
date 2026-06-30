import * as Effect from "effect/Effect"
import { type OwnedHandler, withHandlerOwner } from "./handler-ownership.ts"

export type ReducerHandler<
  Args,
  A = unknown,
  E = never,
  R = never,
> = OwnedHandler & {
  readonly kind: "reducer-handler"
  readonly handler: (args: Args) => Effect.Effect<A, E, R>
}

export const reducer = <Args, A, E, R>(
  owner: symbol,
  handler: (args: Args) => Effect.Effect<A, E, R>,
): ReducerHandler<Args, A, E, R> =>
  withHandlerOwner(owner, {
    kind: "reducer-handler",
    handler,
  })
