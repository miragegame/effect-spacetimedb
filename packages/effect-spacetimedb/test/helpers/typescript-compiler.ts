import { createRequire } from "node:module"
import * as Path from "node:path"

const typescriptManifestPath = createRequire(import.meta.url).resolve(
  "typescript/package.json",
)

/**
 * The `typescript` package's `tsc` bin. It resolves the platform package's
 * native compiler and runs it; spawning it under the current runtime
 * (`process.execPath`) needs no Node on PATH.
 */
export const typescriptCompilerBin = Path.join(
  Path.dirname(typescriptManifestPath),
  "bin",
  "tsc",
)
