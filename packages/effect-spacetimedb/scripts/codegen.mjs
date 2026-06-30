import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import {
  buildModuleWithSpacetime,
  exampleBundlePath,
  exampleGeneratedClientDir,
  exampleModuleProject,
  packageRoot,
  resolveInstallRootNodeModules,
  resolveSpacetimeCliCommand,
  runCommand,
  StandaloneCommandError,
} from "./standalone-helpers.mjs"

const check = process.argv.includes("--check")
const unexpectedArgs = process.argv.slice(2).filter((arg) => arg !== "--check")

if (unexpectedArgs.length > 0) {
  console.error(`Unknown argument: ${unexpectedArgs.join(" ")}`)
  process.exit(1)
}

const tsNoCheckHeader = "// @ts-nocheck\n"
const generatedCliCommitHeaderPattern =
  /^\/\/ This was generated using spacetimedb cli version ([^)]+) \(commit [^)]+\)\.$/mu

const biomeBinaryName = process.platform === "win32" ? "biome.cmd" : "biome"
const packageBiomeBinaryPath = path.join(
  packageRoot,
  "node_modules",
  ".bin",
  biomeBinaryName,
)
const packageBiomeConfigPath = path.join(packageRoot, "biome.json")

const resolveBiomeBinaryPath = () => {
  if (existsSync(packageBiomeBinaryPath)) {
    return packageBiomeBinaryPath
  }

  const installRootBiomeBinaryPath = path.join(
    resolveInstallRootNodeModules(packageRoot),
    ".bin",
    biomeBinaryName,
  )
  if (existsSync(installRootBiomeBinaryPath)) {
    return installRootBiomeBinaryPath
  }

  throw new Error(
    `Biome binary not found at ${packageBiomeBinaryPath} or ${installRootBiomeBinaryPath}. Run bun install from the package root or mirror root.`,
  )
}

const readText = (filePath) => readFileSync(filePath, "utf8")

const writeTextIfChanged = (filePath, text) => {
  if (readText(filePath) !== text) {
    writeFileSync(filePath, text)
  }
}

const ensureGeneratedIndexTsNoCheck = (generatedPath) => {
  const source = readText(generatedPath)
  if (!source.startsWith(tsNoCheckHeader)) {
    writeFileSync(generatedPath, `${tsNoCheckHeader}${source}`)
  }
}

const normalizeGeneratedIndexMetadata = (generatedPath) => {
  const source = readText(generatedPath)
  writeTextIfChanged(
    generatedPath,
    source.replace(
      generatedCliCommitHeaderPattern,
      "// This was generated using spacetimedb cli version $1.",
    ),
  )
}

const normalizeGeneratedIndexPortableDeclarations = (generatedPath) => {
  const source = readText(generatedPath)
  writeTextIfChanged(
    generatedPath,
    source
      .replace(
        "const tablesSchema = __schema(",
        "const tablesSchema: any = __schema(",
      )
      .replace("const REMOTE_MODULE = {", "const REMOTE_MODULE: any = {")
      .replace(
        "export const reducers = __convertToAccessorMap(",
        "export const reducers: any = __convertToAccessorMap(",
      )
      .replace(
        "export const procedures = __convertToAccessorMap(",
        "export const procedures: any = __convertToAccessorMap(",
      ),
  )
}

const normalizeGeneratedTypescriptFile = (filePath) => {
  const source = readText(filePath)
  writeTextIfChanged(filePath, `${source.replace(/\n*$/u, "")}\n`)
}

const collectTypescriptFilesWithin = (directory, visitedDirectories) => {
  const realDirectory = realpathSync(directory)
  if (visitedDirectories.has(realDirectory)) {
    return []
  }
  visitedDirectories.add(realDirectory)

  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return collectTypescriptFilesWithin(entryPath, visitedDirectories)
      }
      if (entry.isFile() && entryPath.endsWith(".ts")) {
        return [entryPath]
      }
      return []
    })
}

const collectTypescriptFiles = (directory) =>
  collectTypescriptFilesWithin(directory, new Set())

const chunkFilePaths = (filePaths) => {
  const chunkSize = 100
  const chunks = []
  for (let index = 0; index < filePaths.length; index += chunkSize) {
    chunks.push(filePaths.slice(index, index + chunkSize))
  }
  return chunks
}

const formatGeneratedTypescriptFiles = (filePaths) => {
  if (filePaths.length === 0) {
    return
  }
  const biomeBinaryPath = resolveBiomeBinaryPath()

  for (const chunk of chunkFilePaths(filePaths)) {
    runCommand(biomeBinaryPath, [
      "format",
      "--write",
      "--config-path",
      packageBiomeConfigPath,
      "--vcs-enabled=false",
      "--no-errors-on-unmatched",
      ...chunk,
    ])
  }
}

const normalizeGeneratedTypescriptFiles = (directory) => {
  const filePaths = collectTypescriptFiles(directory)
  for (const filePath of filePaths) {
    normalizeGeneratedTypescriptFile(filePath)
  }
  formatGeneratedTypescriptFiles(filePaths)
}

const generateNormalizedClient = (targetDir) => {
  const [spacetime, ...prefixArgs] = resolveSpacetimeCliCommand()
  if (spacetime === undefined) {
    throw new Error("Resolved SpaceTimeDB CLI command was empty.")
  }

  buildModuleWithSpacetime(exampleModuleProject)
  mkdirSync(targetDir, { recursive: true })
  runCommand(spacetime, [
    ...prefixArgs,
    "generate",
    "--lang",
    "typescript",
    "--js-path",
    exampleBundlePath,
    "--out-dir",
    targetDir,
    "--yes",
  ])

  const generatedIndexPath = path.join(targetDir, "index.ts")
  ensureGeneratedIndexTsNoCheck(generatedIndexPath)
  normalizeGeneratedIndexMetadata(generatedIndexPath)
  normalizeGeneratedIndexPortableDeclarations(generatedIndexPath)
  normalizeGeneratedTypescriptFiles(targetDir)
  return generatedIndexPath
}

const withTemporaryDirectory = (prefix, useDirectory) => {
  const tempRoot = path.join(
    packageRoot,
    "node_modules",
    ".tmp",
    "effect-spacetimedb-codegen",
  )
  mkdirSync(tempRoot, { recursive: true })
  const directory = mkdtempSync(path.join(tempRoot, prefix))
  try {
    return useDirectory(directory)
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}

const copyStagedClient = (stagedDir, stagedIndexPath, targetDir) => {
  const relativeIndexPath = path.relative(stagedDir, stagedIndexPath)
  rmSync(targetDir, { force: true, recursive: true })
  mkdirSync(path.dirname(targetDir), { recursive: true })
  cpSync(stagedDir, targetDir, {
    dereference: false,
    errorOnExist: false,
    force: true,
    recursive: true,
  })
  return path.join(targetDir, relativeIndexPath)
}

const toDisplayPath = (filePath) => filePath.split(path.sep).join("/")

const isCaseInsensitiveDirectory = (directory) => {
  const probe = path.join(
    directory,
    `.effect-spacetimedb-case-probe-${process.pid.toString()}-a`,
  )
  const upperProbe = probe.toUpperCase()
  try {
    writeFileSync(probe, "")
    return existsSync(upperProbe)
  } finally {
    rmSync(probe, { force: true })
  }
}

const collectDirectoryEntries = (root, caseInsensitive) => {
  const entries = new Map()

  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const entryPath = path.join(directory, entry.name)
      const relativePath = toDisplayPath(path.relative(root, entryPath))
      const key = caseInsensitive ? relativePath.toLowerCase() : relativePath

      if (entry.isDirectory()) {
        entries.set(key, {
          path: entryPath,
          relativePath,
          type: "directory",
        })
        visit(entryPath)
        continue
      }

      if (entry.isFile()) {
        entries.set(key, {
          path: entryPath,
          relativePath,
          type: "file",
        })
        continue
      }

      const stat = lstatSync(entryPath)
      entries.set(key, {
        path: entryPath,
        relativePath,
        type: stat.isSymbolicLink() ? "symlink" : "other",
      })
    }
  }

  visit(root)
  return entries
}

const compareGeneratedClientDirs = (committedDir, regeneratedDir) => {
  const caseInsensitive =
    isCaseInsensitiveDirectory(committedDir) ||
    isCaseInsensitiveDirectory(regeneratedDir)
  const committedEntries = collectDirectoryEntries(
    committedDir,
    caseInsensitive,
  )
  const regeneratedEntries = collectDirectoryEntries(
    regeneratedDir,
    caseInsensitive,
  )
  const drift = []
  const keys = [
    ...new Set([...committedEntries.keys(), ...regeneratedEntries.keys()]),
  ].sort()

  for (const key of keys) {
    const committed = committedEntries.get(key)
    const regenerated = regeneratedEntries.get(key)
    if (committed === undefined && regenerated !== undefined) {
      drift.push(
        `Only in regenerated generated client: ${regenerated.relativePath}`,
      )
      continue
    }
    if (regenerated === undefined && committed !== undefined) {
      drift.push(
        `Only in committed generated client: ${committed.relativePath}`,
      )
      continue
    }
    if (committed === undefined || regenerated === undefined) {
      continue
    }
    if (committed.type !== regenerated.type) {
      drift.push(
        `Type differs for ${committed.relativePath}: committed ${committed.type}, regenerated ${regenerated.type}`,
      )
      continue
    }
    if (committed.type !== "file") {
      continue
    }
    const committedBytes = readFileSync(committed.path)
    const regeneratedBytes = readFileSync(regenerated.path)
    if (!committedBytes.equals(regeneratedBytes)) {
      drift.push(`Files differ: ${committed.relativePath}`)
    }
  }

  return drift
}

const formatGeneratedDriftSummary = (drift) => {
  const visible = drift.slice(0, 40)
  const suffix =
    drift.length > visible.length
      ? `\n... ${String(drift.length - visible.length)} more drift entries`
      : ""

  return (
    [
      "Generated SpacetimeDB client drift detected.",
      "Run `bun run codegen` from packages/effect-spacetimedb and commit the generated output.",
      ...visible,
    ].join("\n") + suffix
  )
}

const regenerateGeneratedClient = () =>
  withTemporaryDirectory("effect-spacetimedb-codegen-", (stagedDir) =>
    copyStagedClient(
      stagedDir,
      generateNormalizedClient(stagedDir),
      exampleGeneratedClientDir,
    ),
  )

const checkGeneratedClient = () =>
  withTemporaryDirectory("effect-spacetimedb-codegen-check-", (checkDir) => {
    generateNormalizedClient(checkDir)
    const drift = compareGeneratedClientDirs(
      exampleGeneratedClientDir,
      checkDir,
    )
    if (drift.length === 0) {
      console.log(`Generated client in sync: ${exampleGeneratedClientDir}`)
      return
    }

    console.error(formatGeneratedDriftSummary(drift))
    process.exit(1)
  })

try {
  if (check) {
    checkGeneratedClient()
  } else {
    console.log(regenerateGeneratedClient())
  }
} catch (error) {
  if (error instanceof StandaloneCommandError) {
    if (error.stdout.trimEnd().length > 0) {
      console.log(error.stdout.trimEnd())
    }
    if (error.stderr.trimEnd().length > 0) {
      console.error(error.stderr.trimEnd())
    }
  }

  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exit(1)
}
