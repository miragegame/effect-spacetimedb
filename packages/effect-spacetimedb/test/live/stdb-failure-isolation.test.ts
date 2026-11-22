/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as StdbInternal from "effect-spacetimedb/testing/internal"
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  DevServerCommandError,
  type PublishedModuleRuntime,
} from "effect-spacetimedb/dev-server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FailureModule } from "../../examples/failure-fixture/module/src/contract"
import {
  defectDetail,
  FailureFunctionsLive,
} from "../../examples/failure-fixture/module/src/live"
import {
  makeFailureRuntime,
  publishInvalidContract,
  rawCall,
  readModuleLog,
  waitForModuleLog,
} from "./helpers/failure-live"
import { LIVE_TEST_TIMEOUT_MS, provideLiveTest } from "./helpers/live-harness"

const { describe, expect, live } = EffectVitest

// A procedure answers with a SATS result, which the host's JSON writes as the
// variant's index and its value: `ok` is 0 and `err` is 1.
const ResultBody = Schema.fromJsonString(
  Schema.Tuple([Schema.Finite, Schema.Unknown]),
)
const decodeResultBody = Schema.decodeUnknownSync(ResultBody)

const decodeResult = (body: string) => {
  const [variant, value] = decodeResultBody(body)
  return variant === 0
    ? { ok: value, err: undefined }
    : { ok: undefined, err: value as string }
}

const UndeclaredFailure = Schema.fromJsonString(
  Schema.Struct({
    _effectSpacetimeDb: Schema.Literal("UndeclaredFailure"),
    version: Schema.Literal(1),
    reason: Schema.String,
    message: Schema.String,
  }),
)
const decodeUndeclared = Schema.decodeUnknownSync(UndeclaredFailure)

const undeclaredOf = (body: string) => {
  const { err } = decodeResult(body)
  return decodeUndeclared(err)
}

/** The counter's next value, as a raw caller reads it. */
const nextCount = (runtime: PublishedModuleRuntime) =>
  Effect.map(rawCall(runtime, "next_count", []), (call) => {
    expect(call.status).toBe(200)
    return BigInt(decodeResult(call.body).ok as number)
  })

describe("effect-spacetimedb live failure isolation", () => {
  live(
    "keeps the isolate through bad arguments, defects and declared errors, and tells the caller nothing internal",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const runtime = yield* makeFailureRuntime
          const first = yield* nextCount(runtime)

          const badArguments = yield* rawCall(runtime, "echo_short", [
            "longer than four",
          ])
          expect(badArguments.status).toBe(200)
          const refused = undeclaredOf(badArguments.body)
          expect(refused.reason).toBe("BadArguments")
          expect(refused.message).toContain("echoShort")
          expect(badArguments.body).not.toContain("    at ")
          expect(yield* nextCount(runtime)).toBe(first + 1n)

          const defect = yield* rawCall(runtime, "die_with_detail", [])
          expect(defect.status).toBe(200)
          expect(undeclaredOf(defect.body).reason).toBe("Failed")
          expect(defect.body).not.toContain(defectDetail)
          expect(defect.body).not.toContain("FixtureDefect")
          expect(defect.body).not.toContain("    at ")
          expect(yield* nextCount(runtime)).toBe(first + 2n)
          yield* waitForModuleLog(runtime, defectDetail)

          const declared = yield* rawCall(runtime, "fail_declared", [])
          expect(declared.status).toBe(200)
          expect(decodeResult(declared.body).err).toContain("DeclaredError")
          expect(decodeResult(declared.body).err).toContain(
            "FailureFixtureRefused",
          )
          expect(yield* nextCount(runtime)).toBe(first + 3n)
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )

  live(
    "answers from the test harness exactly as the host does",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const runtime = yield* makeFailureRuntime
          const plan = StdbInternal.planModule(FailureModule, [
            FailureFunctionsLive,
          ])
          const callables = StdbTesting.bindCallables(plan)
          const harness = StdbTesting.makeTestModuleHarness(FailureModule.spec)
          const invoke = (name: string) =>
            callables[name]!.invoke(harness.makeProcedureCtx(), {})

          yield* Effect.forEach(
            [
              ["die_with_detail", "dieWithDetail"],
              ["fail_declared", "failDeclared"],
            ] as const,
            ([wireName, name]) =>
              Effect.map(rawCall(runtime, wireName, []), (host) => {
                expect(invoke(name)).toEqual({
                  err: decodeResult(host.body).err,
                })
              }),
            { concurrency: 1 },
          )
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )

  live(
    "rolls a failed transaction back before it answers",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const runtime = yield* makeFailureRuntime
          const first = yield* nextCount(runtime)

          const failed = yield* rawCall(runtime, "insert_then_die", ["roll"])
          expect(undeclaredOf(failed.body).reason).toBe("Failed")

          // Same key, another row: this collides had the first one committed.
          const recorded = yield* rawCall(runtime, "record_short", ["roll"])
          expect(recorded.status).toBe(200)
          expect(yield* nextCount(runtime)).toBe(first + 1n)
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )

  live(
    "runs a transaction's releases inside it, on the host's own runtime",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const runtime = yield* makeFailureRuntime
          const first = yield* nextCount(runtime)

          const released = yield* rawCall(runtime, "insert_in_release", [
            "kept",
          ])
          expect(decodeResult(released.body).err).toBeUndefined()
          // The release's insert used the body's `Db`, so its row committed.
          const collided = yield* rawCall(runtime, "record_short", ["kept"])
          expect(collided.status).toBe(530)

          const died = yield* rawCall(runtime, "insert_then_release_dies", [
            "gone",
          ])
          expect(undeclaredOf(died.body).reason).toBe("Failed")
          // A release that dies aborts, so the body's row never committed.
          const recorded = yield* rawCall(runtime, "record_short", ["gone"])
          expect(recorded.status).toBe(200)
          expect(yield* nextCount(runtime)).toBe(first + 1n)
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )

  live(
    "answers bad reducer arguments as a sender error, without a panic in the log",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const runtime = yield* makeFailureRuntime

          const bad = yield* rawCall(runtime, "record_short", [
            "longer than four",
          ])

          expect(bad.status).toBe(530)
          expect(bad.body).toContain("Invalid arguments for recordShort")
          expect(bad.body).not.toContain("fatal error")
          expect(bad.body).not.toContain("    at ")

          const log = yield* readModuleLog(runtime)
          expect(log).not.toContain('"level":"Panic"')
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )

  live(
    "logs a failing scheduled procedure and keeps the isolate",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const runtime = yield* makeFailureRuntime
          const first = yield* nextCount(runtime)

          const scheduled = yield* rawCall(runtime, "schedule_failing_run", [
            "run",
          ])
          expect(scheduled.status).toBe(200)
          yield* waitForModuleLog(runtime, defectDetail)

          expect(yield* nextCount(runtime)).toBe(first + 1n)

          // Any client can reach a scheduled target. It cannot answer that
          // caller, and refusing it must not cost the isolate either.
          const external = yield* rawCall(runtime, "fail_run", [
            {
              scheduled_id: 0,
              scheduled_at: {
                Interval: { __time_duration_micros__: 1_000_000 },
              },
              note: "external",
            },
          ])
          expect(external.status).toBe(200)
          expect(yield* nextCount(runtime)).toBe(first + 2n)
          expect(yield* readModuleLog(runtime)).not.toContain(
            "only invocable by the scheduler",
          )
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )

  live(
    "prints the validation diagnostic when a contract fails at publish",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const failure = yield* Effect.flip(publishInvalidContract)

          expect(failure).toBeInstanceOf(DevServerCommandError)
          if (failure instanceof DevServerCommandError) {
            const output = `${failure.stdout}\n${failure.stderr}`
            expect(output).toContain("DuplicateRelationName")
            expect(output).toContain("Module declares duplicate table twice")
          }
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )
})
