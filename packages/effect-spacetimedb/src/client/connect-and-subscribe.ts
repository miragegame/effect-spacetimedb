import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { SubscriptionTarget } from "../subscription-target.ts"
import type { WsSession } from "./ws-resource.ts"
import type { SubscriptionFailure } from "./ws-subscription.ts"

export const connectAndSubscribe = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  E,
  R,
>(
  connect: Effect.Effect<
    WsSession<Module, ErrorContext, RelationContext>,
    E,
    R
  >,
  targets: ReadonlyArray<SubscriptionTarget<Module>>,
): Effect.Effect<
  WsSession<Module, ErrorContext, RelationContext>,
  E | SubscriptionFailure,
  R | Scope.Scope
> =>
  Effect.gen(function* () {
    const session = yield* connect
    function subscribe(target: SubscriptionTarget<Module>) {
      return session.subscribe(target)
    }
    yield* Effect.forEach(targets, subscribe, { discard: true })
    return session
  })
