import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Ts from "typescript"
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

const collectTsFiles = (dir: string): ReadonlyArray<string> =>
  Ts.sys.readDirectory(dir, [".ts"], undefined, undefined).sort()

const readFileString = (filePath: string): string => {
  const sourceText = Ts.sys.readFile(filePath)
  if (sourceText === undefined) {
    throw new Error(`Unable to read ${relativePackagePath(filePath)}`)
  }
  return sourceText
}

const staticModuleSpecifiers = (
  filePath: string,
  sourceText: string,
): ReadonlyArray<string> =>
  staticModuleEdges(filePath, sourceText).map((edge) => edge.specifier)

type StaticModuleEdge = {
  readonly specifier: string
  readonly kind: "type" | "value"
}

type HostOnlyValueImport = {
  readonly sourcePath: string
  readonly specifier: string
  readonly path: ReadonlyArray<string>
}

const importDeclarationKind = (
  declaration: Ts.ImportDeclaration,
): StaticModuleEdge["kind"] => {
  const clause = declaration.importClause
  if (clause == null) {
    return "value"
  }
  if (clause.isTypeOnly) {
    return "type"
  }
  if (clause.name != null) {
    return "value"
  }
  const bindings = clause.namedBindings
  return bindings != null &&
    Ts.isNamedImports(bindings) &&
    bindings.elements.every((element) => element.isTypeOnly)
    ? "type"
    : "value"
}

const exportDeclarationKind = (
  declaration: Ts.ExportDeclaration,
): StaticModuleEdge["kind"] => {
  if (declaration.isTypeOnly) {
    return "type"
  }
  const clause = declaration.exportClause
  return clause != null &&
    Ts.isNamedExports(clause) &&
    clause.elements.every((element) => element.isTypeOnly)
    ? "type"
    : "value"
}

const staticModuleEdges = (
  filePath: string,
  sourceText: string,
): ReadonlyArray<StaticModuleEdge> => {
  const source = Ts.createSourceFile(
    filePath,
    sourceText,
    Ts.ScriptTarget.Latest,
    true,
    Ts.ScriptKind.TS,
  )
  const edges: Array<StaticModuleEdge> = []

  const visit = (node: Ts.Node): void => {
    if (Ts.isImportDeclaration(node)) {
      if (Ts.isStringLiteral(node.moduleSpecifier)) {
        edges.push({
          specifier: node.moduleSpecifier.text,
          kind: importDeclarationKind(node),
        })
      }
    } else if (
      Ts.isExportDeclaration(node) &&
      node.moduleSpecifier != null &&
      Ts.isStringLiteral(node.moduleSpecifier)
    ) {
      edges.push({
        specifier: node.moduleSpecifier.text,
        kind: exportDeclarationKind(node),
      })
    } else if (
      Ts.isCallExpression(node) &&
      node.expression.kind === Ts.SyntaxKind.ImportKeyword
    ) {
      const firstArgument = node.arguments[0]
      if (firstArgument != null && Ts.isStringLiteral(firstArgument)) {
        edges.push({
          specifier: firstArgument.text,
          kind: "value",
        })
      }
    }

    Ts.forEachChild(node, visit)
  }

  visit(source)
  return edges
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
    for (const edge of staticModuleEdges(
      sourcePath,
      readFileString(sourcePath),
    )) {
      if (edge.kind === "type") {
        continue
      }
      const resolved = resolveRelativeSpecifier(sourcePath, edge.specifier)
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

    for (const edge of staticModuleEdges(
      current.filePath,
      readFileString(current.filePath),
    )) {
      if (edge.kind === "type") {
        continue
      }

      if (isHostOnlyRuntimeSpecifier(edge.specifier)) {
        violations.push({
          sourcePath: current.filePath,
          specifier: edge.specifier,
          path: current.path,
        })
        continue
      }

      const resolved = resolveRelativeSpecifier(
        current.filePath,
        edge.specifier,
      )
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

const emitRootDeclarationSurfaceText = (): string => {
  const configPath = Path.join(packageRoot, "tsconfig.build.json")
  const configFile = Ts.readConfigFile(configPath, Ts.sys.readFile)
  if (configFile.error != null) {
    throw new Error(
      Ts.formatDiagnostic(configFile.error, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => packageRoot,
        getNewLine: () => "\n",
      }),
    )
  }

  const parsed = Ts.parseJsonConfigFileContent(
    configFile.config,
    Ts.sys,
    packageRoot,
  )
  const outDir = Path.join(
    packageRoot,
    "node_modules",
    ".tmp",
    "root-declaration-surface",
  )
  const {
    declarationDir: _declarationDir,
    tsBuildInfoFile: _tsBuildInfoFile,
    ...baseOptions
  } = parsed.options
  void _declarationDir
  void _tsBuildInfoFile
  const options: Ts.CompilerOptions = {
    ...baseOptions,
    composite: false,
    declaration: true,
    declarationDir: outDir,
    declarationMap: false,
    emitDeclarationOnly: true,
    incremental: false,
    noEmit: false,
    outDir,
    rootDir: srcDir,
  }
  const host = Ts.createCompilerHost(options)
  const outputs = new Map<string, string>()
  host.writeFile = (fileName, text) => {
    outputs.set(Path.normalize(fileName), text)
  }

  const program = Ts.createProgram([rootEntrypoint], options, host)
  const emit = program.emit(undefined, undefined, undefined, true)
  const diagnostics = [
    ...Ts.getPreEmitDiagnostics(program),
    ...emit.diagnostics,
  ].filter((diagnostic) => diagnostic.category === Ts.DiagnosticCategory.Error)

  if (diagnostics.length > 0) {
    throw new Error(
      Ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => packageRoot,
        getNewLine: () => "\n",
      }),
    )
  }

  const rootDeclarationPath = Path.normalize(Path.join(outDir, "index.d.ts"))
  if (!outputs.has(rootDeclarationPath)) {
    throw new Error(
      `Root declaration output missing: ${relativePackagePath(rootDeclarationPath)}`,
    )
  }

  return [...outputs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, text]) => `// ${relativePackagePath(fileName)}\n${text}`)
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
    { timeout: 20_000 },
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
