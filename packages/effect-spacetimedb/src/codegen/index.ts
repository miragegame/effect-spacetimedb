import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import type { ArtifactDriftError, CodegenError } from "./errors.ts"
import {
  assertArtifactDirectoryCanBeReplaced,
  assertSpacetimeVersion,
  bundleGeneratedIndex,
  checkArtifactDirectory,
  cleanAndCreateDirectory,
  encodeText,
  generatedBanner,
  loadEsbuild,
  runCommand,
  writeArtifactDirectory,
} from "./support.ts"

export * from "./errors.ts"
export * from "./receiver.ts"

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

const buildArtifactBytes = Effect.fn(function* (target: CodegenTarget) {
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

  // `--no-config`: a `spacetime.json` above the working directory would
  // otherwise add its own generate targets or retarget this one.
  yield* runCommand("generate", [
    ...target.spacetimeCommand,
    "generate",
    "--no-config",
    "--lang",
    "typescript",
    "--js-path",
    target.moduleBundlePath,
    "--out-dir",
    stagingDir,
    "--yes",
  ])

  const banner = generatedBanner(spacetimeCliVersion, esbuild.version)
  const js = yield* bundleGeneratedIndex(esbuild, stagingDir, banner)
  const dts = encodeText(
    `${banner}import type { GeneratedConnectionClassLike } from "effect-spacetimedb/client"\n\nexport declare const DbConnection: GeneratedConnectionClassLike\n`,
  )

  return {
    files: { "index.js": js, "index.d.ts": dts },
    esbuildVersion: esbuild.version,
    spacetimeCliVersion,
  }
})

export const generateArtifact: (
  target: CodegenTarget,
) => Effect.Effect<
  ArtifactReport,
  CodegenError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = Effect.fn(function* (target) {
  yield* assertArtifactDirectoryCanBeReplaced(target.artifactDir)
  const artifact = yield* buildArtifactBytes(target)
  const files = yield* writeArtifactDirectory(
    target.artifactDir,
    artifact.files,
  )
  return {
    artifactDir: target.artifactDir,
    files,
    bundleBytes: artifact.files["index.js"].byteLength,
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
  const artifact = yield* buildArtifactBytes(target)
  yield* checkArtifactDirectory({
    artifact: "generated client",
    artifactDir: target.artifactDir,
    expected: artifact.files,
    spacetimeCliVersion: artifact.spacetimeCliVersion,
    esbuildVersion: artifact.esbuildVersion,
  })
})
