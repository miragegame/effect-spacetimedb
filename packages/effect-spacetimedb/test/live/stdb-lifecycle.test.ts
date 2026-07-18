/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import { makeModuleLifecycle } from "effect-spacetimedb/dev-server"

const { describe, expect, live } = EffectVitest

import type { NativeSubscriptionHandleLike } from "effect-spacetimedb/testing"
import {
  exampleBundlePath,
  packageRoot,
  resolveSpacetimeCliCommand,
} from "../../scripts/standalone-helpers.mjs"
import {
  LIVE_TEST_TIMEOUT_MS,
  Live,
  LiveModule,
  makeExampleSession,
} from "./helpers/example-live"
import {
  type LiveConnection,
  liveHarness,
  provideLiveTest,
  typedConnection,
  waitForRows,
} from "./helpers/live-harness"

type AuditLogRow = {
  readonly id: bigint
  readonly kind: unknown
  readonly subject: string
}

type Relation<Row> = {
  readonly iter: () => Iterable<Row>
}

class LiveLifecycleRelationMissing extends Data.TaggedError(
  "LiveLifecycleRelationMissing",
)<{
  readonly key: string
}> {}

class LiveLifecycleRelationError extends Data.TaggedError(
  "LiveLifecycleRelationError",
)<{
  readonly cause: unknown
}> {}

class LiveLifecycleSubscriptionError extends Data.TaggedError(
  "LiveLifecycleSubscriptionError",
)<{
  readonly cause: unknown
}> {}

class LiveLifecycleAuditRowMissing extends Data.TaggedError(
  "LiveLifecycleAuditRowMissing",
)<{
  readonly kind: string
}> {}

const relationRows = (
  connection: LiveConnection<typeof LiveModule>,
  key: string,
) =>
  Effect.gen(function* () {
    const relation = (
      connection.db as Record<string, Relation<AuditLogRow> | undefined>
    )[key]
    if (relation === undefined) {
      return yield* new LiveLifecycleRelationMissing({ key })
    }
    return yield* Effect.try({
      try: () => Array.from(relation.iter()),
      catch: (cause) => new LiveLifecycleRelationError({ cause }),
    })
  })

const auditKind = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value.toLowerCase()
  }
  if (typeof value !== "object" || value === null || !("tag" in value)) {
    return undefined
  }
  const tag = (value as { readonly tag: unknown }).tag
  return typeof tag === "string" ? tag.toLowerCase() : undefined
}

const auditRowsOfKind = (
  rows: ReadonlyArray<AuditLogRow>,
  kind: string,
): ReadonlyArray<AuditLogRow> =>
  rows.filter((row) => auditKind(row.kind) === kind)

const subscribeAuditLog = (connection: LiveConnection<typeof LiveModule>) =>
  Effect.try({
    try: (): NativeSubscriptionHandleLike =>
      connection
        .subscriptionBuilder()
        .onError(() => undefined)
        .subscribe("SELECT * FROM auditLog" as never),
    catch: (cause) => new LiveLifecycleSubscriptionError({ cause }),
  })

describe("effect-spacetimedb live lifecycle", () => {
  live(
    "reports status and explicitly resets then republishes the module",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const before = yield* live.status()
          expect(before.reachable).toBe(true)
          expect(before.published).toBe(true)

          const fs = yield* FileSystem.FileSystem
          const cliRootDir = yield* fs.makeTempDirectoryScoped({
            prefix: "effect-spacetimedb-delete-only-",
          })
          const cli = resolveSpacetimeCliCommand()
          const deleteOnly = makeModuleLifecycle({
            baseUrl: live.baseUrl,
            databaseName: live.databaseName,
            token: live.token,
            binaries: { cli, standalone: cli },
            cliRootDir,
            cwd: packageRoot,
          })
          yield* deleteOnly.reset()

          const deleted = yield* deleteOnly.status()
          expect(deleted).toEqual({ reachable: true, published: false })

          yield* live.republish(exampleBundlePath)

          const after = yield* live.status()
          expect(after.reachable).toBe(true)
          expect(after.published).toBe(true)
          expect(after.databaseIdentity).toBeTypeOf("string")
        }),
      ),
    LIVE_TEST_TIMEOUT_MS,
  )

  live(
    "records init, connect, and disconnect lifecycle hooks in auditLog",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { connection, live, session } = yield* makeExampleSession
          const subscription = yield* subscribeAuditLog(connection)
          const sessionSubject = yield* Effect.try({
            try: () => session.identity.toHexString(),
            catch: (cause) => new LiveLifecycleRelationError({ cause }),
          })

          yield* waitForRows(
            () => relationRows(connection, "auditLog"),
            (rows) => rows.some((row) => auditKind(row.kind) === "init"),
            "module init audit row did not appear",
          )
          const rowsBeforeScopedConnection = yield* waitForRows(
            () => relationRows(connection, "auditLog"),
            (rows) =>
              rows.some(
                (row) =>
                  auditKind(row.kind) === "connected" &&
                  row.subject === sessionSubject,
              ),
            "connection audit row did not appear for the live session",
          )
          const connectedCountBefore = auditRowsOfKind(
            rowsBeforeScopedConnection,
            "connected",
          ).length
          const disconnectedCountBefore = auditRowsOfKind(
            rowsBeforeScopedConnection,
            "disconnected",
          ).length

          const disconnectedSubject = yield* Effect.gen(function* () {
            const scopedSession = yield* Live.client.ws.scoped(
              live.makeWsConfig(LiveModule),
            )
            const scopedSubscription = yield* subscribeAuditLog(
              typedConnection(scopedSession, LiveModule),
            )
            const connectedRows = yield* waitForRows(
              () => relationRows(connection, "auditLog"),
              (rows) =>
                auditRowsOfKind(rows, "connected").length >
                connectedCountBefore,
              "second connection audit row did not appear before closing the scoped connection",
            )
            const subject = auditRowsOfKind(connectedRows, "connected").at(
              -1,
            )?.subject
            if (subject === undefined) {
              return yield* new LiveLifecycleAuditRowMissing({
                kind: "connected",
              })
            }
            scopedSubscription.unsubscribe()
            return subject
          }).pipe(Effect.scoped)
          yield* waitForRows(
            () => relationRows(connection, "auditLog"),
            (rows) =>
              auditRowsOfKind(rows, "disconnected").length >
                disconnectedCountBefore &&
              rows.some(
                (row) =>
                  auditKind(row.kind) === "disconnected" &&
                  row.subject === disconnectedSubject,
              ),
            "disconnect audit row did not appear after closing a scoped connection",
          )

          expect(disconnectedSubject.length).toBeGreaterThan(0)
          subscription.unsubscribe()
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
