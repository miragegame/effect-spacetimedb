import * as Stdb from "effect-spacetimedb"

const CallableOnlyFunctions = Stdb.Group.make("CallableOnly")
  .add(
    Stdb.Fn.reducer("ping", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.Fn.procedure("echo", {
      params: Stdb.struct({
        value: Stdb.string(),
      }),
      returns: Stdb.string(),
    }),
  )

export const CallableOnlyBuilder = Stdb.Module.make("callable_only", {}).add(
  CallableOnlyFunctions,
)

export const CallableOnlyModule = CallableOnlyBuilder.spec
