import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  ensureModuleCanResolveInstallRoot,
  exampleBundlePath,
  exampleGeneratedClientDir,
  exampleModuleRoot,
  packageRoot,
  parseSpacetimeCliVersion,
  requiredSpacetimeCliVersion,
  resolveSpacetimeCliCommand,
  runCommand,
} from "./standalone-helpers.mjs"

const nodeMajorVersion = Number.parseInt(
  process.versions.node.split(".")[0],
  10,
)
if (nodeMajorVersion < 20) {
  throw new Error(
    `Packed codegen smoke requires Node 20 or newer; found ${process.version}`,
  )
}

for (const output of [
  `spacetimedb tool version ${requiredSpacetimeCliVersion}-beta.1`,
  `spacetimedb tool version ${requiredSpacetimeCliVersion}+local`,
]) {
  if (parseSpacetimeCliVersion(output) !== undefined) {
    throw new Error(
      `Standalone CLI parser accepted a suffixed version: ${output}`,
    )
  }
}

const packageJson = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
)
const smokeRoot = mkdtempSync(
  path.join(tmpdir(), "effect-spacetimedb-packed-codegen-smoke-"),
)
const packDir = path.join(smokeRoot, "pack")
const consumerDir = path.join(smokeRoot, "consumer")

const exactDependency = (name) => {
  const version = packageJson.devDependencies?.[name]
  if (typeof version !== "string") {
    throw new Error(`Missing exact devDependency used by packed smoke: ${name}`)
  }
  return `${name}@${version}`
}

mkdirSync(packDir, { recursive: true })
mkdirSync(consumerDir, { recursive: true })

try {
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

  runCommand("npm", ["pack", "--pack-destination", packDir], {
    cwd: packageRoot,
  })
  const tarballs = readdirSync(packDir).filter((entry) =>
    entry.endsWith(".tgz"),
  )
  if (tarballs.length !== 1) {
    throw new Error(
      `Expected one packed tarball, found ${tarballs.length.toString()}`,
    )
  }

  const tarball = path.join(packDir, tarballs[0])
  writeFileSync(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify({ name: "packed-codegen-smoke", private: true, type: "module" }, null, 2)}\n`,
  )
  runCommand(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--save-exact",
      tarball,
      exactDependency("@effect/platform-node"),
      exactDependency("effect"),
      exactDependency("spacetimedb"),
    ],
    { cwd: consumerDir },
  )

  cpSync(exampleBundlePath, path.join(consumerDir, "module-bundle.js"))
  cpSync(exampleGeneratedClientDir, path.join(consumerDir, "artifact"), {
    recursive: true,
  })
  writeFileSync(
    path.join(consumerDir, "missing-esbuild.mjs"),
    `import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { CodegenEsbuildMissingError, checkArtifact } from "effect-spacetimedb/codegen"

const target = {
  moduleBundlePath: "module-bundle.js",
  stagingDir: "staging",
  artifactDir: "artifact",
  spacetimeCommand: JSON.parse(process.env.PACKED_CODEGEN_SPACETIME_COMMAND),
}

try {
  await Effect.runPromise(checkArtifact(target).pipe(Effect.provide(NodeServices.layer)))
  throw new Error("Expected codegen to require the optional esbuild peer")
} catch (error) {
  if (!(error instanceof CodegenEsbuildMissingError)) {
    throw error
  }
}
`,
  )
  const smokeEnvironment = {
    ...process.env,
    PACKED_CODEGEN_SPACETIME_COMMAND: JSON.stringify(
      resolveSpacetimeCliCommand(),
    ),
  }
  runCommand(process.execPath, ["missing-esbuild.mjs"], {
    cwd: consumerDir,
    env: smokeEnvironment,
  })
  runCommand(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--save-exact",
      exactDependency("esbuild"),
    ],
    { cwd: consumerDir },
  )
  writeFileSync(
    path.join(consumerDir, "check.mjs"),
    `import { existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import { ArtifactDriftError, checkArtifact, CodegenArtifactDirectoryError, CodegenCliExecutionError, CodegenCliVersionError, generateArtifact } from "effect-spacetimedb/codegen"

const target = {
  moduleBundlePath: "module-bundle.js",
  stagingDir: "staging",
  artifactDir: "artifact",
  spacetimeCommand: JSON.parse(process.env.PACKED_CODEGEN_SPACETIME_COMMAND),
}
const runCheck = () => Effect.runPromise(checkArtifact(target).pipe(Effect.provide(NodeServices.layer)))
const expectDrift = async (file) => {
  try {
    await runCheck()
    throw new Error(\`Expected artifact drift for \${file}\`)
  } catch (error) {
    if (!(error instanceof ArtifactDriftError) || !error.files.includes(file)) {
      throw error
    }
    return error
  }
}

await runCheck()
try {
  await Effect.runPromise(checkArtifact({ ...target, spacetimeCommand: [] }).pipe(Effect.provide(NodeServices.layer)))
  throw new Error("Expected an empty SpaceTimeDB command to fail")
} catch (error) {
  if (
    !(error instanceof CodegenCliExecutionError) ||
    error.operation !== "version" ||
    error.command.length !== 0 ||
    error.stderr !== "Resolved SpaceTimeDB CLI command was empty."
  ) {
    throw error
  }
}
await writeFile(
  "spacetime-prerelease.mjs",
  'process.stdout.write("spacetimedb tool version 2.6.1-beta.1\\\\n")\\n',
)
try {
  await Effect.runPromise(
    checkArtifact({
      ...target,
      spacetimeCommand: [process.execPath, "spacetime-prerelease.mjs"],
    }).pipe(Effect.provide(NodeServices.layer)),
  )
  throw new Error("Expected a same-core prerelease SpaceTimeDB CLI to fail")
} catch (error) {
  if (!(error instanceof CodegenCliVersionError) || error.actual !== undefined) {
    throw error
  }
}
await writeFile("artifact/stale.js", "stale\\n")
const staleManifest = await expectDrift("artifact manifest")
if (!staleManifest.unexpectedFiles.includes("stale.js")) {
  throw new Error("Manifest drift did not name stale.js")
}
await Effect.runPromise(generateArtifact(target).pipe(Effect.provide(NodeServices.layer)))
if (existsSync("artifact/stale.js")) {
  throw new Error("generateArtifact did not clean a stale artifact file")
}
await rm("artifact/index.d.ts")
const missingManifest = await expectDrift("index.d.ts")
if (!missingManifest.missingFiles.includes("index.d.ts")) {
  throw new Error("Manifest drift did not name the missing index.d.ts")
}
await mkdir("unrelated", { recursive: true })
await writeFile("unrelated/keep.txt", "do not delete\\n")
try {
  await Effect.runPromise(
    generateArtifact({ ...target, artifactDir: "unrelated" }).pipe(
      Effect.provide(NodeServices.layer),
    ),
  )
  throw new Error("Expected a non-artifact output directory to be rejected")
} catch (error) {
  if (!(error instanceof CodegenArtifactDirectoryError)) {
    throw error
  }
}
if (!existsSync("unrelated/keep.txt")) {
  throw new Error("Codegen deleted a non-artifact output directory")
}
`,
  )

  runCommand(process.execPath, ["check.mjs"], {
    cwd: consumerDir,
    env: smokeEnvironment,
  })
  process.stdout.write(
    `Packed codegen smoke passed under ${process.version} with isolated documented dependencies.\n`,
  )
} finally {
  rmSync(smokeRoot, { force: true, recursive: true })
}
