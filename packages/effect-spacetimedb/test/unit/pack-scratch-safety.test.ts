import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import * as EffectVitest from "@effect/vitest"
import {
  assertPackageScratchDestination,
  packageRoot,
  packPublishArchive,
} from "../../scripts/pack.mjs"

const { describe, expect, it } = EffectVitest

describe("package archive scratch safety", () => {
  const scratchRoot = path.join(packageRoot, ".tmp")

  it("accepts only non-root descendants of package scratch", () => {
    const destination = path.join(scratchRoot, "publish")
    expect(assertPackageScratchDestination(destination)).toBe(destination)

    for (const unsafe of [
      scratchRoot,
      packageRoot,
      path.dirname(packageRoot),
    ]) {
      expect(() => assertPackageScratchDestination(unsafe)).toThrow(
        "Pack destination must be a non-root descendant",
      )
    }
  })

  it("rejects a symlinked destination before cleanup", async () => {
    mkdirSync(scratchRoot, { recursive: true })
    const outside = mkdtempSync(path.join(tmpdir(), "pack-safety-outside-"))
    const outsidePackage = path.join(outside, "package")
    const sentinel = path.join(outsidePackage, "sentinel.txt")
    const destination = mkdtempSync(path.join(scratchRoot, "pack-safety-link-"))
    rmSync(destination, { recursive: true })
    mkdirSync(outsidePackage)
    writeFileSync(sentinel, "keep\n")
    symlinkSync(outside, destination, "dir")

    try {
      await expect(packPublishArchive(destination)).rejects.toThrow(
        "Pack destination must not contain symlinks",
      )
      expect(readFileSync(sentinel, "utf8")).toBe("keep\n")
    } finally {
      unlinkSync(destination)
      rmSync(outside, { force: true, recursive: true })
    }
  })
})
