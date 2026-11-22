/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */
import * as Client from "effect-spacetimedb/client"
import { pathToFileURL } from "node:url"
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import { project } from "effect-spacetimedb"
import {
  makeDevServer,
  DevServerCommandError,
  type PublishedModuleRuntime,
} from "effect-spacetimedb/dev-server"
import * as esbuild from "esbuild"
import { cacheModule } from "../../examples/cache-policy-fixture/contract"
import {
  packageRoot,
  requiredSpacetimeCliVersion,
  generateModuleClientWithSpacetime,
} from "../../scripts/standalone-helpers.mjs"
import { sqlRows } from "./helpers/environment-live"
import { LIVE_TEST_TIMEOUT_MS, provideLiveTest } from "./helpers/live-harness"
import { makeLiveWebSocket } from "./helpers/live-websocket"

const { describe, expect, live } = EffectVitest
const contract = cacheModule(false)
const projected = project(contract.spec)
const tableKeys = ["memory", "disk", "flexible", "inherited"] as const

const prepare = Effect.fn(function* (
  directory: string,
  edition: "original" | "rotated" | "invalid",
) {
  const path = yield* Path.Path
  const bundlePath = path.join(directory, edition + ".js")
  const generatedClientDir = path.join(directory, edition)
  const invalid = edition === "invalid"
  yield* Effect.promise(() =>
    esbuild.build({
      absWorkingDir: packageRoot,
      ...(invalid
        ? {
            stdin: {
              resolveDir: packageRoot,
              contents:
                'import { schema, table, t } from "spacetimedb/server"; export default schema({ disk: table({cachePolicy: "required_on_disk", indexes: [{ accessor: "by_id", algorithm: "direct", column: "id" }]}, {id: t.u32()}) });',
            },
          }
        : { entryPoints: ["examples/cache-policy-fixture/index.ts"] }),
      define: { ROTATE_CACHE_POLICIES: String(edition === "rotated") },
      bundle: true,
      outfile: bundlePath,
      format: "esm",
      external: ["spacetime:*"],
      target: "es2022",
      platform: "neutral",
      mainFields: ["module", "main"],
    }),
  )
  if (!invalid)
    generateModuleClientWithSpacetime({
      moduleRoot: packageRoot,
      databaseNamePrefix: "cache-policy",
      bundlePath,
      generatedClientDir,
    })
  return { bundlePath, generatedClientDir }
})

// The SDK omits RequiredInMemory from the system table. Use the host's table
// ids to resolve its two stored policy variants to the declared user tables.
const checkPolicies = Effect.fn(function* (
  runtime: PublishedModuleRuntime,
  rotated: boolean,
) {
  const tables = yield* sqlRows(
    runtime,
    "SELECT table_id, table_name FROM st_table",
  )
  const policies = yield* sqlRows(
    runtime,
    "SELECT table_id, policy FROM st_table_cache_policy",
  )
  const byId = new Map(policies.map(([id, policy]) => [id, policy]))
  const rows = Object.fromEntries(
    tables
      .filter(([, name]) => tableKeys.some((key) => key === name))
      .map(([id, name]) => [String(name), byId.get(id)]),
  )
  expect(rows).toEqual(
    rotated
      ? {
          memory: [1, []],
          disk: [2, []],
          flexible: undefined,
          inherited: [2, []],
        }
      : {
          memory: undefined,
          disk: [1, []],
          flexible: [2, []],
          inherited: [1, []],
        },
  )
})

describe("table cache policy", () => {
  live(
    "migrates every storage tier in both directions while one set of bindings reads all rows",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          yield* fs.makeDirectory(path.join(packageRoot, ".tmp"), {
            recursive: true,
          })
          const directory = yield* fs.makeTempDirectoryScoped({
            directory: path.join(packageRoot, ".tmp"),
            prefix: "cache-policy-",
          })
          const original = yield* prepare(directory, "original")
          const rotated = yield* prepare(directory, "rotated")
          const invalid = yield* prepare(directory, "invalid")
          const files = (root: string) =>
            fs
              .readDirectory(root, { recursive: true })
              .pipe(Effect.map((entries) => [...entries].sort()))
          const names = yield* files(original.generatedClientDir)
          expect(names).toContain("index.ts")
          expect(yield* files(rotated.generatedClientDir)).toEqual(names)
          yield* Effect.forEach(
            names,
            Effect.fn(function* (name) {
              const source = path.join(original.generatedClientDir, name)
              if ((yield* fs.stat(source)).type === "File") {
                expect(
                  yield* fs.readFile(
                    path.join(rotated.generatedClientDir, name),
                  ),
                ).toEqual(yield* fs.readFile(source))
              }
            }),
            { concurrency: 1 },
          )

          const runtime = yield* makeDevServer({
            bundlePath: original.bundlePath,
            cwd: packageRoot,
            dbNamePrefix: "cache-policy",
            logDir: directory,
            versionRequirement: requiredSpacetimeCliVersion,
          })
          const client: {
            DbConnection: {
              builder(): Client.GeneratedWsBuilderLike<
                typeof contract.spec,
                unknown
              >
            }
          } = yield* Effect.promise(
            () =>
              import(
                pathToFileURL(
                  path.join(original.generatedClientDir, "index.ts"),
                ).href
              ),
          )
          const checkRows = (insert: boolean) =>
            Effect.gen(function* () {
              const session = yield* projected.client.ws.scoped({
                builder: () => client.DbConnection.builder(),
                uri: runtime.baseUrl,
                databaseName: runtime.databaseName,
                token: runtime.token,
                compression: "none",
                createWebSocket: makeLiveWebSocket,
              })
              if (insert) yield* session.reducers.record({ id: "survivor" })
              yield* Effect.forEach(
                tableKeys,
                Effect.fn(function* (key) {
                  yield* session.subscribe(projected.targets.tables[key])
                  expect(yield* session.cache.tables[key].toArray()).toEqual([
                    { id: "survivor" },
                  ])
                }),
                { concurrency: 1, discard: true },
              )
            }).pipe(Effect.scoped)
          yield* checkRows(true)
          yield* checkPolicies(runtime, false)
          yield* runtime.republish(rotated.bundlePath)
          yield* checkRows(false)
          yield* checkPolicies(runtime, true)
          yield* runtime.republish(original.bundlePath)
          yield* checkRows(false)
          yield* checkPolicies(runtime, false)
          const refusal = yield* Effect.flip(
            runtime.republish(invalid.bundlePath),
          )
          expect(refusal).toBeInstanceOf(DevServerCommandError)
          if (refusal instanceof DevServerCommandError)
            expect(refusal.stderr + refusal.stdout).toMatch(/btree/i)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
