// Type-only import keeps the dynamically loaded optional peer visible to dependency lint.
import type {} from "esbuild"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Match from "effect/Match"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

// Repository codegen requires an exact CLI/SDK match because the module-def
// format is patch-version coupled. The package peer remains ~2.6.1 so external
// consumers may use any compatible 2.6.x SDK without invoking repo codegen.
export const requiredSpacetimeCliVersion = "2.6.1" as const

export interface CodegenTarget {
  readonly moduleBundlePath: string
  readonly stagingDir: string
  readonly artifactDir: string
  readonly spacetimeCommand: ReadonlyArray<string>
}

export interface ArtifactReport {
  readonly artifactDir: string
  readonly files: ReadonlyArray<string>
  readonly bundleBytes: number
  readonly spacetimeCliVersion: string
  readonly esbuildVersion: string
}

export class CodegenCliVersionError extends Data.TaggedError(
  "CodegenCliVersionError",
)<{
  readonly actual: string | undefined
  readonly command: ReadonlyArray<string>
  readonly expected: typeof requiredSpacetimeCliVersion
}> {
  override get message(): string {
    return `SpaceTimeDB CLI ${this.expected} is required; found ${this.actual ?? "an unrecognized version"}`
  }
}

export class CodegenCliExecutionError extends Data.TaggedError(
  "CodegenCliExecutionError",
)<{
  readonly command: ReadonlyArray<string>
  readonly exitCode: number
  readonly operation: "generate" | "version"
  readonly stderr: string
  readonly stdout: string
}> {
  override get message(): string {
    return `SpaceTimeDB ${this.operation} command failed with exit code ${this.exitCode.toString()}`
  }
}

export class CodegenEsbuildMissingError extends Data.TaggedError(
  "CodegenEsbuildMissingError",
)<{
  readonly cause: unknown
  readonly peer: "esbuild"
  readonly requirement: "^0.25"
}> {
  override get message(): string {
    return "The optional esbuild peer (^0.25) is required for generated-client artifacts"
  }
}

export class CodegenBundleError extends Data.TaggedError("CodegenBundleError")<{
  readonly cause: unknown
}> {
  override get message(): string {
    return "Failed to bundle the generated SpaceTimeDB client"
  }
}

type FileSystemOperation =
  | "clean artifact directory"
  | "clean staging directory"
  | "create artifact directory"
  | "create staging directory"
  | "inspect artifact directory"
  | "list artifact directory"
  | "read artifact"
  | "write artifact"

export class CodegenFileSystemError extends Data.TaggedError(
  "CodegenFileSystemError",
)<{
  readonly cause: unknown
  readonly operation: FileSystemOperation
  readonly path: string
}> {
  override get message(): string {
    return `${this.operation} failed for ${this.path}`
  }
}

export class CodegenArtifactDirectoryError extends Data.TaggedError(
  "CodegenArtifactDirectoryError",
)<{
  readonly artifactDir: string
  readonly entries: ReadonlyArray<string>
}> {
  override get message(): string {
    return `Refusing to replace non-artifact directory ${this.artifactDir}; expected an existing index.js marker (found: ${this.entries.join(", ")})`
  }
}

export class ArtifactDriftError extends Data.TaggedError("ArtifactDriftError")<{
  readonly artifactDir: string
  readonly driftKind: "manifest" | "module" | "toolchain"
  readonly files: ReadonlyArray<string>
  readonly missingFiles: ReadonlyArray<string>
  readonly currentToolchain: string
  readonly recordedToolchain: string | undefined
  readonly unexpectedFiles: ReadonlyArray<string>
}> {
  override get message(): string {
    const files = this.files.join(", ")
    const manifestChanges = [
      ...this.missingFiles.map((file) => `missing ${file}`),
      ...this.unexpectedFiles.map((file) => `unexpected ${file}`),
    ].join(", ")
    return Match.value(this.driftKind).pipe(
      Match.when(
        "toolchain",
        () =>
          `Generated client toolchain changed (${this.recordedToolchain ?? "unknown"} -> ${this.currentToolchain}); regenerate and commit ${this.artifactDir} (${files})`,
      ),
      Match.when(
        "manifest",
        () =>
          `Generated client artifact manifest changed; regenerate and commit ${this.artifactDir} (${manifestChanges})`,
      ),
      Match.when(
        "module",
        () =>
          `Generated client module changed; regenerate and commit ${this.artifactDir} (${files})`,
      ),
      Match.exhaustive,
    )
  }
}

export type CodegenError =
  | CodegenArtifactDirectoryError
  | CodegenBundleError
  | CodegenCliExecutionError
  | CodegenCliVersionError
  | CodegenEsbuildMissingError
  | CodegenFileSystemError

type CapturedCommand = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

type ArtifactBytes = {
  readonly dts: Uint8Array
  readonly esbuildVersion: string
  readonly js: Uint8Array
  readonly spacetimeCliVersion: string
}

const expectedArtifactEntries = ["index.d.ts", "index.js"] as const
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const parseSpacetimeCliVersion = (output: string): string | undefined =>
  output.match(/spacetimedb tool version (\d+\.\d+\.\d+)(?=[;\s]|$)/u)?.[1] ??
  output.match(/^spacetimedb(?:-standalone)?\s+(\d+\.\d+\.\d+)(?:\s|$)/mu)?.[1]

const commandError = (
  operation: CodegenCliExecutionError["operation"],
  command: ReadonlyArray<string>,
  output: CapturedCommand,
) =>
  new CodegenCliExecutionError({
    command,
    exitCode: output.exitCode,
    operation,
    stderr: output.stderr,
    stdout: output.stdout,
  })

const collectTextStream = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  operation: CodegenCliExecutionError["operation"],
  command: ReadonlyArray<string>,
) =>
  Stream.runFold(
    Stream.decodeText(stream),
    () => "",
    (current, chunk) => `${current}${chunk}`,
  ).pipe(
    Effect.mapError((cause) =>
      commandError(operation, command, {
        exitCode: -1,
        stderr: String(cause),
        stdout: "",
      }),
    ),
  )

const runCommand = Effect.fn(function* (
  operation: CodegenCliExecutionError["operation"],
  command: ReadonlyArray<string>,
) {
  const [program, ...args] = command
  if (program === undefined) {
    return yield* commandError(operation, command, {
      exitCode: -1,
      stderr: "Resolved SpaceTimeDB CLI command was empty.",
      stdout: "",
    })
  }

  const output = yield* ChildProcess.make(program, args, {
    extendEnv: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  }).pipe(
    Effect.mapError((cause: PlatformError.PlatformError) =>
      commandError(operation, command, {
        exitCode: -1,
        stderr: String(cause),
        stdout: "",
      }),
    ),
    Effect.flatMap((process) =>
      Effect.all(
        {
          exitCode: process.exitCode.pipe(
            Effect.map(Number),
            Effect.mapError((cause) =>
              commandError(operation, command, {
                exitCode: -1,
                stderr: String(cause),
                stdout: "",
              }),
            ),
          ),
          stderr: collectTextStream(process.stderr, operation, command),
          stdout: collectTextStream(process.stdout, operation, command),
        },
        { concurrency: "unbounded" },
      ),
    ),
    Effect.scoped,
  )

  if (output.exitCode !== 0) {
    return yield* commandError(operation, command, output)
  }

  return output
})

const fileSystemError =
  (operation: FileSystemOperation, path: string) =>
  (cause: PlatformError.PlatformError) =>
    new CodegenFileSystemError({ cause, operation, path })

const cleanAndCreateDirectory = Effect.fn(function* (
  directory: string,
  operations: {
    readonly clean: FileSystemOperation
    readonly create: FileSystemOperation
  },
) {
  const fs = yield* FileSystem.FileSystem
  yield* fs
    .remove(directory, { force: true, recursive: true })
    .pipe(Effect.mapError(fileSystemError(operations.clean, directory)))
  yield* fs
    .makeDirectory(directory, { recursive: true })
    .pipe(Effect.mapError(fileSystemError(operations.create, directory)))
})

const assertArtifactDirectoryCanBeReplaced = Effect.fn(function* (
  artifactDir: string,
) {
  const fs = yield* FileSystem.FileSystem
  const exists = yield* fs
    .exists(artifactDir)
    .pipe(
      Effect.mapError(
        fileSystemError("inspect artifact directory", artifactDir),
      ),
    )
  if (!exists) {
    return
  }

  const entries = yield* fs.readDirectory(artifactDir).pipe(
    Effect.mapError(fileSystemError("inspect artifact directory", artifactDir)),
    Effect.map((values) => [...values].sort()),
  )
  if (entries.length > 0 && !entries.includes("index.js")) {
    return yield* new CodegenArtifactDirectoryError({
      artifactDir,
      entries,
    })
  }
})

const assertSpacetimeVersion = Effect.fn(function* (
  command: ReadonlyArray<string>,
) {
  const versionCommand = [...command, "--version"]
  const output = yield* runCommand("version", versionCommand)
  const actual = parseSpacetimeCliVersion(`${output.stdout}\n${output.stderr}`)
  if (actual !== requiredSpacetimeCliVersion) {
    return yield* new CodegenCliVersionError({
      actual,
      command: versionCommand,
      expected: requiredSpacetimeCliVersion,
    })
  }

  return actual
})

const generatedBanner = (spacetimeCliVersion: string, esbuildVersion: string) =>
  `// Generated by effect-spacetimedb codegen (spacetime ${spacetimeCliVersion}, esbuild ${esbuildVersion}). DO NOT EDIT.\n`

const isModuleNotFound = (cause: unknown): boolean =>
  Predicate.hasProperty(cause, "code") &&
  (cause.code === "ERR_MODULE_NOT_FOUND" || cause.code === "MODULE_NOT_FOUND")

const loadEsbuild = () =>
  Effect.tryPromise({
    try: () => import("esbuild"),
    catch: (cause) =>
      isModuleNotFound(cause)
        ? new CodegenEsbuildMissingError({
            cause,
            peer: "esbuild",
            requirement: "^0.25",
          })
        : new CodegenBundleError({ cause }),
  })

const buildArtifactBytes = Effect.fn(function* (target: CodegenTarget) {
  const path = yield* Path.Path
  const stagingDir = path.resolve(target.stagingDir)
  const esbuild = yield* loadEsbuild()
  if (target.spacetimeCommand.length === 0) {
    return yield* commandError("version", target.spacetimeCommand, {
      exitCode: -1,
      stderr: "Resolved SpaceTimeDB CLI command was empty.",
      stdout: "",
    })
  }
  const spacetimeCliVersion = yield* assertSpacetimeVersion(
    target.spacetimeCommand,
  )

  yield* cleanAndCreateDirectory(stagingDir, {
    clean: "clean staging directory",
    create: "create staging directory",
  })

  yield* runCommand("generate", [
    ...target.spacetimeCommand,
    "generate",
    "--lang",
    "typescript",
    "--js-path",
    target.moduleBundlePath,
    "--out-dir",
    stagingDir,
    "--yes",
  ])

  const result = yield* Effect.tryPromise({
    try: () =>
      esbuild.build({
        absWorkingDir: stagingDir,
        bundle: true,
        entryPoints: ["index.ts"],
        external: ["spacetimedb", "spacetimedb/*"],
        format: "esm",
        legalComments: "none",
        logLevel: "silent",
        platform: "neutral",
        target: "es2022",
        tsconfigRaw: {},
        write: false,
      }),
    catch: (cause) => new CodegenBundleError({ cause }),
  })
  const output =
    result.outputFiles.find(
      (file) => path.basename(file.path) === "<stdout>",
    ) ?? result.outputFiles[0]
  if (output === undefined) {
    return yield* new CodegenBundleError({
      cause: "esbuild returned no output file",
    })
  }

  const banner = generatedBanner(spacetimeCliVersion, esbuild.version)
  const js = textEncoder.encode(
    `${banner}${textDecoder.decode(output.contents)}`,
  )
  const dts = textEncoder.encode(
    `${banner}import type { GeneratedConnectionClassLike } from "effect-spacetimedb/client"\n\nexport declare const DbConnection: GeneratedConnectionClassLike\n`,
  )

  return {
    dts,
    esbuildVersion: esbuild.version,
    js,
    spacetimeCliVersion,
  } satisfies ArtifactBytes
})

const writeArtifact = Effect.fn(function* (
  filePath: string,
  bytes: Uint8Array,
) {
  const fs = yield* FileSystem.FileSystem
  yield* fs
    .writeFile(filePath, bytes)
    .pipe(Effect.mapError(fileSystemError("write artifact", filePath)))
})

const readArtifact = Effect.fn(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs
    .readFile(filePath)
    .pipe(Effect.mapError(fileSystemError("read artifact", filePath)))
})

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false
  }
  for (let index = 0; index < left.byteLength; index = index + 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

const recordedToolchain = (bytes: Uint8Array): string | undefined =>
  textDecoder
    .decode(bytes.subarray(0, Math.min(bytes.byteLength, 256)))
    .match(
      /^\/\/ Generated by effect-spacetimedb codegen \(spacetime ([^,]+), esbuild ([^)]+)\)\. DO NOT EDIT\.$/mu,
    )
    ?.slice(1)
    .join(" / ")

export const generateArtifact: (
  target: CodegenTarget,
) => Effect.Effect<
  ArtifactReport,
  CodegenError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Effect.fn(function* (target) {
  const path = yield* Path.Path
  yield* assertArtifactDirectoryCanBeReplaced(target.artifactDir)
  const artifact = yield* buildArtifactBytes(target)

  yield* cleanAndCreateDirectory(target.artifactDir, {
    clean: "clean artifact directory",
    create: "create artifact directory",
  })
  const indexJs = path.join(target.artifactDir, "index.js")
  const indexDts = path.join(target.artifactDir, "index.d.ts")
  yield* writeArtifact(indexJs, artifact.js)
  yield* writeArtifact(indexDts, artifact.dts)

  const files = [indexJs, indexDts]
  return {
    artifactDir: target.artifactDir,
    files,
    bundleBytes: artifact.js.byteLength,
    spacetimeCliVersion: artifact.spacetimeCliVersion,
    esbuildVersion: artifact.esbuildVersion,
  }
})

export const checkArtifact: (
  target: CodegenTarget,
) => Effect.Effect<
  void,
  ArtifactDriftError | CodegenError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Effect.fn(function* (target) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const artifact = yield* buildArtifactBytes(target)
  const entries = yield* fs.readDirectory(target.artifactDir).pipe(
    Effect.mapError(
      fileSystemError("list artifact directory", target.artifactDir),
    ),
    Effect.map((values) => [...values].sort()),
  )
  const indexJsPath = path.join(target.artifactDir, "index.js")
  const indexDtsPath = path.join(target.artifactDir, "index.d.ts")
  const committedJs = entries.includes("index.js")
    ? yield* readArtifact(indexJsPath)
    : undefined
  const committedDts = entries.includes("index.d.ts")
    ? yield* readArtifact(indexDtsPath)
    : undefined
  const missingFiles = expectedArtifactEntries.filter(
    (expected) => !entries.includes(expected),
  )
  const unexpectedFiles = entries.filter(
    (entry) => !expectedArtifactEntries.some((expected) => expected === entry),
  )
  const manifestChanged = missingFiles.length > 0 || unexpectedFiles.length > 0
  const changedFiles = [
    ...(committedJs !== undefined && bytesEqual(committedJs, artifact.js)
      ? []
      : ["index.js"]),
    ...(committedDts !== undefined && bytesEqual(committedDts, artifact.dts)
      ? []
      : ["index.d.ts"]),
    ...(manifestChanged ? ["artifact manifest"] : []),
  ]

  if (changedFiles.length === 0) {
    return
  }

  const currentToolchain = `${artifact.spacetimeCliVersion} / ${artifact.esbuildVersion}`
  const committedToolchain =
    committedJs === undefined ? undefined : recordedToolchain(committedJs)
  return yield* new ArtifactDriftError({
    artifactDir: target.artifactDir,
    currentToolchain,
    driftKind:
      changedFiles.includes("artifact manifest") &&
      (changedFiles.length === 1 ||
        committedJs === undefined ||
        committedDts === undefined)
        ? "manifest"
        : committedToolchain === undefined ||
            committedToolchain === currentToolchain
          ? "module"
          : "toolchain",
    files: changedFiles,
    missingFiles,
    recordedToolchain: committedToolchain,
    unexpectedFiles,
  })
})
