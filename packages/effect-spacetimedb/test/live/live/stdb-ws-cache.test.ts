import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as EffectVitest from "@effect/vitest"
const { describe, expect, live } = EffectVitest
import * as ExampleModuleFixture from "effect-spacetimedb/testing/example-module"
import {
  callLiveReducer,
  liveHarness,
  liveFunctionName,
  provideLiveTest,
  type TypedLiveConnection,
  waitForRows,
} from "../helpers/live-harness"
const {
  Example: Live,
  ExampleModule: LiveModule,
  UserId,
  UserName,
} = ExampleModuleFixture
const wireFunction = (name: string) => liveFunctionName(LiveModule, name)
const decodeUserId = Schema.decodeUnknownSync(UserId)
const decodeUserName = Schema.decodeUnknownSync(UserName)
describe("effect-spacetimedb live ws cache", () => {
  live(
    "keeps row ownership on the connection cache and populates it only after subscription",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const live = yield* liveHarness
          const session = yield* Live.client.ws.scoped(
            live.makeWsConfig(LiveModule),
          )
          const connection =
            session.connection as unknown as TypedLiveConnection<
              typeof LiveModule
            >
          expect(session.token).toBe(live.token)
          expect(session.identity).toBeDefined()
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: decodeUserId("cache-user-1"),
            name: decodeUserName("Ada"),
          })
          expect(yield* session.cache.tables.user.toArray()).toEqual([])
          yield* session
            .streamTable("user")
            .pipe(Stream.runDrain, Effect.forkScoped)
          const initialRows = yield* waitForRows(
            () => session.cache.tables.user.toArray(),
            (rows) => rows.length === 1,
          )
          expect(initialRows).toEqual([
            {
              id: decodeUserId("cache-user-1"),
              name: decodeUserName("Ada"),
            },
          ])
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: decodeUserId("cache-user-2"),
            name: decodeUserName("Grace"),
          })
          const updatedRows = yield* waitForRows(
            () => session.cache.tables.user.toArray(),
            (rows) => rows.length === 2,
          )
          expect(
            updatedRows.some(
              (row) =>
                row.id === decodeUserId("cache-user-2") &&
                row.name === decodeUserName("Grace"),
            ),
          ).toBe(true)
        }),
      ),
    { timeout: 180_000 },
  )
})
