import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const packageJsonUrl = new URL("../package.json", import.meta.url)
const backupUrl = new URL(
  "../node_modules/.tmp/package-json.prepack.json",
  import.meta.url,
)
const backupPath = fileURLToPath(backupUrl)

const readTextIfExists = async (url) => {
  try {
    return await readFile(url, "utf8")
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return undefined
      }
    }
    throw error
  }
}

const staleBackup = await readTextIfExists(backupUrl)
if (staleBackup !== undefined) {
  await writeFile(packageJsonUrl, staleBackup)
  await rm(backupUrl)
}

const originalManifest = await readFile(packageJsonUrl, "utf8")
const packageJson = JSON.parse(originalManifest)
const publishConfig = packageJson.publishConfig

if (
  publishConfig === undefined ||
  publishConfig === null ||
  typeof publishConfig !== "object" ||
  publishConfig.exports === undefined
) {
  throw new Error("package.json publishConfig.exports is required for packing")
}

packageJson.exports = publishConfig.exports

if ("sideEffects" in publishConfig) {
  packageJson.sideEffects = publishConfig.sideEffects
}

await mkdir(dirname(backupPath), { recursive: true })
await writeFile(backupUrl, originalManifest)
await writeFile(packageJsonUrl, `${JSON.stringify(packageJson, null, 2)}\n`)
