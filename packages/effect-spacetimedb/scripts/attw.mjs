import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { packPublishArchive } from "./pack.mjs"
import { packageRoot, runCommand } from "./standalone-helpers.mjs"

const packageScratchRoot = path.join(packageRoot, ".tmp")
const requestedTarball = process.argv[2]
let tempRoot

try {
  let tarball
  if (requestedTarball === undefined) {
    await mkdir(packageScratchRoot, { recursive: true })
    tempRoot = await mkdtemp(path.join(packageScratchRoot, "attw-"))
    tarball = await packPublishArchive(tempRoot)
  } else {
    tarball = path.resolve(packageRoot, requestedTarball)
  }
  const require = createRequire(import.meta.url)
  const attwPackageJsonPath = require.resolve(
    "@arethetypeswrong/cli/package.json",
  )
  const { bin } = require(attwPackageJsonPath)
  const attwRelative = typeof bin === "string" ? bin : bin.attw
  const attwScript = fileURLToPath(
    new URL(attwRelative, pathToFileURL(attwPackageJsonPath)),
  )

  runCommand(
    process.execPath,
    [attwScript, tarball, "--profile", "esm-only", "--no-emoji"],
    { stdio: "inherit" },
  )
} finally {
  if (tempRoot !== undefined) {
    await rm(tempRoot, { force: true, recursive: true })
  }
}
