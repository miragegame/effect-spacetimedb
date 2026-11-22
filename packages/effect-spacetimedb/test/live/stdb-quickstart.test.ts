/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import * as Path from "node:path"
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { makeDevServer } from "effect-spacetimedb/dev-server"
import {
  buildModuleWithSpacetime,
  generateModuleClientWithSpacetime,
  packageRoot,
  requiredSpacetimeCliVersion,
} from "../../scripts/standalone-helpers.mjs"
import { testEffectCallbackError } from "../helpers/effect-errors"
import { rawCall } from "./helpers/failure-live"
import { LIVE_TEST_TIMEOUT_MS, provideLiveTest } from "./helpers/live-harness"

const { describe, expect, live } = EffectVitest

const quickstartRoot = Path.resolve(
  packageRoot,
  "..",
  "..",
  "examples",
  "quickstart",
)
const stageRoot = Path.join(
  packageRoot,
  ".tmp",
  "effect-spacetimedb-quickstart",
)
const generatedClientDir = Path.join(stageRoot, "src", "module_bindings")

const quickstartError = testEffectCallbackError(
  "effect-spacetimedb/live/quickstart",
)

/**
 * The example's files, staged under this package so they resolve from its
 * install however the example itself was installed.
 */
const stagedQuickstart = Effect.acquireRelease(
  Effect.try({
    try: () => {
      rmSync(stageRoot, { force: true, recursive: true })
      mkdirSync(stageRoot, { recursive: true })
      for (const entry of ["package.json", "src", "tsconfig.json"]) {
        cpSync(Path.join(quickstartRoot, entry), Path.join(stageRoot, entry), {
          recursive: true,
        })
      }
      return {
        moduleRoot: stageRoot,
        bundlePath: Path.join(stageRoot, "dist", "bundle.js"),
        databaseNamePrefix: "effect-spacetimedb-quickstart",
        generatedClientDir,
      }
    },
    catch: quickstartError,
  }),
  () =>
    Effect.try({
      try: () => rmSync(stageRoot, { force: true, recursive: true }),
      catch: quickstartError,
    }).pipe(Effect.ignore),
)

describe("examples/quickstart", () => {
  live(
    "generates, publishes and answers a reducer call on a real host",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const project = yield* stagedQuickstart
          yield* Effect.try({
            try: () => {
              buildModuleWithSpacetime(project)
              generateModuleClientWithSpacetime(project)
            },
            catch: quickstartError,
          })
          expect(readdirSync(generatedClientDir)).toContain("index.ts")

          const runtime = yield* makeDevServer({
            bundlePath: project.bundlePath,
            cwd: packageRoot,
            dbNamePrefix: project.databaseNamePrefix,
            logDir: Path.join(packageRoot, ".tmp", "effect-spacetimedb-live"),
            versionRequirement: requiredSpacetimeCliVersion,
          })
          const id = "first"
          const text = "hello from the quickstart"

          // The host's own route, so this proves what the module answers
          // rather than what a client made of it. A procedure's reply is its
          // result: `ok` is variant 0, holding the rows as arrays.
          const send = yield* rawCall(runtime, "message_send", [id, text])
          expect(send.status).toBe(200)

          const list = yield* rawCall(runtime, "message_list", [])
          expect(list.status).toBe(200)
          expect(list.body).toBe(JSON.stringify([0, [[id, text]]]))
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
