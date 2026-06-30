import * as Stdb from "effect-spacetimedb"

const CallableOnlyFunctions = Stdb.StdbGroup.make("CallableOnly")
  .add(
    Stdb.StdbFn.reducer("ping", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("echo", {
      params: Stdb.struct({
        value: Stdb.string(),
      }),
      returns: Stdb.string(),
    }),
  )

export const CallableOnlyModule = Stdb.StdbModule.make("callable_only", {}).add(
  CallableOnlyFunctions,
).spec
