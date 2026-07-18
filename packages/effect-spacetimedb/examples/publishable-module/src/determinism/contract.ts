import * as Stdb from "effect-spacetimedb"

export const DeterminismFunctions = Stdb.StdbGroup.make("Determinism")
  .add(
    Stdb.StdbFn.reducer("probeAsync", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("probeWallClock", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("probeRandom", {
      params: Stdb.struct({}),
    }),
  )
