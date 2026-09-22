import * as EffectVitest from "@effect/vitest"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FastCheck from "fast-check"

const { expect } = EffectVitest

/**
 * Runs a fast-check property whose cases are Effects, under the services the
 * calling test already holds — the layer of an `EffectVitest.layer` block, for
 * example.
 *
 * `Effect.context` captures those services once, so a case runs against the
 * already-built layer instead of rebuilding it per generated input, and
 * `FastCheck.check` returns the counterexample as a value instead of throwing,
 * so the only thing that crosses back into Effect is an ordinary `expect`.
 */
export const effectProperty = <A, E, R>(
  arbitrary: FastCheck.Arbitrary<A>,
  body: (value: A) => Effect.Effect<unknown, E, R>,
  parameters: FastCheck.Parameters<[A]>,
): Effect.Effect<void, never, R> =>
  Effect.context<R>().pipe(
    Effect.flatMap((services: Context.Context<R>) =>
      Effect.promise(() =>
        FastCheck.check(
          FastCheck.asyncProperty(arbitrary, (value) =>
            Effect.runPromise(
              body(value).pipe(Effect.asVoid, Effect.provide(services)),
            ),
          ),
          parameters,
        ),
      ),
    ),
    Effect.flatMap((details) =>
      Effect.promise(() => FastCheck.asyncDefaultReportMessage(details)).pipe(
        Effect.map((report) => {
          expect(details.failed, report).toBe(false)
        }),
      ),
    ),
  )
