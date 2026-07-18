import path from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import {
  checkArtifact,
  generateArtifact,
  type CodegenTarget,
} from "../src/codegen/index.ts"
import {
  ensureModuleCanResolveInstallRoot,
  exampleBundlePath,
  exampleGeneratedClientDir,
  exampleModuleRoot,
  packageRoot,
  resolveSpacetimeCliCommand,
  runCommand,
} from "./standalone-helpers.mjs"

const args = process.argv.slice(2)
const check = args.length === 1 && args[0] === "--check"
if (args.length > (check ? 1 : 0)) {
  throw new Error(`Unknown argument: ${args.join(" ")}`)
}

ensureModuleCanResolveInstallRoot(exampleModuleRoot)
runCommand("bun", [
  "build",
  path.join(exampleModuleRoot, "src", "index.ts"),
  "--outfile",
  exampleBundlePath,
  "--format",
  "esm",
  "--target",
  "bun",
  "--external",
  "spacetime:sys@2.0",
  "--external",
  "spacetime:sys@2.1",
])

const target: CodegenTarget = {
  moduleBundlePath: exampleBundlePath,
  stagingDir: path.join(
    packageRoot,
    "node_modules",
    ".tmp",
    "effect-spacetimedb-codegen",
    "staging",
  ),
  artifactDir: exampleGeneratedClientDir,
  spacetimeCommand: resolveSpacetimeCliCommand(),
}

if (check) {
  await Effect.runPromise(
    checkArtifact(target).pipe(Effect.provide(NodeServices.layer)),
  )
} else {
  const result = await Effect.runPromise(
    generateArtifact(target).pipe(Effect.provide(NodeServices.layer)),
  )
  process.stdout.write(`${result.artifactDir}\n`)
}
