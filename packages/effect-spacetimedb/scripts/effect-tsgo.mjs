import { spawnSync } from "node:child_process"
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import getExePath from "@effect/tsgo/lib/getExePath"

// The CLI's `get-exe-path` command chmods the packaged executable before it
// prints the path, which fails when node_modules is mounted read-only.
// Its public library entry resolves the same pinned executable without writing.
const exe = getExePath()
let executable = exe
let scratchDirectory
try {
  accessSync(exe, constants.X_OK)
} catch {
  const scratchRoot = fileURLToPath(new URL("../.tmp/", import.meta.url))
  mkdirSync(scratchRoot, { recursive: true })
  scratchDirectory = mkdtempSync(join(scratchRoot, "effect-tsgo-"))
  executable = join(scratchDirectory, basename(exe))
  copyFileSync(exe, executable)
  chmodSync(executable, 0o755)
}

const runCompiler = () => {
  try {
    return spawnSync(executable, process.argv.slice(2), {
      stdio: "inherit",
    })
  } finally {
    if (scratchDirectory !== undefined) {
      rmSync(scratchDirectory, { recursive: true, force: true })
    }
  }
}

const result = runCompiler()
if (result.error !== undefined) {
  console.error(result.error)
  process.exit(1)
}
if (result.signal !== null) {
  process.kill(process.pid, result.signal)
}
process.exit(result.status ?? 1)
