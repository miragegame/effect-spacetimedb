import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"
import { typescriptCompilerBin } from "./typescript-compiler"

const packageRoot = Path.resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
)
const docsRoot = Path.resolve(packageRoot, "../website/src/content/docs")
const readmePath = Path.join(packageRoot, "README.md")

/** Compile documentation samples with the quickstart project's settings. */
const samplesTsconfigBase = Path.resolve(
  packageRoot,
  "../../examples/quickstart/tsconfig.json",
)

export const worldPath = Path.join(
  packageRoot,
  "test",
  "fixtures",
  "doc-sample-world.ts",
)

/**
 * How a fence is checked, from its info string, which neither Starlight nor
 * GitHub renders.
 *
 * Unmarked, a fence is a module whose names later fences on its page may use.
 * `title="src/x.ts"` makes it that file, which later fences import by path.
 * `check=isolated` keeps its names to itself, for a fence that is its own
 * example. `check="skip: why"` excepts it from checking: the reason is
 * required, and the suite counts these.
 */
type FenceCheck =
  | {
      readonly kind: "module"
      readonly fileName: string | undefined
      readonly isolated: boolean
    }
  | { readonly kind: "excepted"; readonly reason: string }

export type DocFence = {
  readonly page: string
  readonly line: number
  readonly language: "ts" | "tsx"
  readonly check: FenceCheck
  readonly code: string
}

const checkedLanguages = new Map<string, DocFence["language"]>([
  ["ts", "ts"],
  ["typescript", "ts"],
  ["tsx", "tsx"],
])

const fenceOpening = /^(\s*)(`{3,})([^\s`]*)[ \t]*(.*)$/

const metaValue = (meta: string, key: string): string | undefined => {
  const quoted = new RegExp(`(?:^|\\s)${key}="([^"]*)"`).exec(meta)?.[1]
  return quoted ?? new RegExp(`(?:^|\\s)${key}=(\\S+)`).exec(meta)?.[1]
}

const fenceCheckOf = (meta: string): FenceCheck | string => {
  const check = metaValue(meta, "check")
  const fileName = metaValue(meta, "title")
  if (check === undefined || check === "isolated") {
    return {
      kind: "module",
      fileName,
      isolated: check === "isolated" || fileName !== undefined,
    }
  }
  const reason = /^skip:\s*(\S.*)$/.exec(check)?.[1]
  return reason === undefined
    ? `check="${check}" is not "skip: <reason>"`
    : { kind: "excepted", reason }
}

/** Every TypeScript fence of one page, and any fence with a bad marker. */
export const parseFences = (
  page: string,
  source: string,
): {
  readonly fences: ReadonlyArray<DocFence>
  readonly problems: ReadonlyArray<string>
} => {
  const lines = source.split("\n")
  const fences: Array<DocFence> = []
  const problems: Array<string> = []
  for (let index = 0; index < lines.length; index += 1) {
    const opening = fenceOpening.exec(lines[index] ?? "")
    if (opening === null) {
      continue
    }
    const [, indent = "", ticks = "", info = "", meta = ""] = opening
    const closing = new RegExp(`^\\s*\`{${ticks.length},}\\s*$`)
    let end = index + 1
    while (end < lines.length && !closing.test(lines[end] ?? "")) {
      end += 1
    }
    const language = checkedLanguages.get(info)
    if (language !== undefined) {
      const check = fenceCheckOf(meta)
      if (typeof check === "string") {
        problems.push(`${page}:${index + 1}: ${check}`)
      } else {
        fences.push({
          page,
          line: index + 1,
          language,
          check,
          code: lines
            .slice(index + 1, end)
            .map((line) =>
              line.startsWith(indent) ? line.slice(indent.length) : line,
            )
            .join("\n"),
        })
      }
    }
    index = end
  }
  return { fences, problems }
}

const docPages = (): ReadonlyArray<{
  readonly page: string
  readonly path: string
}> => [
  { page: "README.md", path: readmePath },
  ...readdirSync(docsRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.mdx?$/u.test(entry.name))
    .map((entry) => {
      const path = Path.join(entry.parentPath, entry.name)
      return { page: Path.relative(docsRoot, path), path }
    })
    .sort((left, right) => left.page.localeCompare(right.page)),
]

export const collectDocFences = () => {
  const pages = docPages().map(({ page, path }) =>
    parseFences(page, readFileSync(path, { encoding: "utf8" })),
  )
  return {
    fences: pages.flatMap((page) => page.fences),
    problems: pages.flatMap((page) => page.problems),
  }
}

/** One generated line and the document line it came from. */
type SampleLine = {
  readonly text: string
  readonly source: { readonly page: string; readonly line: number } | undefined
}

export type DocSampleFile = {
  readonly path: string
  readonly page: string
  readonly line: number
  readonly lines: ReadonlyArray<SampleLine>
  /** Names the harness exported for later fences, which the page did not. */
  readonly contextExports: ReadonlyArray<string>
  /** Statements from inside an `Effect.gen`: typechecked there, never run. */
  readonly body: boolean
  /** Declares a contract, so it is loaded and validated after typechecking. */
  readonly declaresContract: boolean
}

type Declared = {
  readonly name: string
  readonly typeOnly: boolean
  /** Bound by an import, so a later fence on the page imports it itself. */
  readonly imported: boolean
}

const blankStrings = (code: string): string =>
  code
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/gu, '""')

const identifiersOf = (code: string): ReadonlySet<string> =>
  new Set(blankStrings(code).match(/[A-Za-z_$][\w$]*/gu) ?? [])

/** The names one clause of `import { a, b as c }` or `const { a, b: c }` binds. */
const boundNames = (clause: string): ReadonlyArray<string> =>
  clause.split(",").flatMap((part) => {
    const name = part
      .trim()
      .replace(/^type\s+|^\.\.\./u, "")
      .split(/\s+as\s+|\s*:\s*/u)
      .at(-1)
    return name === undefined || name === "" ? [] : [name]
  })

const importPatterns = [
  /^import\s+(?:type\s+)?(\w+)\s+from\b/gmu,
  /^import\s+(?:type\s+)?\*\s+as\s+(\w+)/gmu,
]
const importListPattern = /^import\s+(?:type\s+)?\{([^}]*)\}\s+from\b/gmu
const valuePattern =
  /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:const|let|function\*?|class)\s+(\w+)/gmu
const typePattern = /^(?:export\s+)?(?:type|interface)\s+(\w+)/gmu
const destructurePattern = /^(?:export\s+)?const\s+\{([^}]*)\}\s*=/gmu
const exportedPattern =
  /^export\s+(?:async\s+)?(?:const|let|function\*?|class|type|interface)\s+(\w+)/gmu
const exportedDestructurePattern = /^export\s+const\s+\{([^}]*)\}\s*=/gmu

/** What a fence binds at its top level, read off its column-zero statements. */
const declaredBy = (source: string): ReadonlyArray<Declared> => {
  const code = blankStrings(source)
  const declared = new Map<string, Declared>()
  const note = (name: string, typeOnly: boolean, imported: boolean) =>
    declared.set(name, {
      name,
      typeOnly: typeOnly && (declared.get(name)?.typeOnly ?? true),
      imported,
    })
  const captured = (pattern: RegExp) =>
    [...code.matchAll(pattern)].map((match) => match[1] ?? "")
  for (const pattern of importPatterns) {
    for (const name of captured(pattern)) {
      note(name, false, true)
    }
  }
  for (const clause of captured(importListPattern)) {
    for (const name of boundNames(clause)) {
      note(name, false, true)
    }
  }
  for (const name of captured(valuePattern)) {
    note(name, false, false)
  }
  for (const clause of captured(destructurePattern)) {
    for (const name of boundNames(clause)) {
      note(name, false, false)
    }
  }
  for (const name of captured(typePattern)) {
    note(name, true, false)
  }
  return [...declared.values()]
}

/** Column-zero `declare const` statements, each spanning its balanced lines. */
const ambientStatements = (
  code: string,
): ReadonlyArray<{
  readonly name: string
  readonly first: number
  readonly last: number
}> => {
  const lines = code.split("\n")
  const statements: Array<{
    readonly name: string
    readonly first: number
    readonly last: number
  }> = []
  for (let first = 0; first < lines.length; first += 1) {
    const name = /^declare\s+const\s+(\w+)/u.exec(lines[first] ?? "")?.[1]
    if (name === undefined) {
      continue
    }
    let depth = 0
    let last = first
    for (; last < lines.length; last += 1) {
      const text = (lines[last] ?? "").replace(/=>/gu, "")
      depth += (text.match(/[<({[]/gu) ?? []).length
      depth -= (text.match(/[>)}\]]/gu) ?? []).length
      if (depth <= 0) {
        break
      }
    }
    statements.push({ name, first, last })
    first = last
  }
  return statements
}

const isBody = (code: string): boolean =>
  /^(?:(?:const|let)\s[^=\n]*=\s*)?(?:return\s+)?yield\*/mu.test(code)

const declaresContractPattern =
  /\b(?:table|scheduledTable|outboxTable)\s*\(|\bStdb\s*\.\s*Module\s*\.\s*make\b|server-compiler/u

export const declaresContract = (code: string): boolean =>
  declaresContractPattern.test(code)

const importStatement = /^import\b[^;]*?(?:from\s+)?"[^"]+";?[ \t]*$/gmu

const generatedLine = (text: string): SampleLine => ({
  text,
  source: undefined,
})

const pageDirectory = (page: string): string =>
  page.replace(/\.mdx?$/u, "").toLowerCase()

const moduleSpecifier = (from: string, to: string): string => {
  const relative = Path.relative(Path.dirname(from), to)
  return JSON.stringify(relative.startsWith(".") ? relative : `./${relative}`)
}

type Context = Map<
  string,
  {
    readonly path: string
    readonly typeOnly: boolean
    /** Typed but valueless in the world, so a fence's own `declare` wins. */
    readonly ambient: boolean
  }
>

const importsFrom = (
  samplePath: string,
  names: ReadonlyArray<{
    readonly name: string
    readonly path: string
    readonly typeOnly: boolean
  }>,
): ReadonlyArray<SampleLine> =>
  [...new Set(names.map(({ path }) => path))].map((path) => {
    const clause = names
      .filter((entry) => entry.path === path)
      .map(({ name, typeOnly }) => (typeOnly ? `type ${name}` : name))
      .join(", ")
    return generatedLine(
      `import { ${clause} } from ${moduleSpecifier(samplePath, path)}`,
    )
  })

const generatedSample = (
  fence: DocFence,
  directory: string,
  world: Context,
  page: Context,
): DocSampleFile | undefined => {
  if (fence.check.kind === "excepted") {
    return undefined
  }
  const path = Path.join(
    directory,
    pageDirectory(fence.page),
    fence.check.fileName ?? `sample-${fence.line}.${fence.language}`,
  )
  // A fence's `declare const uri: string` says "you have one". Where the world
  // or an earlier fence has that value, the sample uses it.
  const lines = fence.code.split("\n")
  for (const { name, first, last } of ambientStatements(fence.code)) {
    const provided = page.get(name) ?? world.get(name)
    if (provided !== undefined && !provided.ambient) {
      lines.fill("", first, last + 1)
    }
  }
  const code = lines.join("\n")
  const own = declaredBy(code)
  const ownNames = new Set(own.map(({ name }) => name))
  const context = [...identifiersOf(code)].flatMap((name) => {
    const entry = ownNames.has(name)
      ? undefined
      : (page.get(name) ?? world.get(name))
    return entry === undefined
      ? []
      : [{ name, path: entry.path, typeOnly: entry.typeOnly }]
  })
  const source = (offset: number) => ({
    page: fence.page,
    line: fence.line + offset + 1,
  })

  if (isBody(code)) {
    const imports = code.match(importStatement) ?? []
    return {
      path,
      page: fence.page,
      line: fence.line,
      contextExports: [],
      body: true,
      declaresContract: declaresContract(code),
      lines: [
        ...importsFrom(path, context),
        generatedLine('import { gen as docSampleBody } from "effect/Effect"'),
        ...imports.map(generatedLine),
        generatedLine("void docSampleBody(function* () {"),
        // Blanked rather than cut, so every other line keeps its number.
        ...code
          .replace(importStatement, "")
          .split("\n")
          .map((text, offset) => ({ text, source: source(offset) })),
        generatedLine("})"),
      ],
    }
  }

  const exportedByFence = new Set([
    ...[...blankStrings(code).matchAll(exportedPattern)].map(
      (match) => match[1] ?? "",
    ),
    ...[...blankStrings(code).matchAll(exportedDestructurePattern)].flatMap(
      (match) => boundNames(match[1] ?? ""),
    ),
  ])
  const contextExports = own.filter(
    ({ name, imported }) => !imported && !exportedByFence.has(name),
  )
  if (!fence.check.isolated) {
    for (const { name, typeOnly, imported } of own) {
      if (!imported) {
        page.set(name, { path, typeOnly, ambient: false })
      }
    }
  }
  const footer = contextExports
    .map(({ name, typeOnly }) => (typeOnly ? `type ${name}` : name))
    .join(", ")
  return {
    path,
    page: fence.page,
    line: fence.line,
    contextExports: contextExports.map(({ name }) => name),
    body: false,
    declaresContract: declaresContract(code),
    lines: [
      ...importsFrom(path, context),
      ...lines.map((text, offset) => ({ text, source: source(offset) })),
      ...(footer === "" ? [] : [generatedLine(`export { ${footer} }`)]),
    ],
  }
}

/** The names `doc-sample-world.ts` exports, read from its source. */
const worldContext = (): Context => {
  const source = readFileSync(worldPath, { encoding: "utf8" })
  const world: Context = new Map()
  const add = (name: string, typeOnly: boolean, ambient = false) =>
    world.set(name, {
      path: worldPath,
      typeOnly: typeOnly && (world.get(name)?.typeOnly ?? true),
      ambient,
    })
  for (const match of source.matchAll(
    /^export\s+(?:const|function|class)\s+(\w+)/gmu,
  )) {
    add(match[1] ?? "", false)
  }
  for (const match of source.matchAll(/^export\s+declare\s+const\s+(\w+)/gmu)) {
    add(match[1] ?? "", false, true)
  }
  for (const match of source.matchAll(
    /^export\s+(?:type|interface)\s+(\w+)/gmu,
  )) {
    add(match[1] ?? "", true)
  }
  for (const match of source.matchAll(/^export\s+\*\s+as\s+(\w+)/gmu)) {
    add(match[1] ?? "", false)
  }
  for (const match of source.matchAll(
    /^export\s+(?:const\s+)?\{([^}]*)\}/gmu,
  )) {
    for (const name of boundNames(match[1] ?? "")) {
      add(name, false)
    }
  }
  return world
}

/**
 * What a page imports from code the reader generates or already has. Each is
 * written beside the page's samples, so a fence shows the import a reader
 * would write.
 */
const generatedModuleStubs: ReadonlyArray<{
  readonly fileName: string
  readonly source: (
    world: string,
    example: (path: string) => string,
    sample: (path: string) => string,
  ) => string
}> = [
  {
    fileName: "module_bindings.ts",
    source: (world) =>
      `export { DbConnection, type ErrorContext } from ${world}\n`,
  },
  {
    fileName: "src/contract.ts",
    source: (_world, _example, sample) =>
      `export * from ${sample("getting-started/src/contract.ts")}\n`,
  },
  {
    fileName: "src/live.ts",
    source: (_world, _example, sample) =>
      `export * from ${sample("getting-started/src/live.ts")}\n`,
  },
  {
    fileName: "generated-client/index.ts",
    source: (world) => `export { DbConnection } from ${world}\n`,
  },
  {
    fileName: "module.ts",
    source: (world) => `export { Module } from ${world}\n`,
  },
  {
    fileName: "remote/pair_inbox/index.ts",
    source: (_world, example) =>
      `export { default } from ${example("examples/idc-pair/sender/src/remote/pair_inbox/index.js")}\n`,
  },
]

export const writeDocSamples = (
  directory: string,
  fences: ReadonlyArray<DocFence>,
): ReadonlyArray<DocSampleFile> => {
  rmSync(directory, { force: true, recursive: true })
  const world = worldContext()
  const pages = new Map<string, Context>()
  const files = fences.flatMap((fence) => {
    const page = pages.get(fence.page) ?? new Map()
    pages.set(fence.page, page)
    const file = generatedSample(fence, directory, world, page)
    return file === undefined ? [] : [file]
  })
  for (const file of files) {
    mkdirSync(Path.dirname(file.path), { recursive: true })
    writeFileSync(
      file.path,
      `${file.lines.map((line) => line.text).join("\n")}\n`,
    )
  }
  for (const page of pages.keys()) {
    const pageDir = Path.join(directory, pageDirectory(page))
    mkdirSync(pageDir, { recursive: true })
    for (const stub of generatedModuleStubs) {
      const path = Path.join(pageDir, stub.fileName)
      // A fence of the same name is the real thing.
      if (existsSync(path)) {
        continue
      }
      mkdirSync(Path.dirname(path), { recursive: true })
      writeFileSync(
        path,
        stub.source(
          moduleSpecifier(path, worldPath),
          (example) => moduleSpecifier(path, Path.join(packageRoot, example)),
          (sample) => moduleSpecifier(path, Path.join(directory, sample)),
        ),
      )
    }
  }
  writeFileSync(
    Path.join(directory, "tsconfig.json"),
    JSON.stringify(
      {
        extends: Path.relative(directory, samplesTsconfigBase),
        compilerOptions: { jsx: "react-jsx", types: ["node"] },
        include: ["./**/*.ts", "./**/*.tsx"],
      },
      null,
      2,
    ),
  )
  return files
}

const diagnosticLine = /^(.+?)\((\d+),(\d+)\): (error TS\d+: .*)$/

/**
 * Runs the compiler over the generated samples. Each diagnostic names the
 * document line it belongs to; one with no document line is the harness's own.
 */
export const typecheckDocSamples = (
  directory: string,
  files: ReadonlyArray<DocSampleFile>,
): ReadonlyArray<string> => {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const result = spawnSync(
    process.execPath,
    [typescriptCompilerBin, "--noEmit", "--pretty", "false", "-p", directory],
    { cwd: directory, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  if (result.error !== undefined) {
    throw result.error
  }
  const output = `${result.stdout}${result.stderr}`
  const diagnostics = output.split("\n").flatMap((line) => {
    const match = diagnosticLine.exec(line)
    if (match === null) {
      return []
    }
    const [, file = "", lineNumber = "0", , message = ""] = match
    const sample = byPath.get(Path.resolve(directory, file))
    const source = sample?.lines[Number(lineNumber) - 1]?.source
    return [
      source === undefined
        ? `${file}:${lineNumber}: ${message}`
        : `${source.page}:${source.line}: ${message}`,
    ]
  })
  if (result.status !== 0 && diagnostics.length === 0) {
    throw new Error(`tsc exited ${String(result.status)} with:\n${output}`)
  }
  return diagnostics
}

const spacetimeSysStub = Path.join(
  packageRoot,
  "src",
  "testing",
  "spacetime-sys.ts",
)

export const docSamplesDirectory = Path.join(packageRoot, ".tmp", "doc-samples")

const validatorPath = Path.join(
  packageRoot,
  "test",
  "fixtures",
  "doc-sample-validate.ts",
)

/**
 * Bundles what declares a contract, because the SDK's server runtime only loads
 * through `Bun.build` here (see `fixtures/host-module-bundle`), with the host
 * ABI redirected to the stub. Each sample keeps its own entry, so a load
 * failure names one sample, and the entries share one copy of the package.
 */
export const bundleDocSamples = async (
  directory: string,
  files: ReadonlyArray<DocSampleFile>,
) => {
  const loaded = files.filter((file) => file.declaresContract && !file.body)
  const outdir = Path.join(directory, ".bundle")
  const result = await Bun.build({
    entrypoints: [...loaded.map((file) => file.path), worldPath, validatorPath],
    format: "esm",
    naming: "[dir]/[name].[ext]",
    outdir,
    root: packageRoot,
    splitting: true,
    target: "bun",
    plugins: [
      {
        name: "spacetime-sys-stub",
        setup(build: Bun.PluginBuilder) {
          build.onResolve({ filter: /^spacetime:sys@2\.[012]$/ }, () => ({
            path: spacetimeSysStub,
          }))
        },
      },
    ],
  })
  if (!result.success) {
    throw new AggregateError(result.logs, "Failed to bundle the doc samples")
  }
  const bundled = (path: string) =>
    Path.join(
      outdir,
      `${Path.relative(packageRoot, path).replace(/\.tsx?$/u, "")}.js`,
    )
  return {
    samples: loaded.map((file) => ({ file, url: bundled(file.path) })),
    validator: bundled(validatorPath),
    world: bundled(worldPath),
  }
}
