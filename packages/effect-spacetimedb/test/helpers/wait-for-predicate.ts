// lint-ignore: runtime-metadata-heuristics - package tests run under Bun and need a real timer outside Effect's test clock.
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

export class EffectSpacetimeDbTestWaitForPredicateError extends Data.TaggedError(
  "EffectSpacetimeDbTestWaitForPredicateError",
)<{
  readonly cause: unknown
}> {}

export const waitForPredicate = (
  predicate: () => boolean,
  message: string,
  maxAttempts = 250,
) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < maxAttempts; attempt = attempt + 1) {
      if (predicate()) {
        return
      }
      yield* Effect.promise(() => Bun.sleep(1))
    }

    return yield* new EffectSpacetimeDbTestWaitForPredicateError({
      cause: new Error(message),
    })
  })
