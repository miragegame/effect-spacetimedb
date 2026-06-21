import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
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
      yield* Effect.sleep(Duration.millis(1))
    }

    return yield* new EffectSpacetimeDbTestWaitForPredicateError({
      cause: new Error(message),
    })
  })
