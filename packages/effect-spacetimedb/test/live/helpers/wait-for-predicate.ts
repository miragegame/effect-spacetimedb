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
  timeoutMs = 250,
) =>
  Effect.gen(function* () {
    for (let elapsedMs = 0; elapsedMs < timeoutMs; elapsedMs = elapsedMs + 1) {
      if (predicate()) {
        return
      }
      yield* Effect.sleep(Duration.millis(1))
    }

    return yield* new EffectSpacetimeDbTestWaitForPredicateError({
      cause: new Error(message),
    })
  })
