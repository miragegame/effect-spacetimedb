import * as Stdb from "effect-spacetimedb"

export const DeterminismFunctions = Stdb.Group.make("Determinism")
  .add(
    Stdb.Fn.reducer("probeAsync", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.Fn.reducer("probeWallClock", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.Fn.reducer("probeRandom", {
      params: Stdb.struct({}),
    }),
  )
