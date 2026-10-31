import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import {
  type ArtifactDriftError,
  type CodegenError,
  CodegenReceiverBindingError,
} from "./errors.ts"
import {
  assertArtifactDirectoryCanBeReplaced,
  assertSpacetimeVersion,
  bundleGeneratedIndex,
  checkArtifactDirectory,
  cleanAndCreateDirectory,
  encodeText,
  fileSystemError,
  generatedBanner,
  loadEsbuild,
  runCommand,
  writeArtifactDirectory,
} from "./support.ts"

/**
 * Where a receiver binding comes from and where it is committed.
 *
 * `receiverBundlePath` is a bundle of the interface fixture: a module entry
 * that composes only the interface group, since native codegen writes every
 * client-callable reducer of the bundle into the binding. `interfaceName` is
 * the binding's dependency name; native codegen namespaces the binding's type
 * names with it (`<interfaceName>.PingDetails`), so it must match the name the
 * interface is made with (`RemoteInterface.make({ name })`).
 */
export interface ReceiverCodegenTarget {
  readonly interfaceName: string
  readonly receiverBundlePath: string
  readonly stagingDir: string
  readonly artifactDir: string
  readonly spacetimeCommand: ReadonlyArray<string>
}

export interface ReceiverArtifactReport {
  readonly artifactDir: string
  readonly files: ReadonlyArray<string>
  /** The receiver keys the binding carries, sorted. */
  readonly receivers: ReadonlyArray<string>
  readonly spacetimeCliVersion: string
  readonly esbuildVersion: string
}

export type ReceiverCodegenError = CodegenError | CodegenReceiverBindingError

// The sender directory the throwaway `spacetime.json` names. The CLI writes a
// dependency's binding under `<sender>/src/remote_bindings/<dependency>/`.
const stagingSenderDir = "sender"

/**
 * The throwaway config: a sender module whose one dependency is the receiver
 * database, sourced from the prebuilt bundle. Generating through a dependency
 * (rather than `--bindings module --js-path`) is what makes the CLI namespace
 * the binding's type names with the interface name.
 */
const StagingConfig = Schema.Struct({
  "module-path": Schema.String,
  dependencies: Schema.Tuple([
    Schema.Struct({ name: Schema.String, database: Schema.String }),
  ]),
  children: Schema.Tuple([
    Schema.Struct({ database: Schema.String, "js-path": Schema.String }),
  ]),
}).pipe(Schema.fromJsonString)

const encodeStagingConfig = Schema.encodeSync(StagingConfig)

const stagingConfig = (target: ReceiverCodegenTarget, bundlePath: string) =>
  encodeStagingConfig({
    "module-path": `./${stagingSenderDir}`,
    dependencies: [{ name: target.interfaceName, database: "receiver" }],
    children: [{ database: "receiver", "js-path": bundlePath }],
  })

// Native TypeScript module-binding codegen writes one top-level entry per
// receiver, keyed by the quoted camelCase accessor, each with one signature
// hash (`crates/codegen/src/typescript.rs`, `generate_module_bindings`).
const receiverKeyLine = /^ {2}"([A-Za-z0-9_]+)": \{$/gmu
const signatureHashLine = /^ {4}signatureHash: \d+n,$/gmu

const receiverKeys = (source: string, generatedPath: string) => {
  const keys = [...source.matchAll(receiverKeyLine)]
    .map((match) => match[1] ?? "")
    .sort()
  if (keys.length === 0) {
    return Effect.fail(
      new CodegenReceiverBindingError({ generatedPath, reason: "noReceivers" }),
    )
  }
  if ([...source.matchAll(signatureHashLine)].length !== keys.length) {
    return Effect.fail(
      new CodegenReceiverBindingError({
        generatedPath,
        reason: "receiverCountMismatch",
      }),
    )
  }
  return Effect.succeed(keys)
}

// The declaration names the binding structurally: its real type names SDK
// internals and the module's `unique symbol`, which no declaration emit can
// carry into a consumer (TS2883, TS2527). It default-exports the binding, as
// the generated module does, and carries no lint suppression: a consumer's
// linters skip it as generated code, and a committed copy must be exactly what
// the generator writes wherever the package's source is published.
const receiverDeclaration = (
  banner: string,
  keys: ReadonlyArray<string>,
): string => `${banner}import type {
  RemoteModuleBinding,
  RemoteReducerBinding,
} from "effect-spacetimedb"

declare const binding: RemoteModuleBinding & {
  readonly reducers: {
${keys.map((key) => `    readonly ${key}: RemoteReducerBinding`).join("\n")}
  }
}

export default binding
`

const buildReceiverArtifactBytes = Effect.fn(function* (
  target: ReceiverCodegenTarget,
) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const stagingDir = path.resolve(target.stagingDir)
  const esbuild = yield* loadEsbuild
  const spacetimeCliVersion = yield* assertSpacetimeVersion(
    target.spacetimeCommand,
  )

  yield* cleanAndCreateDirectory(stagingDir, {
    clean: "clean staging directory",
    create: "create staging directory",
  })
  const senderDir = path.join(stagingDir, stagingSenderDir)
  yield* fs
    .makeDirectory(senderDir, { recursive: true })
    .pipe(
      Effect.mapError(fileSystemError("create staging directory", senderDir)),
    )
  const configPath = path.join(stagingDir, "spacetime.json")
  yield* fs
    .writeFileString(
      configPath,
      stagingConfig(target, path.resolve(target.receiverBundlePath)),
    )
    .pipe(Effect.mapError(fileSystemError("write staging config", configPath)))

  // Run from the staging directory so the CLI reads exactly that config.
  yield* runCommand(
    "generate",
    [
      ...target.spacetimeCommand,
      "generate",
      "--bindings",
      "module",
      "--lang",
      "typescript",
      "--yes",
    ],
    { cwd: stagingDir },
  )

  const generatedDir = path.join(
    senderDir,
    "src",
    "remote_bindings",
    target.interfaceName,
  )
  const generatedPath = path.join(generatedDir, "index.ts")
  const source = yield* fs
    .readFileString(generatedPath)
    .pipe(
      Effect.mapError(fileSystemError("read generated binding", generatedPath)),
    )
  const keys = yield* receiverKeys(source, generatedPath)

  const banner = generatedBanner(spacetimeCliVersion, esbuild.version)
  const js = yield* bundleGeneratedIndex(esbuild, generatedDir, banner)
  return {
    files: {
      "index.js": js,
      "index.d.ts": encodeText(receiverDeclaration(banner, keys)),
    },
    keys,
    esbuildVersion: esbuild.version,
    spacetimeCliVersion,
  }
})

/**
 * Generates a receiver binding with native `spacetime generate --bindings
 * module` and commits it quarantined, as generated clients are: `index.js` is
 * the native output bundled verbatim under the codegen banner, and `index.d.ts`
 * declares the default export as a `RemoteModuleBinding` with one
 * `RemoteReducerBinding` per receiver key. Native codegen stays the only
 * producer of wire names and signature hashes. The banner records the CLI and
 * esbuild versions, so a toolchain bump is a visible drift.
 */
export const generateReceiverArtifact: (
  target: ReceiverCodegenTarget,
) => Effect.Effect<
  ReceiverArtifactReport,
  ReceiverCodegenError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Effect.fn(function* (target) {
  yield* assertArtifactDirectoryCanBeReplaced(target.artifactDir)
  const artifact = yield* buildReceiverArtifactBytes(target)
  const files = yield* writeArtifactDirectory(
    target.artifactDir,
    artifact.files,
  )
  return {
    artifactDir: target.artifactDir,
    files,
    receivers: artifact.keys,
    spacetimeCliVersion: artifact.spacetimeCliVersion,
    esbuildVersion: artifact.esbuildVersion,
  }
})

/** Regenerates a receiver binding and fails if the committed one differs. */
export const checkReceiverArtifact: (
  target: ReceiverCodegenTarget,
) => Effect.Effect<
  void,
  ArtifactDriftError | ReceiverCodegenError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Effect.fn(function* (target) {
  const artifact = yield* buildReceiverArtifactBytes(target)
  yield* checkArtifactDirectory({
    artifact: "receiver binding",
    artifactDir: target.artifactDir,
    expected: artifact.files,
    spacetimeCliVersion: artifact.spacetimeCliVersion,
    esbuildVersion: artifact.esbuildVersion,
  })
})
