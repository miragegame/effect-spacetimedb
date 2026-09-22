import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import * as GetExePath from "@effect/tsgo/lib/getExePath"
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import { testEffectCallbackError } from "../helpers/effect-errors"

const { expect, it } = EffectVitest
const describe = EffectVitest.describe

const srcDir = fileURLToPath(new URL("../../src/", import.meta.url))
const packageRoot = Path.dirname(srcDir)
const serverDir = Path.join(srcDir, "server")
const clientDir = Path.join(srcDir, "client")
const contractDir = Path.join(srcDir, "contract")
const rootEntrypoint = Path.join(srcDir, "index.ts")
const serverEntrypoint = Path.join(serverDir, "index.ts")
const serverCompilerEntrypoint = Path.join(srcDir, "server-compiler.ts")
const testingEntrypoint = Path.join(srcDir, "testing.ts")
const declarationEmitTimeoutMs = 60_000

const declarationSurfaceOutDir = Path.join(
  packageRoot,
  ".tmp",
  "root-declaration-surface",
)
const declarationSurfaceConfigPath = Path.join(
  packageRoot,
  ".tmp",
  "root-declaration-surface.tsconfig.json",
)

const rootSharedFiles = [
  "builder.ts",
  "callable-protocol.ts",
  "decode-error.ts",
  "error-identity.ts",
  "http-primitives.ts",
  "http-wire-codec.ts",
  "module-plan.ts",
  "module-projection.ts",
  "schema-parse.ts",
  "schema-transform.ts",
  "server-compiler.ts",
  "server-polyfills.ts",
  "subscription-target.ts",
  "utils.ts",
].map((file) => Path.join(srcDir, file))

const collectFilesWithExtension = (
  dir: string,
  extension: string,
): ReadonlyArray<string> =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => Path.join(entry.parentPath, entry.name))
    .sort()

const collectTsFiles = (dir: string): ReadonlyArray<string> =>
  collectFilesWithExtension(dir, ".ts")

const readFileString = (filePath: string): string => {
  if (!existsSync(filePath)) {
    throw new Error(`Unable to read ${relativePackagePath(filePath)}`)
  }
  return readFileSync(filePath, { encoding: "utf8" })
}

type HostOnlyValueImport = {
  readonly sourcePath: string
  readonly specifier: string
  readonly path: ReadonlyArray<string>
}

// `Bun.Transpiler` is why this file is `.serial.`: the parallel project is the
// coverage run and executes under plain Node (`vitest run --project parallel
// --coverage`), where `Bun` is undefined. The serial project runs under
// `bun --bun` and is already the documented home for tests outside the coverage
// run, which costs nothing here — this file asserts a source-graph contract and
// imports no `src/` module, so it contributes no coverage. Its 60s declaration
// emit also belongs in the non-parallel project rather than under the parallel
// project's 5s default timeout.
const tsScanner = new Bun.Transpiler({ loader: "ts" })
const tsxScanner = new Bun.Transpiler({ loader: "tsx" })

// Scanner-only import extraction: Bun's transpiler reports the value-level
// edges of a module and drops the type-only ones (`import type`, `export type`,
// and named lists whose every element is `type`), which is exactly the graph
// these boundaries are about — a type-only edge carries no runtime dependency.
const staticModuleSpecifiers = (
  filePath: string,
  sourceText: string,
): ReadonlyArray<string> => {
  const scanner = filePath.endsWith(".tsx") ? tsxScanner : tsScanner
  return scanner.scanImports(sourceText).map((record) => record.path)
}

const resolveRelativeSpecifier = (
  fromFile: string,
  specifier: string,
): string | undefined => {
  if (!specifier.startsWith(".")) {
    return undefined
  }

  const resolved = Path.resolve(Path.dirname(fromFile), specifier)
  return resolved.endsWith(".ts") ? resolved : `${resolved}.ts`
}

const relativePackagePath = (filePath: string): string =>
  Path.relative(Path.dirname(srcDir), filePath).split(Path.sep).join("/")

const isHostOnlyRuntimeSpecifier = (specifier: string): boolean =>
  specifier === "spacetimedb/server" || specifier.startsWith("spacetime:sys")

const formatHostOnlyValueImport = (violation: HostOnlyValueImport): string =>
  `${violation.path.map(relativePackagePath).join(" -> ")} -> ${violation.specifier}`

const stronglyConnectedComponents = (
  graph: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<ReadonlyArray<string>> => {
  let nextIndex = 0
  const stack: Array<string> = []
  const onStack = new Set<string>()
  const indexes = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const components: Array<ReadonlyArray<string>> = []

  const strongConnect = (node: string): void => {
    indexes.set(node, nextIndex)
    lowlinks.set(node, nextIndex)
    nextIndex += 1
    stack.push(node)
    onStack.add(node)

    for (const neighbor of graph.get(node) ?? []) {
      if (!indexes.has(neighbor)) {
        strongConnect(neighbor)
        lowlinks.set(
          node,
          Math.min(
            lowlinks.get(node) ?? 0,
            lowlinks.get(neighbor) ?? Number.POSITIVE_INFINITY,
          ),
        )
      } else if (onStack.has(neighbor)) {
        lowlinks.set(
          node,
          Math.min(lowlinks.get(node) ?? 0, indexes.get(neighbor) ?? 0),
        )
      }
    }

    if (lowlinks.get(node) !== indexes.get(node)) {
      return
    }

    const component: Array<string> = []
    let member: string | undefined
    do {
      member = stack.pop()
      if (member === undefined) {
        throw new Error("Import graph stack underflow")
      }
      onStack.delete(member)
      component.push(member)
    } while (member !== node)
    components.push(component.sort())
  }

  for (const node of graph.keys()) {
    if (!indexes.has(node)) {
      strongConnect(node)
    }
  }

  return components
}

const clientImportViolations = (
  sourcePath: string,
  sourceText: string,
): ReadonlyArray<string> =>
  staticModuleSpecifiers(sourcePath, sourceText).flatMap((specifier) => {
    const resolved = resolveRelativeSpecifier(sourcePath, specifier)
    return resolved !== undefined &&
      (resolved === clientDir || resolved.startsWith(`${clientDir}${Path.sep}`))
      ? [
          `${relativePackagePath(sourcePath)} -> ${relativePackagePath(resolved)}`,
        ]
      : []
  })

const serverImportViolations = (
  sourcePath: string,
  sourceText: string,
): ReadonlyArray<string> =>
  staticModuleSpecifiers(sourcePath, sourceText).flatMap((specifier) => {
    const resolved = resolveRelativeSpecifier(sourcePath, specifier)
    return resolved !== undefined &&
      (resolved === serverDir || resolved.startsWith(`${serverDir}${Path.sep}`))
      ? [
          `${relativePackagePath(sourcePath)} -> ${relativePackagePath(resolved)}`,
        ]
      : []
  })

const contractValueImportCycles = (): ReadonlyArray<ReadonlyArray<string>> => {
  const files = collectTsFiles(contractDir)
  const fileSet = new Set(files)
  const graph = new Map<string, Array<string>>(
    files.map((file) => [file, []] as const),
  )

  for (const sourcePath of files) {
    for (const specifier of staticModuleSpecifiers(
      sourcePath,
      readFileString(sourcePath),
    )) {
      const resolved = resolveRelativeSpecifier(sourcePath, specifier)
      if (resolved !== undefined && fileSet.has(resolved)) {
        graph.get(sourcePath)?.push(resolved)
      }
    }
  }

  return stronglyConnectedComponents(graph)
    .filter((component) => component.length > 1)
    .map((component) => component.map(relativePackagePath))
}

const hostOnlyValueImportsReachableFrom = (
  entrypoint: string,
): ReadonlyArray<HostOnlyValueImport> => {
  const files = collectTsFiles(srcDir)
  const fileSet = new Set(files)
  const visited = new Set<string>()
  const pending: Array<{
    readonly filePath: string
    readonly path: ReadonlyArray<string>
  }> = [{ filePath: entrypoint, path: [entrypoint] }]
  const violations: Array<HostOnlyValueImport> = []

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current.filePath)) {
      continue
    }
    visited.add(current.filePath)

    for (const specifier of staticModuleSpecifiers(
      current.filePath,
      readFileString(current.filePath),
    )) {
      if (isHostOnlyRuntimeSpecifier(specifier)) {
        violations.push({
          sourcePath: current.filePath,
          specifier,
          path: current.path,
        })
        continue
      }

      const resolved = resolveRelativeSpecifier(current.filePath, specifier)
      if (resolved !== undefined && fileSet.has(resolved)) {
        pending.push({
          filePath: resolved,
          path: [...current.path, resolved],
        })
      }
    }
  }

  return violations.sort((left, right) =>
    formatHostOnlyValueImport(left).localeCompare(
      formatHostOnlyValueImport(right),
    ),
  )
}

const toConfigPath = (filePath: string): string =>
  filePath.split(Path.sep).join("/")

const configRelativePath = (fromFile: string, targetFile: string): string => {
  const relative = toConfigPath(
    Path.relative(Path.dirname(fromFile), targetFile),
  )
  return relative.startsWith(".") ? relative : `./${relative}`
}

// The declaration surface is emitted by the native compiler: TypeScript 7 has no
// in-process `program.emit()`, so the config below pins the same option deltas
// the in-process emit used to apply (declaration-only, no composite/incremental
// bookkeeping, rooted at src/, seeded with the root entrypoint alone) and the
// compiler writes the outputs into a temp directory the test then reads back.
const writeDeclarationEmitConfig = (): void => {
  mkdirSync(Path.dirname(declarationSurfaceConfigPath), { recursive: true })
  rmSync(declarationSurfaceOutDir, { force: true, recursive: true })
  const config = {
    compilerOptions: {
      composite: false,
      declaration: true,
      declarationDir: toConfigPath(declarationSurfaceOutDir),
      declarationMap: false,
      emitDeclarationOnly: true,
      incremental: false,
      noEmit: false,
      outDir: toConfigPath(declarationSurfaceOutDir),
      rootDir: toConfigPath(srcDir),
      // Kept out of the package's own dist-types bookkeeping; the inherited
      // build-info path would otherwise be rewritten by this throwaway emit.
      tsBuildInfoFile: toConfigPath(
        Path.join(
          declarationSurfaceOutDir,
          "root-declaration-surface.tsbuildinfo",
        ),
      ),
    },
    extends: configRelativePath(
      declarationSurfaceConfigPath,
      Path.join(packageRoot, "tsconfig.build.json"),
    ),
    files: [toConfigPath(rootEntrypoint)],
    include: [],
  }
  writeFileSync(
    declarationSurfaceConfigPath,
    `${JSON.stringify(config, null, 2)}\n`,
    { encoding: "utf8" },
  )
}

// Same two steps the package's `scripts/effect-tsgo.mjs` wrapper performs:
// resolve the native compiler shipped with @effect/tsgo, then run it. The
// declaration probe keeps a best-effort chmod because the pool's executable is
// already runnable; the wrapper additionally copies non-executable read-only
// binaries into package scratch before launch.
const runDeclarationEmit = (): void => {
  const compilerExecutable = GetExePath.default()
  try {
    chmodSync(compilerExecutable, 0o755)
  } catch {
    // Best effort: the package manager usually installs the binary executable.
  }
  const emit = spawnSync(
    compilerExecutable,
    ["-p", declarationSurfaceConfigPath],
    { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
  if (emit.status !== 0) {
    throw new Error(
      [emit.stdout, emit.stderr]
        .filter((output) => output.length > 0)
        .join("\n"),
    )
  }
}

const emitRootDeclarationSurfaceText = (): string => {
  writeDeclarationEmitConfig()
  runDeclarationEmit()

  const rootDeclarationPath = Path.normalize(
    Path.join(declarationSurfaceOutDir, "index.d.ts"),
  )
  if (!existsSync(rootDeclarationPath)) {
    throw new Error(
      `Root declaration output missing: ${relativePackagePath(rootDeclarationPath)}`,
    )
  }

  return collectFilesWithExtension(declarationSurfaceOutDir, ".d.ts")
    .map((fileName) => Path.normalize(fileName))
    .sort((left, right) => left.localeCompare(right))
    .map(
      (fileName) =>
        `// ${relativePackagePath(fileName)}\n${readFileString(fileName)}`,
    )
    .join("\n")
}

describe("import graph boundaries", () => {
  it.effect(
    "keeps server and root shared modules independent from client modules",
    () =>
      Effect.gen(function* () {
        const sources = [...collectTsFiles(serverDir), ...rootSharedFiles]
        const violations = sources.flatMap((sourcePath) =>
          clientImportViolations(sourcePath, readFileString(sourcePath)),
        )

        expect(violations).toEqual([])
      }),
    { timeout: 20_000 },
  )

  it.effect(
    "keeps client and contract modules independent from server modules",
    () =>
      Effect.gen(function* () {
        const sources = [
          ...collectTsFiles(clientDir),
          ...collectTsFiles(contractDir),
        ]
        const violations = sources.flatMap((sourcePath) =>
          serverImportViolations(sourcePath, readFileString(sourcePath)),
        )

        expect(violations).toEqual([])
      }),
    { timeout: 20_000 },
  )

  it.effect(
    "keeps contract modules free of value-level import cycles",
    () =>
      Effect.gen(function* () {
        const cycles = contractValueImportCycles()
        expect(cycles).toEqual([])
      }),
    { timeout: 20_000 },
  )

  it.effect(
    "keeps public runtime entrypoints off host-only SpaceTimeDB imports",
    () =>
      Effect.gen(function* () {
        const violations = [
          ...hostOnlyValueImportsReachableFrom(serverEntrypoint),
          ...hostOnlyValueImportsReachableFrom(testingEntrypoint),
        ].map(formatHostOnlyValueImport)

        expect(violations).toEqual([])
      }),
    { timeout: 20_000 },
  )

  it.effect(
    "keeps the public root declaration surface off host-only SpaceTimeDB types",
    () =>
      Effect.try({
        try: () => {
          const rootDeclarationSurface = emitRootDeclarationSurfaceText()
          expect(rootDeclarationSurface).not.toContain("spacetimedb/server")
        },
        catch: testEffectCallbackError("effect-spacetimedb/root-dts-surface"),
      }),
    { timeout: declarationEmitTimeoutMs },
  )

  it.effect(
    "confines host-only SpaceTimeDB imports to the compiler ABI boundary",
    () =>
      Effect.gen(function* () {
        const violations = hostOnlyValueImportsReachableFrom(
          serverCompilerEntrypoint,
        ).map(
          (violation) =>
            `${relativePackagePath(violation.sourcePath)} -> ${violation.specifier}`,
        )

        expect(violations).toEqual([
          "src/server/host-abi-compiler.ts -> spacetimedb/server",
        ])
      }),
    { timeout: 20_000 },
  )
})
