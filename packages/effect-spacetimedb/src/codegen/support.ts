// Type-only import keeps the dynamically loaded optional peer visible to unused-dependency checks.
import type {} from "esbuild"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/process/ChildProcess"
import {
  ArtifactDriftError,
  CodegenArtifactDirectoryError,
  CodegenBundleError,
  CodegenCliExecutionError,
  CodegenCliVersionError,
  CodegenEsbuildMissingError,
  CodegenFileSystemError,
  type CodegenFileSystemOperation,
  type GeneratedArtifactKind,
  requiredSpacetimeCliVersion,
} from "./errors.ts"

// Shared by client and receiver-binding generation: running the pinned CLI,
// bundling its TypeScript output verbatim under the codegen banner, and the
// byte-for-byte drift comparison.

type CapturedCommand = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const encodeText = (text: string): Uint8Array => textEncoder.encode(text)

const parseSpacetimeCliVersion = (output: string): string | undefined =>
  output.match(/spacetimedb tool version (\d+\.\d+\.\d+)(?=[;\s]|$)/u)?.[1] ??
  output.match(/^spacetimedb(?:-standalone)?\s+(\d+\.\d+\.\d+)(?:\s|$)/mu)?.[1]

export const commandError = (
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

/**
 * Runs a CLI command and captures its output. `cwd` matters to `generate`,
 * which reads the nearest `spacetime.json` above it unless `--no-config`.
 */
export const runCommand = Effect.fn(function* (
  operation: CodegenCliExecutionError["operation"],
  command: ReadonlyArray<string>,
  options: { readonly cwd?: string | undefined } = {},
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
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
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

export const fileSystemError =
  (operation: CodegenFileSystemOperation, path: string) =>
  (cause: PlatformError.PlatformError) =>
    new CodegenFileSystemError({ cause, operation, path })

export const cleanAndCreateDirectory = Effect.fn(function* (
  directory: string,
  operations: {
    readonly clean: CodegenFileSystemOperation
    readonly create: CodegenFileSystemOperation
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

export const assertArtifactDirectoryCanBeReplaced = Effect.fn(function* (
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

/** Checks the CLI is the pinned version and returns that version. */
export const assertSpacetimeVersion = Effect.fn(function* (
  command: ReadonlyArray<string>,
) {
  if (command.length === 0) {
    return yield* commandError("version", command, {
      exitCode: -1,
      stderr: "Resolved SpaceTimeDB CLI command was empty.",
      stdout: "",
    })
  }
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

export const generatedBanner = (
  spacetimeCliVersion: string,
  esbuildVersion: string,
) =>
  `// Generated by effect-spacetimedb codegen (spacetime ${spacetimeCliVersion}, esbuild ${esbuildVersion}). DO NOT EDIT.\n`

const isModuleNotFound = (cause: unknown): boolean =>
  Predicate.hasProperty(cause, "code") &&
  (cause.code === "ERR_MODULE_NOT_FOUND" || cause.code === "MODULE_NOT_FOUND")

export const loadEsbuild = Effect.tryPromise({
  try: () => import("esbuild"),
  catch: (cause) =>
    isModuleNotFound(cause)
      ? new CodegenEsbuildMissingError({
          cause,
          peer: "esbuild",
          requirement: "^0.25 || ^0.26 || ^0.27 || ^0.28",
        })
      : new CodegenBundleError({ cause }),
})

/**
 * Bundles the CLI's generated `index.ts` in `directory` verbatim: one ESM file,
 * `spacetimedb` left external, under the codegen banner that records both
 * toolchain versions.
 */
export const bundleGeneratedIndex = Effect.fn(function* (
  esbuild: typeof import("esbuild"),
  directory: string,
  banner: string,
) {
  const path = yield* Path.Path
  const result = yield* Effect.tryPromise({
    try: () =>
      esbuild.build({
        absWorkingDir: directory,
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

  return encodeText(`${banner}${textDecoder.decode(output.contents)}`)
})

export const writeArtifact = Effect.fn(function* (
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

/** The files an artifact directory holds, by name, with their expected bytes. */
export type ExpectedArtifactFiles = {
  readonly "index.js": Uint8Array
  readonly "index.d.ts": Uint8Array
}

const expectedArtifactEntries = ["index.d.ts", "index.js"] as const

/** Writes a fresh artifact directory holding exactly `files`. */
export const writeArtifactDirectory = Effect.fn(function* (
  artifactDir: string,
  files: ExpectedArtifactFiles,
) {
  const path = yield* Path.Path
  yield* cleanAndCreateDirectory(artifactDir, {
    clean: "clean artifact directory",
    create: "create artifact directory",
  })
  const indexJs = path.join(artifactDir, "index.js")
  const indexDts = path.join(artifactDir, "index.d.ts")
  yield* writeArtifact(indexJs, files["index.js"])
  yield* writeArtifact(indexDts, files["index.d.ts"])
  return [indexJs, indexDts]
})

/**
 * Compares a committed artifact directory with freshly generated bytes and
 * fails with `ArtifactDriftError` on any difference: a changed or missing
 * file, an unexpected one, or a banner recording another toolchain.
 */
export const checkArtifactDirectory = Effect.fn(function* (params: {
  readonly artifact: GeneratedArtifactKind
  readonly artifactDir: string
  readonly expected: ExpectedArtifactFiles
  readonly spacetimeCliVersion: string
  readonly esbuildVersion: string
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const entries = yield* fs.readDirectory(params.artifactDir).pipe(
    Effect.mapError(
      fileSystemError("list artifact directory", params.artifactDir),
    ),
    Effect.map((values) => [...values].sort()),
  )
  const committedJs = entries.includes("index.js")
    ? yield* readArtifact(path.join(params.artifactDir, "index.js"))
    : undefined
  const committedDts = entries.includes("index.d.ts")
    ? yield* readArtifact(path.join(params.artifactDir, "index.d.ts"))
    : undefined
  const missingFiles = expectedArtifactEntries.filter(
    (expected) => !entries.includes(expected),
  )
  const unexpectedFiles = entries.filter(
    (entry) => !expectedArtifactEntries.some((expected) => expected === entry),
  )
  const manifestChanged = missingFiles.length > 0 || unexpectedFiles.length > 0
  const changedFiles = [
    ...(committedJs !== undefined &&
    bytesEqual(committedJs, params.expected["index.js"])
      ? []
      : ["index.js"]),
    ...(committedDts !== undefined &&
    bytesEqual(committedDts, params.expected["index.d.ts"])
      ? []
      : ["index.d.ts"]),
    ...(manifestChanged ? ["artifact manifest"] : []),
  ]

  if (changedFiles.length === 0) {
    return
  }

  const currentToolchain = `${params.spacetimeCliVersion} / ${params.esbuildVersion}`
  const committedToolchain =
    committedJs === undefined ? undefined : recordedToolchain(committedJs)
  return yield* new ArtifactDriftError({
    artifact: params.artifact,
    artifactDir: params.artifactDir,
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
