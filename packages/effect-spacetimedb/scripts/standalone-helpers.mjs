import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const requiredSpacetimeCliVersion = "2.6.1"

const configuredPackageRoot =
  process.env.EFFECT_SPACETIMEDB_PACKAGE_ROOT?.trim()

export const packageRoot = resolve(
  configuredPackageRoot && configuredPackageRoot.length > 0
    ? configuredPackageRoot
    : fileURLToPath(new URL("..", import.meta.url)),
)

export const exampleModuleRoot = join(
  packageRoot,
  "examples",
  "publishable-module",
)
export const exampleBundlePath = join(exampleModuleRoot, "dist", "bundle.js")
export const exampleGeneratedClientDir = join(
  exampleModuleRoot,
  "generated-client",
)

export const exampleModuleProject = {
  moduleRoot: exampleModuleRoot,
  bundlePath: exampleBundlePath,
  databaseNamePrefix: "effect-spacetimedb-example",
}

export const migrationFixtureRoot = join(
  packageRoot,
  "examples",
  "migration-fixture",
)
const migrationGeneratedRoot = join(
  packageRoot,
  "node_modules",
  ".cache",
  "effect-spacetimedb-migration-generated",
)

const migrationModuleProject = (version) => {
  const moduleRoot = join(migrationFixtureRoot, version)
  return {
    moduleRoot,
    bundlePath: join(moduleRoot, "dist", "bundle.js"),
    databaseNamePrefix: "effect-spacetimedb-migration",
    generatedClientDir: join(migrationGeneratedRoot, version),
    version,
  }
}

export const migrationModuleProjects = Object.freeze({
  v1: migrationModuleProject("v1"),
  v2: migrationModuleProject("v2"),
  v3: migrationModuleProject("v3"),
})

let resolvedSpacetimeCliCommand

export class StandaloneCommandError extends Error {
  constructor({ command, exitCode, stdout, stderr, cause }) {
    super(`${command} failed with exit code ${String(exitCode)}`)
    this.name = "StandaloneCommandError"
    this.command = command
    this.exitCode = exitCode
    this.stdout = stdout
    this.stderr = stderr
    this.cause = cause
  }
}

export class StandalonePackageDependencyError extends Error {
  constructor(message) {
    super(message)
    this.name = "StandalonePackageDependencyError"
  }
}

export const parseSpacetimeCliVersion = (output) =>
  output.match(/spacetimedb tool version (\d+\.\d+\.\d+)(?=[;\s]|$)/)?.[1] ??
  output.match(/^spacetimedb(?:-standalone)?\s+(\d+\.\d+\.\d+)(?:\s|$)/mu)?.[1]

export const runCommand = (command, args = [], options = {}) => {
  const rendered = [command, ...args].join(" ")
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  if (result.error !== undefined) {
    throw new StandaloneCommandError({
      command: rendered,
      exitCode: -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? String(result.error),
      cause: result.error,
    })
  }

  if (result.status !== 0) {
    throw new StandaloneCommandError({
      command: rendered,
      exitCode: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    })
  }

  return result.stdout ?? ""
}

const spacetimeVersionOutput = (binary) => {
  const result = spawnSync(binary, ["--version"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  if (result.status !== 0) {
    return undefined
  }

  return result.stdout
}

const assertCompatibleSpacetimeCli = (binary, source) => {
  const output = spacetimeVersionOutput(binary)
  const version =
    output === undefined ? undefined : parseSpacetimeCliVersion(output)

  if (version === requiredSpacetimeCliVersion) {
    return
  }

  const found =
    output === undefined
      ? "not found"
      : (version ?? "version output was not recognized")
  throw new StandalonePackageDependencyError(
    [
      `SpaceTimeDB CLI ${source} must resolve to ${requiredSpacetimeCliVersion}.`,
      `Found: ${found}.`,
      `Install SpaceTimeDB ${requiredSpacetimeCliVersion} or set SPACETIME_CLI_BIN to a compatible binary.`,
    ].join(" "),
  )
}

export const resolveSpacetimeCliCommand = () => {
  if (resolvedSpacetimeCliCommand !== undefined) {
    return resolvedSpacetimeCliCommand
  }

  const configured = process.env.SPACETIME_CLI_BIN?.trim()
  const binary = configured && configured.length > 0 ? configured : "spacetime"
  assertCompatibleSpacetimeCli(
    binary,
    configured && configured.length > 0 ? "from SPACETIME_CLI_BIN" : "on PATH",
  )
  resolvedSpacetimeCliCommand = Object.freeze([binary])
  return resolvedSpacetimeCliCommand
}

const realPathIfExists = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

const nodeModulesHasLocalPackage = (nodeModules) =>
  existsSync(join(nodeModules, "effect-spacetimedb"))

const nodeModulesHasBuildDependencies = (nodeModules) =>
  existsSync(join(nodeModules, "effect")) &&
  existsSync(join(nodeModules, "spacetimedb"))

const directoryPackageName = (directory) => {
  const packageJsonPath = join(directory, "package.json")
  if (!existsSync(packageJsonPath)) {
    return undefined
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
    return typeof packageJson.name === "string" ? packageJson.name : undefined
  } catch {
    return undefined
  }
}

const ensurePackageNodeModulesSelfLink = (directory, nodeModules) => {
  if (
    directoryPackageName(directory) !== "effect-spacetimedb" ||
    !nodeModulesHasBuildDependencies(nodeModules)
  ) {
    return false
  }

  const selfLink = join(nodeModules, "effect-spacetimedb")
  if (nodeModulesHasLocalPackage(nodeModules)) {
    return true
  }

  symlinkSync(
    process.platform === "win32" ? directory : relative(nodeModules, directory),
    selfLink,
    process.platform === "win32" ? "junction" : "dir",
  )
  return true
}

export const resolveInstallRootNodeModules = (
  startDirectory,
  ignoredNodeModules,
) => {
  let current = resolve(startDirectory)

  for (;;) {
    const candidate = join(current, "node_modules")
    if (
      (ignoredNodeModules === undefined ||
        resolve(candidate) !== resolve(ignoredNodeModules)) &&
      (nodeModulesHasLocalPackage(candidate) ||
        ensurePackageNodeModulesSelfLink(current, candidate))
    ) {
      const candidateRealPath = realPathIfExists(candidate)
      if (candidateRealPath === undefined) {
        throw new StandalonePackageDependencyError(
          `Could not resolve realpath for ${candidate}.`,
        )
      }
      if (
        ignoredNodeModules !== undefined &&
        candidateRealPath === realPathIfExists(ignoredNodeModules)
      ) {
        throw new StandalonePackageDependencyError(
          `Refusing to use module-local node_modules as its own install root: ${candidate}.`,
        )
      }
      return candidate
    }

    const parent = dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  throw new StandalonePackageDependencyError(
    [
      `Could not find an install-root node_modules containing effect-spacetimedb above ${startDirectory}.`,
      "Run bun install from the package root or repository root.",
    ].join(" "),
  )
}

export const ensureModuleCanResolveInstallRoot = (moduleRoot) => {
  const resolvedModuleRoot = resolve(moduleRoot)
  const moduleNodeModules = join(resolvedModuleRoot, "node_modules")

  rmSync(moduleNodeModules, { force: true, recursive: true })

  const installRootNodeModules = resolveInstallRootNodeModules(
    resolvedModuleRoot,
    moduleNodeModules,
  )
  const installRootRealPath = realpathSync(installRootNodeModules)

  mkdirSync(dirname(moduleNodeModules), { recursive: true })
  symlinkSync(
    process.platform === "win32"
      ? installRootNodeModules
      : relative(resolvedModuleRoot, installRootNodeModules),
    moduleNodeModules,
    process.platform === "win32" ? "junction" : "dir",
  )

  const moduleRealPath = realpathSync(moduleNodeModules)
  if (moduleRealPath !== installRootRealPath) {
    throw new StandalonePackageDependencyError(
      `Module node_modules symlink points at ${moduleRealPath}, expected ${installRootRealPath}.`,
    )
  }

  return installRootNodeModules
}

export const buildModuleWithSpacetime = (project = exampleModuleProject) => {
  const [spacetime, ...prefixArgs] = resolveSpacetimeCliCommand()
  if (spacetime === undefined) {
    throw new StandalonePackageDependencyError(
      "Resolved SpaceTimeDB CLI command was empty.",
    )
  }

  ensureModuleCanResolveInstallRoot(project.moduleRoot)
  mkdirSync(dirname(project.bundlePath), { recursive: true })
  runCommand(spacetime, [
    ...prefixArgs,
    "build",
    "--module-path",
    project.moduleRoot,
  ])
}

export const generateModuleClientWithSpacetime = (project) => {
  const [spacetime, ...prefixArgs] = resolveSpacetimeCliCommand()
  if (spacetime === undefined) {
    throw new StandalonePackageDependencyError(
      "Resolved SpaceTimeDB CLI command was empty.",
    )
  }
  if (project.generatedClientDir === undefined) {
    throw new StandalonePackageDependencyError(
      `Project ${project.moduleRoot} does not declare generatedClientDir.`,
    )
  }

  rmSync(project.generatedClientDir, { force: true, recursive: true })
  mkdirSync(project.generatedClientDir, { recursive: true })
  runCommand(spacetime, [
    ...prefixArgs,
    "generate",
    "--lang",
    "typescript",
    "--js-path",
    project.bundlePath,
    "--out-dir",
    project.generatedClientDir,
    "--yes",
  ])
}
