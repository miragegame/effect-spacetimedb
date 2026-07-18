import * as Effect from "effect/Effect"
import { type OwnedHandler, withHandlerOwner } from "./handler-ownership.ts"

export type ProcedureHandler<
  Args,
  A = unknown,
  E = never,
  R = never,
> = OwnedHandler & {
  readonly kind: "procedure-handler"
  readonly handler: (args: Args) => Effect.Effect<A, E, R>
}

export const procedure = <Args, A, E, R>(
  owner: symbol,
  handler: (args: Args) => Effect.Effect<A, E, R>,
): ProcedureHandler<Args, A, E, R> =>
  withHandlerOwner(owner, {
    kind: "procedure-handler",
    handler,
  })
