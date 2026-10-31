import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Stdb from "effect-spacetimedb"
import { EnvironmentModule } from "./contract"

const { Db, Env, Tx } = EnvironmentModule

/**
 * Reads every declared key. The secret is revealed on purpose so the suites
 * can check that the published value arrived; `shown` is what printing the
 * `Redacted` value yields.
 */
export const describeEnvironment = Effect.gen(function* () {
  const env = yield* Env
  const greeting = yield* env.GREETING
  const apiKey = yield* env.API_KEY
  const mode = yield* env.MODE
  const region = yield* env.REGION
  return [
    `greeting=${greeting}`,
    `apiKey=${Redacted.value(apiKey)}`,
    `shown=${String(apiKey)}`,
    `mode=${mode}`,
    `region=${region ?? "<absent>"}`,
  ].join(";")
})

const recordObservation = Effect.fn(function* (source: string) {
  const description = yield* describeEnvironment
  const db = yield* Db
  yield* db.observation.source.delete(source)
  yield* db.observation.insert({ source, description })
})

/**
 * The fixture's `init` refuses an empty greeting, so a test can make the
 * host's reset fail in `init` with an otherwise valid environment.
 */
export class EnvironmentFixtureGreetingEmptyError extends Data.TaggedError(
  "EnvironmentFixtureGreetingEmptyError",
) {}

const initialize = Effect.fn(function* () {
  const env = yield* Env
  if ((yield* env.GREETING).length === 0) {
    return yield* new EnvironmentFixtureGreetingEmptyError()
  }
  yield* recordObservation("init")
})

export const EnvironmentFunctionsLive = Stdb.StdbBuilder.group(
  EnvironmentModule,
  "Environment",
  {
    recordEnvironment: ({ source }) => recordObservation(source),
    readEnvironment: () => describeEnvironment,
    readEnvironmentInTx: Effect.fn(function* () {
      const tx = yield* Tx
      return yield* tx.run(describeEnvironment)
    }),
    environmentView: Effect.fn(function* () {
      const description = yield* describeEnvironment
      return [{ source: "view", description }]
    }),
  },
)

export const EnvironmentRoutesLive = Stdb.StdbBuilder.group(
  EnvironmentModule,
  "EnvironmentRoutes",
  {
    environmentRoute: () =>
      Effect.map(
        describeEnvironment,
        (description) => new Stdb.SyncResponse(description, { status: 200 }),
      ),
  },
)

export const EnvironmentLifecycleLive = Stdb.StdbBuilder.lifecycle(
  EnvironmentModule,
  { init: initialize },
)
