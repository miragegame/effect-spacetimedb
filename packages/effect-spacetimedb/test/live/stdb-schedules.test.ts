/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpBody from "effect/unstable/http/HttpBody"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as GeneratedArtifact from "../../examples/publishable-module/generated-client/index.js"

const { describe, expect, live } = EffectVitest

import {
  CONVERGENCE_TIMEOUT_MS,
  LIVE_TEST_TIMEOUT_MS,
  LiveModule,
  makeExampleSession,
  wireFunction,
} from "./helpers/example-live"
import {
  type LiveConnection,
  provideLiveTest,
  sendLiveReducer,
  waitForRows,
} from "./helpers/live-harness"
import { waitForPredicate } from "./helpers/wait-for-predicate"

type LiveSubscriptionBuilder = ReturnType<
  LiveConnection<typeof LiveModule>["subscriptionBuilder"]
>

const observeSubscriptionApplies = (
  connection: LiveConnection<typeof LiveModule>,
) => {
  let appliedCount = 0
  const originalSubscriptionBuilder =
    connection.subscriptionBuilder.bind(connection)

  Object.defineProperty(connection, "subscriptionBuilder", {
    configurable: true,
    value: (): LiveSubscriptionBuilder => {
      const nativeBuilder = originalSubscriptionBuilder()
      const wrapped: LiveSubscriptionBuilder = {
        onApplied: (callback) => {
          nativeBuilder.onApplied(() => {
            appliedCount = appliedCount + 1
            callback()
          })
          return wrapped
        },
        onError: (callback) => {
          nativeBuilder.onError(callback)
          return wrapped
        },
        subscribe: (query) => nativeBuilder.subscribe(query),
      }
      return wrapped
    },
  })

  return {
    appliedCount: () => appliedCount,
  }
}

const callRawReducerOverHttp = (params: {
  readonly baseUrl: string
  readonly databaseName: string
  readonly payload: string
  readonly reducer: string
  readonly token: string
}) =>
  Effect.flatMap(HttpClient.HttpClient, (http) => {
    // Scheduled targets are intentionally absent from generated client contracts.
    const request = HttpClientRequest.post(
      `${params.baseUrl.replace(/\/+$/u, "")}/v1/database/${
        params.databaseName
      }/call/${params.reducer}`,
    ).pipe(
      HttpClientRequest.bearerToken(params.token),
      HttpClientRequest.setBody(
        HttpBody.text(params.payload, "application/json"),
      ),
    )
    return http.execute(request).pipe(
      Effect.flatMap((response) =>
        response.text.pipe(
          Effect.map((body) => ({ status: response.status, body })),
        ),
      ),
      Effect.scoped,
    )
  }).pipe(Effect.provide(FetchHttpClient.layer))

describe("effect-spacetimedb live schedules", () => {
  live(
    "enforces scheduler lifecycle behavior for scheduled reducer and procedure targets",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { live, session, connection } = yield* makeExampleSession
          expect(session.token).toBe(live.token)
          const subscriptions = observeSubscriptionApplies(connection)
          yield* session
            .streamTable("reducerSchedule")
            .pipe(Stream.runDrain, Effect.forkScoped)
          yield* session
            .streamTable("procedureSchedule")
            .pipe(Stream.runDrain, Effect.forkScoped)
          yield* session
            .streamTable("scheduledResult")
            .pipe(Stream.runDrain, Effect.forkScoped)
          yield* waitForPredicate(
            () => subscriptions.appliedCount() >= 3,
            "schedule and result table streams did not apply before enqueue",
            CONVERGENCE_TIMEOUT_MS,
          )
          const reducerOneShotNote = "one-shot-reducer"
          const procedureOneShotNote = "one-shot-procedure"
          const intervalNote = "interval-reducer"

          yield* sendLiveReducer(
            connection,
            wireFunction("scheduleReducerNote"),
            {
              note: reducerOneShotNote,
            },
          )
          yield* waitForRows(
            () => session.cache.tables.reducerSchedule.toArray(),
            (rows) =>
              rows.some(
                (row) =>
                  row.scheduledAt.tag === "Time" &&
                  row.note === reducerOneShotNote,
              ),
          )
          yield* sendLiveReducer(
            connection,
            wireFunction("scheduleProcedureNote"),
            {
              note: procedureOneShotNote,
            },
          )
          yield* waitForRows(
            () => session.cache.tables.procedureSchedule.toArray(),
            (rows) =>
              rows.some(
                (row) =>
                  row.scheduledAt.tag === "Time" &&
                  row.note === procedureOneShotNote,
              ),
          )
          yield* sendLiveReducer(
            connection,
            wireFunction("scheduleIntervalReducerNote"),
            {
              note: intervalNote,
            },
          )
          yield* waitForRows(
            () => session.cache.tables.reducerSchedule.toArray(),
            (value) =>
              value.some(
                (row) =>
                  row.scheduledAt.tag === "Interval" &&
                  row.note === intervalNote,
              ),
          )

          const reducerSchedules = yield* waitForRows(
            () => session.cache.tables.reducerSchedule.toArray(),
            (rows) =>
              rows.some(
                (row) =>
                  row.scheduledAt.tag === "Interval" &&
                  row.note === intervalNote,
              ) &&
              rows.every(
                (row) =>
                  row.scheduledAt.tag !== "Time" ||
                  row.note !== reducerOneShotNote,
              ),
          )
          expect(
            reducerSchedules.filter(
              (row) =>
                row.scheduledAt.tag === "Time" &&
                row.note === reducerOneShotNote,
            ).length,
          ).toBe(0)
          expect(
            reducerSchedules.filter(
              (row) =>
                row.scheduledAt.tag === "Interval" && row.note === intervalNote,
            ).length,
          ).toBeGreaterThanOrEqual(1)

          const procedureSchedules = yield* waitForRows(
            () => session.cache.tables.procedureSchedule.toArray(),
            (rows) =>
              rows.every(
                (row) =>
                  row.scheduledAt.tag !== "Time" ||
                  row.note !== procedureOneShotNote,
              ),
          )
          expect(
            procedureSchedules.filter(
              (row) =>
                row.scheduledAt.tag === "Time" &&
                row.note === procedureOneShotNote,
            ).length,
          ).toBe(0)

          const scheduledResults = yield* waitForRows(
            () => session.cache.tables.scheduledResult.toArray(),
            (rows) =>
              rows.some((row) => row.note === reducerOneShotNote) &&
              rows.some((row) => row.note === procedureOneShotNote),
            "scheduled targets did not produce result rows",
          )
          const scheduledNotes = [reducerOneShotNote, procedureOneShotNote]
          yield* Effect.forEach(
            scheduledNotes,
            (note) => {
              const result = scheduledResults.find((row) => row.note === note)
              expect(result).toBeDefined()
              expect(result?.sender).toMatch(/^[0-9a-f]{64}$/u)
              expect(result?.identity).toBe(result?.sender)
              expect(result?.databaseIdentity).toBe(result?.sender)
              return Effect.void
            },
            { discard: true },
          )

          const externalCall = yield* callRawReducerOverHttp({
            baseUrl: live.baseUrl,
            databaseName: live.databaseName,
            payload:
              '[{"scheduled_id":0,"scheduled_at":{"Interval":{"__time_duration_micros__":1000000}},"note":"external"}]',
            reducer: wireFunction("reminderFireReducer"),
            token: live.token,
          })
          expect(externalCall.status).toBe(530)
          expect(externalCall.body).toContain(
            "Scheduled target reminderFireReducer is only invocable by the scheduler",
          )

          const generatedProcedures = (
            GeneratedArtifact as unknown as {
              readonly procedures?: Readonly<Record<string, unknown>>
            }
          ).procedures
          expect(generatedProcedures).toBeDefined()
          const procedures = generatedProcedures ?? {}
          expect("thingGet" in procedures).toBe(true)
          expect("reminderFireProcedure" in procedures).toBe(false)
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )
})
