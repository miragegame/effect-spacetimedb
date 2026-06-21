import * as Effect from "effect/Effect"
import type { SyncResponse } from "../http-primitives.ts"
import { type OwnedHandler, withHandlerOwner } from "./handler-ownership.ts"

export type HttpHandlerHandler<
  Args,
  A = SyncResponse,
  E = never,
  R = never,
> = OwnedHandler & {
  readonly kind: "http-handler"
  readonly handler: (args: Args) => Effect.Effect<A, E, R>
}

export const httpHandler = <Args, A, E, R>(
  owner: symbol,
  handler: (args: Args) => Effect.Effect<A, E, R>,
): HttpHandlerHandler<Args, A, E, R> =>
  withHandlerOwner(owner, {
    kind: "http-handler",
    handler,
  })
