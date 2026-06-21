// lint-ignore: prefer-effect-filesystem - npm lifecycle manifest rewriting runs outside the Effect runtime.
import { readFile, rm, writeFile } from "node:fs/promises"

const packageJsonUrl = new URL("../package.json", import.meta.url)
const backupUrl = new URL(
  "../node_modules/.tmp/package-json.prepack.json",
  import.meta.url,
)

try {
  const originalManifest = await readFile(backupUrl, "utf8")
  await writeFile(packageJsonUrl, originalManifest)
  await rm(backupUrl)
} catch (error) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    process.exit(0)
  }
  throw error
}
