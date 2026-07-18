/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import { pathToFileURL } from "node:url"
import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

const { describe, expect, live } = EffectVitest

import type { SubscriptionHandleLike } from "effect-spacetimedb/testing"
import {
  LIVE_TEST_TIMEOUT_MS,
  type MigrationLiveHarness,
  migrationLiveHarness,
  provideLiveTest,
  waitForRows,
} from "./helpers/live-harness"

type GeneratedConnection = {
  readonly callReducerWithParams: (
    name: string,
    paramsType: unknown,
    params: object,
  ) => Promise<void>
  readonly callProcedureWithParams: (
    name: string,
    paramsType: unknown,
    params: object,
    returnType: unknown,
  ) => Promise<unknown>
  readonly db: Record<string, Relation<unknown> | undefined>
  readonly disconnect: () => void
  readonly subscriptionBuilder: () => GeneratedSubscriptionBuilder
}

type GeneratedSubscriptionBuilder = {
  readonly onError: (
    callback: (context: unknown, error?: Error) => void,
  ) => GeneratedSubscriptionBuilder
  readonly subscribe: (sql: string) => SubscriptionHandleLike
}

type GeneratedBuilder = {
  readonly withUri: (uri: string) => GeneratedBuilder
  readonly withDatabaseName: (databaseName: string) => GeneratedBuilder
  readonly withToken: (token: string) => GeneratedBuilder
  readonly withCompression: (compression: "none") => GeneratedBuilder
  readonly onConnect: (
    callback: (connection: GeneratedConnection) => void,
  ) => GeneratedBuilder
  readonly onConnectError: (
    callback: (context: unknown, error: Error) => void,
  ) => GeneratedBuilder
  readonly build: () => GeneratedConnection
}

type GeneratedClient = {
  readonly DbConnection: {
    readonly builder: () => GeneratedBuilder
  }
}

type Relation<Row> = {
  readonly iter: () => Iterable<Row>
}

type AccountV1 = {
  readonly id: bigint
  readonly owner: string
}

type AccountV2 = AccountV1 & {
  readonly displayName: string
}

type AccountV3 = AccountV2 & {
  readonly archived: boolean
}

type AccountTag = {
  readonly id: bigint
  readonly accountId: bigint
  readonly tag: string
}

class MigrationGeneratedClientImportError extends Data.TaggedError(
  "MigrationGeneratedClientImportError",
)<{
  readonly cause: unknown
}> {}

class MigrationConnectionError extends Data.TaggedError(
  "MigrationConnectionError",
)<{
  readonly cause: unknown
}> {}

class MigrationCallError extends Data.TaggedError("MigrationCallError")<{
  readonly cause: unknown
}> {}

class MigrationRelationMissing extends Data.TaggedError(
  "MigrationRelationMissing",
)<{
  readonly key: string
}> {}

class MigrationRelationError extends Data.TaggedError(
  "MigrationRelationError",
)<{
  readonly cause: unknown
}> {}

class MigrationAccountMissing extends Data.TaggedError(
  "MigrationAccountMissing",
)<{
  readonly owner: string
}> {}

const importGeneratedClient = (directory: string) =>
  Effect.tryPromise({
    try: async () =>
      (await import(
        pathToFileURL(`${directory}/index.ts`).href
      )) as GeneratedClient,
    catch: (cause) => new MigrationGeneratedClientImportError({ cause }),
  })

const generatedConnection = (
  client: GeneratedClient,
  target: MigrationLiveHarness,
) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const pending = Promise.withResolvers<GeneratedConnection>()
        client.DbConnection.builder()
          .withUri(target.baseUrl)
          .withDatabaseName(target.databaseName)
          .withToken(target.token)
          .withCompression("none")
          .onConnect((connection) => {
            pending.resolve(connection)
          })
          .onConnectError((_context, error) => {
            pending.reject(error)
          })
          .build()
        return await pending.promise
      },
      catch: (cause) => new MigrationConnectionError({ cause }),
    }),
    (connection) =>
      Effect.try({
        try: () => {
          connection.disconnect()
        },
        catch: (cause) => new MigrationConnectionError({ cause }),
      }).pipe(Effect.orDie),
  )

const withGeneratedConnection = <A, E>(
  client: GeneratedClient,
  target: MigrationLiveHarness,
  use: (connection: GeneratedConnection) => Effect.Effect<A, E>,
) =>
  generatedConnection(client, target).pipe(Effect.flatMap(use), Effect.scoped)

const callReducer = (
  connection: GeneratedConnection,
  name: string,
  args: object,
) =>
  Effect.tryPromise({
    try: () => connection.callReducerWithParams(name, undefined, args),
    catch: (cause) => new MigrationCallError({ cause }),
  })

const callProcedure = <A>(
  connection: GeneratedConnection,
  name: string,
  args: object,
) =>
  Effect.tryPromise({
    try: async () =>
      (await connection.callProcedureWithParams(
        name,
        undefined,
        args,
        undefined,
      )) as A,
    catch: (cause) => new MigrationCallError({ cause }),
  })

const subscribeSql = (connection: GeneratedConnection, sql: string) =>
  Effect.try({
    try: () =>
      connection
        .subscriptionBuilder()
        .onError(() => undefined)
        .subscribe(sql),
    catch: (cause) => new MigrationConnectionError({ cause }),
  })

const relationRows = <Row>(connection: GeneratedConnection, key: string) =>
  Effect.gen(function* () {
    const relation = connection.db[key] as Relation<Row> | undefined
    if (relation === undefined) {
      return yield* new MigrationRelationMissing({ key })
    }
    return yield* Effect.try({
      try: () => Array.from(relation.iter()),
      catch: (cause) => new MigrationRelationError({ cause }),
    })
  })

const findAccountId = Effect.fn(function* (
  rows: ReadonlyArray<AccountV1>,
  owner: string,
) {
  const row = rows.find((candidate) => candidate.owner === owner)
  if (row === undefined) {
    return yield* new MigrationAccountMissing({ owner })
  }
  return row.id
})

describe("effect-spacetimedb live migrations", () => {
  live(
    "preserves rows and exposes additive schema across repeated publishes",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const migration = yield* migrationLiveHarness
          const v1 = yield* importGeneratedClient(
            migration.generatedClientDirs.v1,
          )
          const v2 = yield* importGeneratedClient(
            migration.generatedClientDirs.v2,
          )
          const v3 = yield* importGeneratedClient(
            migration.generatedClientDirs.v3,
          )

          const accountId = yield* withGeneratedConnection(
            v1,
            migration,
            Effect.fn(function* (connection) {
              yield* subscribeSql(connection, "SELECT * FROM all_accounts")
              yield* callReducer(connection, "account_create", {
                owner: "ada",
              })
              const rows = yield* waitForRows(
                () => relationRows<AccountV1>(connection, "all_accounts"),
                (currentRows) => currentRows.some((row) => row.owner === "ada"),
                "v1 allAccounts view did not expose the created account",
              )
              const owners = yield* callProcedure<ReadonlyArray<string>>(
                connection,
                "account_owners",
                {},
              )
              expect(owners).toContain("ada")
              return yield* findAccountId(rows, "ada")
            }),
          )

          yield* migration.republish(migration.bundlePaths.v2)
          yield* withGeneratedConnection(
            v2,
            migration,
            Effect.fn(function* (connection) {
              yield* subscribeSql(connection, "SELECT * FROM all_accounts")
              const rows = yield* waitForRows(
                () => relationRows<AccountV2>(connection, "all_accounts"),
                (currentRows) =>
                  currentRows.some(
                    (row) =>
                      row.owner === "ada" && row.displayName === "anonymous",
                  ),
                "v2 allAccounts view did not preserve/default the v1 account",
              )
              expect(rows).toContainEqual(
                expect.objectContaining({
                  id: accountId,
                  owner: "ada",
                  displayName: "anonymous",
                }),
              )

              yield* callReducer(connection, "account_tag_add", {
                accountId,
                tag: "founder",
              })
              const tags = yield* callProcedure<ReadonlyArray<AccountTag>>(
                connection,
                "account_tags",
                {
                  accountId,
                },
              )
              expect(tags).toContainEqual(
                expect.objectContaining({
                  accountId,
                  tag: "founder",
                }),
              )
            }),
          )

          yield* migration.republish(migration.bundlePaths.v3)
          yield* withGeneratedConnection(
            v3,
            migration,
            Effect.fn(function* (connection) {
              yield* subscribeSql(connection, "SELECT * FROM all_accounts")
              const rows = yield* waitForRows(
                () => relationRows<AccountV3>(connection, "all_accounts"),
                (currentRows) =>
                  currentRows.some(
                    (row) =>
                      row.owner === "ada" &&
                      row.displayName === "anonymous" &&
                      row.archived === false,
                  ),
                "v3 allAccounts view did not preserve/default the v2 account",
              )
              expect(rows).toContainEqual(
                expect.objectContaining({
                  id: accountId,
                  owner: "ada",
                  displayName: "anonymous",
                  archived: false,
                }),
              )

              const indexedRows = yield* callProcedure<
                ReadonlyArray<AccountV3>
              >(connection, "account_by_owner", {
                owner: "ada",
              })
              expect(indexedRows).toContainEqual(
                expect.objectContaining({
                  id: accountId,
                  owner: "ada",
                }),
              )
            }),
          )
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
