import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import * as EffectVitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import { packageRoot, packPublishArchive } from "../../scripts/pack.mjs"

const { describe, expect, it } = EffectVitest
const decodePackedManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      exports: Schema.Unknown,
      publishConfig: Schema.Struct({
        exports: Schema.Unknown,
        sideEffects: Schema.Unknown,
      }),
      scripts: Schema.Record(Schema.String, Schema.String),
      sideEffects: Schema.Unknown,
    }),
  ),
)

describe("packed archive contents", () => {
  it("contains the publish manifest, declarations, and source maps", async () => {
    const scratchRoot = path.join(packageRoot, ".tmp")
    mkdirSync(scratchRoot, { recursive: true })
    const destination = mkdtempSync(
      path.join(scratchRoot, "packed-archive-contents-"),
    )

    try {
      const tarball = await packPublishArchive(destination)
      const entries = execFileSync("tar", ["-tzf", tarball], {
        encoding: "utf8",
      })
        .split("\n")
        .filter((entry) => entry.length > 0)
      const packedManifest = decodePackedManifest(
        execFileSync("tar", ["-xOzf", tarball, "package/package.json"], {
          encoding: "utf8",
        }),
      )

      expect(entries).toContain("package/dist/index.d.ts")
      expect(entries).toContain("package/dist/index.d.ts.map")
      expect(entries).toContain("package/dist/index.js")
      expect(entries.some((entry) => entry.endsWith(".js.map"))).toBe(true)
      expect(entries).toContain("package/LICENSE")
      expect(entries).toContain("package/README.md")
      expect(entries.some((entry) => entry.startsWith("package/src/"))).toBe(
        true,
      )
      for (const excluded of [
        "package/examples/",
        "package/dist-types/",
        "package/coverage/",
        "package/node_modules/",
        "package/scripts/",
        "package/test/",
        "package/.tmp/",
      ]) {
        expect(entries.some((entry) => entry.startsWith(excluded))).toBe(false)
      }
      expect(packedManifest.exports).toEqual(
        packedManifest.publishConfig.exports,
      )
      expect(packedManifest.sideEffects).toEqual(
        packedManifest.publishConfig.sideEffects,
      )
      expect(packedManifest.scripts.prepack).toBeUndefined()
    } finally {
      rmSync(destination, { force: true, recursive: true })
    }
  })

  it("rejects direct npm packing before it can publish source exports", () => {
    const result = spawnSync("npm", ["pack", "--dry-run"], {
      cwd: packageRoot,
      encoding: "utf8",
    })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "bun run pack:archive",
    )
  })
})
