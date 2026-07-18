import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageJsonPath = join(packageRoot, "package.json")
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))

const sourceExports = packageJson.exports ?? {}
const builtExports =
  packageJson.publishConfig?.exports ?? packageJson.exports ?? {}

const exportKeys = (exportsMap) =>
  Object.keys(exportsMap)
    .filter((key) => key !== "./package.json")
    .sort()

const devOnlyExports = exportKeys(sourceExports).filter(
  (key) => !(key in builtExports),
)

const defaultTarget = (entry) => {
  if (typeof entry === "string") {
    return entry
  }
  if (entry && typeof entry === "object" && typeof entry.default === "string") {
    return entry.default
  }
  return undefined
}

const builtEntrypoints = Object.entries(builtExports)
  .flatMap(([subpath, entry]) => {
    if (subpath === "./package.json") {
      return []
    }
    const target = defaultTarget(entry)
    if (target === undefined) {
      throw new Error(`Export ${subpath} is missing a default target.`)
    }
    return [{ subpath, filePath: resolve(packageRoot, target) }]
  })
  .sort((left, right) => left.subpath.localeCompare(right.subpath))

const sourceText = (filePath) => readFileSync(filePath, "utf8")

const importSpecifiers = (filePath) => {
  const text = sourceText(filePath)
  const specifiers = new Set()
  const patterns = [
    /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier !== undefined) {
        specifiers.add(specifier)
      }
    }
  }

  return [...specifiers]
}

const hostAbiSpecifiers = (specifier) =>
  specifier === "spacetimedb/server" || specifier.startsWith("spacetime:sys")

const resolveRelativeImport = (fromFile, specifier) => {
  if (!specifier.startsWith(".")) {
    return undefined
  }

  const base = resolve(dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.js`, join(base, "index.js")]) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

const hostReachabilityMemo = new Map()

const reachesHostAbi = (filePath, active = new Set()) => {
  const memoized = hostReachabilityMemo.get(filePath)
  if (memoized !== undefined) {
    return memoized
  }
  if (active.has(filePath)) {
    return false
  }
  active.add(filePath)

  let reachesHost = false
  for (const specifier of importSpecifiers(filePath)) {
    if (hostAbiSpecifiers(specifier)) {
      reachesHost = true
      break
    }
    const resolved = resolveRelativeImport(filePath, specifier)
    if (resolved !== undefined && reachesHostAbi(resolved, active)) {
      reachesHost = true
      break
    }
  }

  active.delete(filePath)
  hostReachabilityMemo.set(filePath, reachesHost)
  return reachesHost
}

const hostCoupled = builtEntrypoints.filter(({ filePath }) =>
  reachesHostAbi(filePath),
)
const importable = builtEntrypoints.filter(
  ({ filePath }) => !reachesHostAbi(filePath),
)

const failures = []
for (const entrypoint of importable) {
  try {
    await import(pathToFileURL(entrypoint.filePath).href)
  } catch (error) {
    failures.push({ ...entrypoint, error })
  }
}

if (devOnlyExports.length > 0) {
  console.log(
    `Built-package ESM smoke omits dev-only source exports: ${devOnlyExports.join(", ")}`,
  )
}

console.log(
  `Built-package ESM smoke imported ${importable.length} entrypoints; skipped ${hostCoupled.length} host-coupled entrypoints.`,
)

if (hostCoupled.length > 0) {
  console.log(
    `Host-coupled entrypoints: ${hostCoupled.map(({ subpath }) => subpath).join(", ")}`,
  )
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(
      `Failed to import ${failure.subpath} (${failure.filePath}):`,
      failure.error,
    )
  }
  process.exitCode = 1
}
