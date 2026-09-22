import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { packageRoot, runCommand } from "./standalone-helpers.mjs"

export { packageRoot }

const isNonRootDescendant = (root, candidate) => {
  const relative = path.relative(root, candidate)
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

export const assertPackageScratchDestination = (destination) => {
  const scratchRoot = path.join(packageRoot, ".tmp")
  const resolved = path.resolve(destination)
  if (!isNonRootDescendant(scratchRoot, resolved)) {
    throw new Error(
      `Pack destination must be a non-root descendant of ${scratchRoot}: ${resolved}`,
    )
  }
  return resolved
}

const preparePackageScratchDestination = async (destination) => {
  const scratchRoot = path.join(packageRoot, ".tmp")
  const resolved = assertPackageScratchDestination(destination)
  await mkdir(scratchRoot, { recursive: true })

  const scratchStats = await lstat(scratchRoot)
  if (scratchStats.isSymbolicLink()) {
    throw new Error(
      `Package scratch root must not be a symlink: ${scratchRoot}`,
    )
  }

  let current = scratchRoot
  for (const segment of path.relative(scratchRoot, resolved).split(path.sep)) {
    current = path.join(current, segment)
    try {
      const stats = await lstat(current)
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Pack destination must not contain symlinks: ${resolved}`,
        )
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error
      }
      await mkdir(current)
    }
  }

  const [canonicalScratchRoot, canonicalDestination] = await Promise.all([
    realpath(scratchRoot),
    realpath(resolved),
  ])
  if (!isNonRootDescendant(canonicalScratchRoot, canonicalDestination)) {
    throw new Error(
      `Canonical pack destination escaped package scratch: ${canonicalDestination}`,
    )
  }
  return resolved
}

export const packPublishArchive = async (tempRoot) => {
  const resolvedTempRoot = await preparePackageScratchDestination(tempRoot)
  const stagingDirectory = path.join(resolvedTempRoot, "package")

  for (const entry of await readdir(resolvedTempRoot)) {
    if (entry === "package" || entry.endsWith(".tgz")) {
      await rm(path.join(resolvedTempRoot, entry), {
        recursive: true,
        force: true,
      })
    }
  }
  await mkdir(stagingDirectory, { recursive: true })
  runCommand("bun", ["run", "build"], { stdio: "inherit" })

  // Copy the package source and let its `files` manifest field remain the one
  // source of truth for what bun includes in the archive. Exclude the
  // dependency tree, package-local scratch, and generated coverage report
  // from the staging input; none can match the publish allowlist.
  for (const entry of await readdir(packageRoot)) {
    if (entry === "node_modules" || entry === ".tmp" || entry === "coverage") {
      continue
    }
    await cp(
      path.join(packageRoot, entry),
      path.join(stagingDirectory, entry),
      {
        recursive: true,
      },
    )
  }

  const manifest = JSON.parse(
    await readFile(path.join(stagingDirectory, "package.json"), "utf8"),
  )
  const publishConfig = manifest.publishConfig
  if (
    publishConfig === undefined ||
    publishConfig === null ||
    typeof publishConfig !== "object" ||
    publishConfig.exports === undefined
  ) {
    throw new Error(
      "package.json publishConfig.exports is required for packing",
    )
  }

  manifest.exports = publishConfig.exports
  if ("sideEffects" in publishConfig) {
    manifest.sideEffects = publishConfig.sideEffects
  }
  if (
    manifest.scripts !== undefined &&
    manifest.scripts !== null &&
    typeof manifest.scripts === "object"
  ) {
    delete manifest.scripts.prepack
  }
  await writeFile(
    path.join(stagingDirectory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  runCommand("bun", ["pm", "pack", "--destination", resolvedTempRoot], {
    cwd: stagingDirectory,
    stdio: "inherit",
  })

  const tarballs = (await readdir(resolvedTempRoot)).filter((entry) =>
    entry.endsWith(".tgz"),
  )
  if (tarballs.length !== 1) {
    throw new Error(
      `Expected exactly one packed tarball in ${resolvedTempRoot}, found ${tarballs.length}`,
    )
  }

  return path.join(resolvedTempRoot, tarballs[0])
}

const invokedPath = process.argv[1]
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  const destination = process.argv[2]
  if (destination === undefined) {
    throw new Error("Usage: node scripts/pack.mjs <destination>")
  }
  const tarball = await packPublishArchive(
    path.resolve(packageRoot, destination),
  )
  process.stdout.write(`${tarball}\n`)
}
