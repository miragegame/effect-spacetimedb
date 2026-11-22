import * as Stdb from "effect-spacetimedb"

// A module that reads its database environment from every callable kind. The
// unit suite runs it through the test harness and the live suite publishes it
// to a standalone server, so both observe the same handlers.

export const observation = Stdb.table("observation", {
  public: true,
  columns: {
    source: Stdb.string().primaryKey(),
    description: Stdb.string(),
  },
})

export const EnvironmentFunctions = Stdb.Group.make("Environment")
  .add(
    Stdb.Fn.reducer("recordEnvironment", {
      params: Stdb.struct({ source: Stdb.string() }),
    }),
  )
  .add(Stdb.Fn.procedure("readEnvironment", { returns: Stdb.string() }))
  .add(Stdb.Fn.procedure("readEnvironmentInTx", { returns: Stdb.string() }))
  .add(
    Stdb.Fn.anonymousView("environmentView", {
      returns: Stdb.array(observation.row),
    }),
  )

export const EnvironmentRoutes = Stdb.HttpGroup.make("EnvironmentRoutes").add(
  Stdb.Http.get("environmentRoute", "/environment"),
)

export const EnvironmentModule = Stdb.Module.make(
  "effect_spacetimedb_environment",
  {
    lifecycle: { init: Stdb.Fn.init() },
    environment: {
      GREETING: Stdb.Environment.string(),
      API_KEY: Stdb.Environment.secret(),
      MODE: Stdb.Environment.literal("development", "production"),
      REGION: Stdb.Environment.optional(Stdb.Environment.string()),
    },
  },
)
  .addTables(observation)
  .add(EnvironmentFunctions)
  .add(EnvironmentRoutes)
