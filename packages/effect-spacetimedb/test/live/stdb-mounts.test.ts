/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */
import * as EffectVitest from "@effect/vitest"
import * as Predicate from "effect/Predicate"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Queue from "effect/Queue"
import { project } from "effect-spacetimedb"
import { wsSupervisorGenerated } from "effect-spacetimedb/client"
import { App, itemRef } from "../../examples/mounted-module/contract.ts"
import { DbConnection } from "../../examples/mounted-module/client.ts"
import { makeDroppableSockets } from "./helpers/droppable-websocket.ts"
import { makeLiveWebSocket } from "./helpers/live-websocket.ts"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as HttpClient from "effect/http/HttpClient"
import * as Path from "effect/Path"
import * as esbuild from "esbuild"
import { makeDevServer } from "effect-spacetimedb/dev-server"
import {
  packageRoot,
  requiredSpacetimeCliVersion,
} from "../../scripts/standalone-helpers.mjs"
import { sqlRows, postJson } from "./helpers/environment-live.ts"
import {
  LIVE_TEST_TIMEOUT_MS,
  provideLiveTest,
  waitForRows,
} from "./helpers/live-harness.ts"

const { expect, live } = EffectVitest

const bundle = (
  entry: string,
  outfile: string,
  define?: Record<string, string>,
) =>
  Effect.promise(() =>
    esbuild.build({
      absWorkingDir: packageRoot,
      entryPoints: ["examples/mounted-module/" + entry + ".ts"],
      bundle: true,
      outfile,
      format: "esm",
      external: ["spacetime:*"],
      target: "es2022",
      platform: "neutral",
      mainFields: ["module", "main"],
      ...(define === undefined ? {} : { define }),
    }),
  )

live(
  "a pinned SQL namespace survives an accessor rename",
  () =>
    provideLiveTest(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fs.makeTempDirectoryScoped()
        const edition = Effect.fn(function* (key: string, name: string) {
          const file = path.join(directory, key + "-" + name + ".js")
          yield* bundle("rename", file, {
            MOUNT_ACCESSOR: JSON.stringify(key),
            MOUNT_NAME: JSON.stringify(name),
          })
          return file
        })
        const original = yield* edition("inventory", "stock")
        const renamed = yield* edition("warehouse", "stock")
        const moved = yield* edition("warehouse", "storage")
        const runtime = yield* makeDevServer({
          bundlePath: original,
          cwd: packageRoot,
          dbNamePrefix: "rename-mount",
          logDir: directory,
          versionRequirement: requiredSpacetimeCliVersion,
        })
        yield* postJson(runtime, "/call/stock.save", "[]", "application/json")
        yield* runtime.republish(renamed)
        expect(yield* sqlRows(runtime, 'SELECT * FROM "stock"."item"')).toEqual(
          [[1]],
        )
        const refused = yield* Effect.flip(runtime.republish(moved))
        expect(refused).toMatchObject({
          stderr: expect.stringContaining("table contains data"),
        })
        expect(yield* sqlRows(runtime, 'SELECT * FROM "stock"."item"')).toEqual(
          [[1]],
        )
        yield* postJson(runtime, "/call/stock.clear", "[]", "application/json")
        yield* runtime.republish(moved)
        expect(
          yield* sqlRows(runtime, 'SELECT * FROM "storage"."item"'),
        ).toEqual([])
      }),
    ),
  { timeout: LIVE_TEST_TIMEOUT_MS },
)

live(
  "namespaced handlers share transactions, scopes and schedules on the standalone",
  () =>
    provideLiveTest(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fs.makeTempDirectoryScoped()
        const bundlePath = path.join(directory, "mounted.js")
        yield* bundle("index", bundlePath)
        const runtime = yield* makeDevServer({
          bundlePath,
          cwd: packageRoot,
          dbNamePrefix: "warehouse",
          logDir: directory,
          versionRequirement: requiredSpacetimeCliVersion,
        })
        const call = (name: string, ...args: readonly unknown[]) =>
          postJson(
            runtime,
            "/call/" + name,
            JSON.stringify(args),
            "application/json",
          )
        const rows = (name: string) => sqlRows(runtime, "SELECT * FROM " + name)
        yield* call("write_items", 1, false)
        const failure = yield* Effect.flip(call("write_items", 2, true))
        expect(failure).toMatchObject({
          body: expect.stringContaining("undo warehouse write"),
        })
        yield* Effect.forEach(
          [
            "receipt",
            '"stock_room"."stored_item"',
            '"stock_room"."private_item"',
            '"stock_room"."audit_trail"."entry"',
            "inventory_items",
            "inventory_query",
            '"stock_room"."audit_entries"',
            '"stock_room"."listed_items"',
            '"stock_room"."matching_items"(1)',
          ],
          (name) =>
            Effect.map(rows(name), (result) =>
              expect(result, name).toEqual([[1]]),
            ),
          { concurrency: 1, discard: true },
        )

        yield* call("native_insert", 3, 0)
        expect(yield* Effect.result(call("native_insert", 3, 1))).toMatchObject(
          {
            failure: { body: expect.stringContaining("duplicate native item") },
          },
        )
        expect(yield* Effect.flip(call("native_insert", 0, 0))).toMatchObject({
          body: expect.stringContaining("native item requires a positive id"),
        })
        expect(
          yield* postJson(runtime, "/route/deliver", "", "text/plain"),
        ).toBe("delivered")
        yield* call("save_both", 4)
        yield* call("open_scoped_tx", 5)
        yield* call("stock_room.save_item", [0, [6]])
        expect(
          yield* sqlRows(runtime, 'SELECT id FROM "tools"."native_item"'),
        ).toEqual(expect.arrayContaining([[3], [4], [5], [8]]))
        const http = yield* HttpClient.HttpClient
        yield* call("stock_room.queue_item", 7)
        expect(yield* rows('"stock_room"."audit_entries"')).toEqual(
          expect.arrayContaining([[7]]),
        )
        const stored = yield* waitForRows(
          () =>
            rows('"stock_room"."stored_item"').pipe(
              Effect.provideService(HttpClient.HttpClient, http),
            ),
          (values) => values.some(([id]) => id === 7),
          "The scoped scheduled reducer did not insert its row",
        )
        expect(stored.map(([id]) => id).sort()).toEqual([1, 4, 5, 6, 7, 8])
      }),
    ),
  { timeout: LIVE_TEST_TIMEOUT_MS },
)

live(
  "generated clients call, subscribe and recover across mount namespaces",
  () =>
    provideLiveTest(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const directory = yield* fs.makeTempDirectoryScoped()
        const bundlePath = path.join(directory, "warehouse.js")
        yield* bundle("index", bundlePath)
        const runtime = yield* makeDevServer({
          bundlePath,
          cwd: packageRoot,
          dbNamePrefix: "mounted-client",
          logDir: directory,
          environment: { WAREHOUSE_ZONE: "north" },
          versionRequirement: requiredSpacetimeCliVersion,
        })
        const app = project(App)
        const config = {
          uri: runtime.baseUrl,
          databaseName: runtime.databaseName,
          token: runtime.token,
          DbConnection,
          compression: "none" as const,
          createWebSocket: makeLiveWebSocket,
        }
        const http = app.client.http.make(config)
        const ws = yield* app.client.ws.scopedGenerated(config)
        const first = itemRef.make.by_id({ item_id: 1 })
        const second = itemRef.make.by_id({ item_id: 2 })
        expect(
          yield* http.procedures.stockRoom.save_item({ item_ref: first }),
        ).toEqual(first)
        expect(
          yield* ws.procedures.stockRoom.save_item({ item_ref: second }),
        ).toEqual(second)
        const stock = app.targets.tables.stockRoom
        const views = app.targets.views.stockRoom
        const cache = ws.cache.tables.stockRoom
        yield* ws.subscribe(stock.storedItem.where((row) => row.id.eq(1)))
        expect(yield* cache.storedItem.toArray()).toEqual([{ id: 1 }])
        yield* ws.subscribe(stock.storedItem)
        expect(yield* cache.storedItem.id.find(2)).toEqual({ id: 2 })
        yield* ws.subscribe(views.listedItems)
        yield* ws.subscribe(views.matchingItems({ id: 2 }))
        expect(yield* ws.cache.views.stockRoom.listedItems.toArray()).toEqual(
          expect.arrayContaining([{ id: 1 }, { id: 2 }]),
        )
        expect(yield* ws.cache.views.stockRoom.matchingItems.toArray()).toEqual(
          [{ id: 2 }],
        )

        yield* ws.reducers.stockRoom.queueItem({ id: 3 })
        yield* http.reducers.stockRoom.queueItem({ id: 4 })
        const tagged = cache.auditTrail.tagged_item
        yield* ws.subscribe(
          stock.auditTrail.tagged_item.where((row) => row.bucket_id.eq(1)),
        )
        expect(yield* tagged.toArray()).toEqual([{ entry_id: 3, bucket_id: 1 }])
        yield* ws.subscribe(stock.auditTrail.tagged_item)
        expect(yield* tagged.entry_id.find(4)).toEqual({
          entry_id: 4,
          bucket_id: 0,
        })
        expect(
          yield* tagged.by_bucket.filter({
            from: { tag: "excluded", value: 0 },
            to: { tag: "unbounded" },
          }),
        ).toEqual([{ entry_id: 3, bucket_id: 1 }])

        const content = Uint8Array.of(0, 128, 255)
        yield* ws.reducers.uploadFile({ bytes: content })
        expect(yield* ws.procedures.readFile({})).toEqual(content)

        const reader = yield* app.client.ws.scopedGenerated(config)
        const changes = yield* Queue.unbounded<number>()
        yield* reader.streamTable("stockRoom.auditTrail.entry").pipe(
          Stream.runForEach((change) =>
            Predicate.isTagged(change, "Insert")
              ? Queue.offer(changes, change.row.id)
              : Effect.void,
          ),
          Effect.forkScoped,
        )
        // The initial insert notifications prove the stream has applied.
        expect(
          [yield* Queue.take(changes), yield* Queue.take(changes)].sort(),
        ).toEqual([3, 4])
        yield* http.reducers.stockRoom.queueItem({ id: 5 })
        expect(yield* Queue.take(changes)).toBe(5)
        const ref = yield* reader.subscribeTableRef(
          "stockRoom.auditTrail.entry",
        )
        const snapshot = yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter(AsyncResult.isSuccess),
          Stream.runHead,
          Effect.map(Option.getOrThrow),
        )
        expect(snapshot.value).toEqual(expect.arrayContaining([{ id: 5 }]))

        const sockets = yield* makeDroppableSockets
        const snapshots =
          yield* Queue.unbounded<ReadonlyArray<{ readonly id: number }>>()
        yield* wsSupervisorGenerated({
          module: App.spec,
          config: { ...config, createWebSocket: sockets.createWebSocket },
          subscriptionTargets: [stock.auditTrail.entry],
          setup: (session) =>
            session.cache.tables.stockRoom.auditTrail.entry.toArray().pipe(
              Effect.flatMap((rows) => Queue.offer(snapshots, rows)),
              Effect.asVoid,
            ),
        })
        expect(yield* Queue.take(snapshots)).toEqual(
          expect.arrayContaining([{ id: 5 }]),
        )
        const reopen = yield* sockets.holdNextOpen
        yield* sockets.dropCurrent
        yield* http.reducers.stockRoom.queueItem({ id: 6 })
        yield* reopen
        expect(yield* Queue.take(snapshots)).toEqual(
          expect.arrayContaining([{ id: 6 }]),
        )
        expect(sockets.openedCount()).toBe(2)
      }),
    ),
  { timeout: LIVE_TEST_TIMEOUT_MS },
)
