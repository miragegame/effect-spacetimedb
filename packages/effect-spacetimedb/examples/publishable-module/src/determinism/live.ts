import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { ExampleModule } from "../module"

export const DeterminismFunctionsLive = Stdb.StdbBuilder.group(
  ExampleModule,
  "Determinism",
  {
    probeAsync: Effect.fn(function* () {
      // This reducer exists solely to prove the live host rejects async work.
      yield* Effect.sleep(Duration.millis(1))
    }),
    probeWallClock: Effect.fn(function* () {
      // This reducer exists solely to prove the live host rejects wall-clock reads.
      const observed = Date.now()
      yield* Effect.logDebug("Wall-clock probe unexpectedly completed", {
        observed,
      })
    }),
    probeRandom: Effect.fn(function* () {
      // This reducer exists solely to prove the live host rejects global random reads.
      const observed = Math.random()
      yield* Effect.logDebug("Global random probe unexpectedly completed", {
        observed,
      })
    }),
  },
)
