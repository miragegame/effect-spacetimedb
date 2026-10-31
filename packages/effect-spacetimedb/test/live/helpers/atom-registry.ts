import * as Effect from "effect/Effect"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"

export const scopedAtomRegistry = Effect.acquireRelease(
  Effect.suspend(() => Effect.succeed(AtomRegistry.make())),
  (registry) =>
    Effect.suspend(() => {
      registry.dispose()
      return Effect.void
    }),
)
