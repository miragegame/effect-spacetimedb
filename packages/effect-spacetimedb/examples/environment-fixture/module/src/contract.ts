import * as Stdb from "effect-spacetimedb"

// A module that reads its database environment from every callable kind. The
// unit suite runs it through the test harness and the live suite publishes it
// to a standalone server, so both observe the same handlers.

// The view returns exactly one row describing the environment.
const ViewRowsLength: Stdb.ArrayLengthBounds = { minimum: 1, maximum: 1 }

export const observation = Stdb.table("observation", {
  public: true,
  columns: {
    source: Stdb.string().primaryKey(),
    description: Stdb.string(),
  },
})

export const EnvironmentFunctions = Stdb.StdbGroup.make("Environment")
  .add(
    Stdb.StdbFn.reducer("recordEnvironment", {
      params: Stdb.struct({ source: Stdb.string() }),
    }),
  )
  .add(Stdb.StdbFn.procedure("readEnvironment", { returns: Stdb.string() }))
  .add(Stdb.StdbFn.procedure("readEnvironmentInTx", { returns: Stdb.string() }))
  .add(
    Stdb.StdbFn.anonymousView("environmentView", {
      returns: Stdb.array(observation.row, ViewRowsLength),
    }),
  )

export const EnvironmentRoutes = Stdb.StdbHttpGroup.make(
  "EnvironmentRoutes",
).add(Stdb.StdbHttp.get("environmentRoute", "/environment"))

export const EnvironmentModule = Stdb.StdbModule.make(
  "effect_spacetimedb_environment",
  {
    lifecycle: { init: Stdb.StdbFn.init() },
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
