/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import {
  DevServerCommandError,
  DevServerEnvironmentValueError,
  type DevServerError,
} from "effect-spacetimedb/dev-server"
import {
  callProcedure,
  callReducer,
  describedAs,
  environmentModuleProject,
  makeEnvironmentRuntime,
  observation,
  routeText,
  viewRows,
} from "./helpers/environment-live"
import {
  LIVE_TEST_TIMEOUT_MS,
  provideLiveTest,
  waitForLiveServerLog,
} from "./helpers/live-harness"

const { describe, expect, live } = EffectVitest

const secret = "live-secret-value-1"

const published = describedAs({
  greeting: "hello",
  apiKey: secret,
  mode: "development",
})

const publishFailureOutput = (failure: DevServerError): string =>
  failure instanceof DevServerCommandError
    ? `${failure.message}\n${failure.stdout}\n${failure.stderr}`
    : `unexpected ${failure.name}: ${failure.message}`

describe("effect-spacetimedb live database environments", () => {
  live(
    "publishes values, serves them to every callable kind, and keeps them across updates and republishes",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const runtime = yield* makeEnvironmentRuntime({
            GREETING: "hello",
            API_KEY: Redacted.make(secret),
            MODE: "development",
          })

          // The host validated the values before init ran, so init saw them.
          expect(yield* observation(runtime, "init")).toEqual([
            { source: "init", description: published },
          ])

          yield* callReducer(runtime, "recordEnvironment", ["reducer"])
          expect(yield* observation(runtime, "reducer")).toEqual([
            { source: "reducer", description: published },
          ])
          expect(yield* callProcedure(runtime, "readEnvironment")).toBe(
            published,
          )
          expect(yield* callProcedure(runtime, "readEnvironmentInTx")).toBe(
            published,
          )
          expect(yield* viewRows(runtime)).toEqual([
            { source: "view", description: published },
          ])
          expect(yield* routeText(runtime)).toBe(published)

          // An environment-only update uploads no module; the next call of
          // every kind reads the new values.
          yield* runtime.updateEnvironment({
            GREETING: "updated",
            REGION: "eu",
          })
          const updated = describedAs({
            greeting: "updated",
            apiKey: secret,
            mode: "development",
            region: "eu",
          })
          expect(yield* callProcedure(runtime, "readEnvironment")).toBe(updated)
          expect(yield* callProcedure(runtime, "readEnvironmentInTx")).toBe(
            updated,
          )
          expect(yield* routeText(runtime)).toBe(updated)
          expect(yield* viewRows(runtime)).toEqual([
            { source: "view", description: updated },
          ])
          yield* callReducer(runtime, "recordEnvironment", ["reducer"])
          expect(yield* observation(runtime, "reducer")).toEqual([
            { source: "reducer", description: updated },
          ])

          // A plain republish supplies nothing; the stored values survive.
          yield* runtime.republish(environmentModuleProject.bundlePath)
          expect(yield* callProcedure(runtime, "readEnvironment")).toBe(updated)

          // An environment-only update is validated by the host itself: a
          // literal outside the set, or deleting a required value, is refused
          // and changes nothing.
          const refusedLiteral = yield* Effect.flip(
            runtime.updateEnvironment({ MODE: "staging" }),
          )
          expect(refusedLiteral).toBeInstanceOf(DevServerCommandError)
          expect(publishFailureOutput(refusedLiteral)).toContain("MODE")
          const refusedUnset = yield* Effect.flip(
            runtime.updateEnvironment({}, { unset: ["GREETING"] }),
          )
          expect(refusedUnset).toBeInstanceOf(DevServerCommandError)
          expect(publishFailureOutput(refusedUnset)).toContain("GREETING")
          expect(yield* callProcedure(runtime, "readEnvironment")).toBe(updated)

          // Unsetting the optional key makes it absent again.
          yield* runtime.updateEnvironment({}, { unset: ["REGION"] })
          expect(yield* callProcedure(runtime, "readEnvironment")).toBe(
            describedAs({
              greeting: "updated",
              apiKey: secret,
              mode: "development",
            }),
          )
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )

  live(
    "resets through the host: init sees the replacement values, and a reset refused by init keeps the database",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const runtime = yield* makeEnvironmentRuntime({
            GREETING: "hello",
            API_KEY: Redacted.make(secret),
            MODE: "development",
          })
          const before = yield* runtime.status()

          yield* runtime.reset({
            environment: {
              GREETING: "after-reset",
              API_KEY: Redacted.make(secret),
              MODE: "production",
            },
          })
          const afterReset = describedAs({
            greeting: "after-reset",
            apiKey: secret,
            mode: "production",
          })
          // The reset cleared the data and ran init with the new values; the
          // host's reset keeps the database's identity.
          expect(yield* observation(runtime, "init")).toEqual([
            { source: "init", description: afterReset },
          ])
          expect((yield* runtime.status()).databaseIdentity).toBe(
            before.databaseIdentity,
          )
          yield* callReducer(runtime, "recordEnvironment", ["reducer"])

          // The fixture's init refuses an empty greeting. The host runs init
          // before deleting anything, so the refused reset changes nothing:
          // the rows, the values, and the values the runtime tracks.
          const refused = yield* Effect.flip(
            runtime.reset({
              environment: {
                GREETING: "",
                API_KEY: Redacted.make(secret),
                MODE: "development",
              },
            }),
          )
          expect(refused).toBeInstanceOf(DevServerCommandError)
          // Refused by init itself, not by some unrelated publish failure:
          // the CLI reports the host's fatal-instance error, and the server
          // log attributes it to init throwing the fixture's error.
          expect(publishFailureOutput(refused)).toContain(
            "The instance encountered a fatal error.",
          )
          yield* waitForLiveServerLog(
            runtime.logPath,
            'reducer "init" runtime error: Uncaught EnvironmentFixtureGreetingEmptyError',
            "SpaceTimeDB standalone log did not attribute the refused reset to init",
          )
          expect(yield* observation(runtime, "reducer")).toEqual([
            { source: "reducer", description: afterReset },
          ])
          expect(yield* callProcedure(runtime, "readEnvironment")).toBe(
            afterReset,
          )
          // A reset with no replacement resupplies what the runtime tracks:
          // still the values of the last reset that succeeded.
          yield* runtime.reset()
          expect(yield* observation(runtime, "init")).toEqual([
            { source: "init", description: afterReset },
          ])
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )

  // The dev server reads the bundle's real declarations with the CLI's own
  // extractor and refuses what the host would refuse before publishing. (Every
  // accepted publish above shows it reads the declared names: a key it did
  // not see declared would be refused as `keyNotDeclared`.)
  live(
    "refuses a publish that leaves a required value missing",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const failure = yield* Effect.flip(
            makeEnvironmentRuntime({
              GREETING: "hello",
              API_KEY: Redacted.make(secret),
            }),
          )

          expect(failure).toEqual(
            new DevServerEnvironmentValueError({
              key: "MODE",
              reason: "requiredValueMissing",
            }),
          )
          expect(failure.message).not.toContain(secret)
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )

  live(
    "refuses a publish whose literal is outside the declared set",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const failure = yield* Effect.flip(
            makeEnvironmentRuntime({
              GREETING: "hello",
              API_KEY: Redacted.make(secret),
              MODE: "staging",
            }),
          )

          expect(failure).toEqual(
            new DevServerEnvironmentValueError({
              key: "MODE",
              reason: "valueOutsideDeclaration",
            }),
          )
          expect(failure.message).not.toContain("staging")
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )
})
