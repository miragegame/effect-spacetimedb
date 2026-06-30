import { spawnSync } from "node:child_process"
import { chmodSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const effectTsgoBin = require.resolve("@effect/tsgo/dist/effect-tsgo.js")

const exeResult = spawnSync(process.execPath, [effectTsgoBin, "get-exe-path"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
})

if (exeResult.status !== 0) {
  process.exit(exeResult.status ?? 1)
}

const exe = exeResult.stdout.trim()
try {
  chmodSync(exe, 0o755)
} catch {
  // Best effort: the package manager usually installs the binary executable.
}

const result = spawnSync(exe, process.argv.slice(2), { stdio: "inherit" })
if (result.signal !== null) {
  process.kill(process.pid, result.signal)
}
process.exit(result.status ?? 1)
