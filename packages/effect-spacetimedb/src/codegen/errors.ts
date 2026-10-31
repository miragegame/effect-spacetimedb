import * as Data from "effect/Data"
import * as Match from "effect/Match"

// Repository codegen requires an exact CLI/SDK match because the module-def
// format is patch-version coupled. The package peer remains ~2.14.0 so external
// consumers may use any compatible 2.14.x SDK without invoking repo codegen.
export const requiredSpacetimeCliVersion = "2.14.0" as const

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
  readonly requirement: "^0.25 || ^0.26 || ^0.27 || ^0.28"
}> {
  override get message(): string {
    return "The optional esbuild peer (^0.25 || ^0.26 || ^0.27 || ^0.28) is required for generated artifacts"
  }
}

export class CodegenBundleError extends Data.TaggedError("CodegenBundleError")<{
  readonly cause: unknown
}> {
  override get message(): string {
    return "Failed to bundle the generated SpaceTimeDB code"
  }
}

export type CodegenFileSystemOperation =
  | "clean artifact directory"
  | "clean staging directory"
  | "create artifact directory"
  | "create staging directory"
  | "inspect artifact directory"
  | "list artifact directory"
  | "read artifact"
  | "read generated binding"
  | "write artifact"
  | "write staging config"

export class CodegenFileSystemError extends Data.TaggedError(
  "CodegenFileSystemError",
)<{
  readonly cause: unknown
  readonly operation: CodegenFileSystemOperation
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

/**
 * Native module-binding codegen produced a binding this package cannot
 * quarantine: no receiver at all (the bundle composes no client-callable
 * reducer), or receiver keys that do not pair one-to-one with the signature
 * hashes the generator wrote.
 */
export class CodegenReceiverBindingError extends Data.TaggedError(
  "CodegenReceiverBindingError",
)<{
  readonly generatedPath: string
  readonly reason: "noReceivers" | "receiverCountMismatch"
}> {
  override get message(): string {
    return this.reason === "noReceivers"
      ? `The generated receiver binding ${this.generatedPath} carries no receiver; the bundle must compose the interface group`
      : `The generated receiver binding ${this.generatedPath} does not pair each receiver key with one signature hash`
  }
}

/** What a drift check compared: a generated client or a receiver binding. */
export type GeneratedArtifactKind = "generated client" | "receiver binding"

export class ArtifactDriftError extends Data.TaggedError("ArtifactDriftError")<{
  readonly artifact: GeneratedArtifactKind
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
    const subject =
      this.artifact === "generated client"
        ? "Generated client"
        : "Receiver binding"
    return Match.value(this.driftKind).pipe(
      Match.when(
        "toolchain",
        () =>
          `${subject} toolchain changed (${this.recordedToolchain ?? "unknown"} -> ${this.currentToolchain}); regenerate and commit ${this.artifactDir} (${files})`,
      ),
      Match.when(
        "manifest",
        () =>
          `${subject} artifact manifest changed; regenerate and commit ${this.artifactDir} (${manifestChanges})`,
      ),
      Match.when(
        "module",
        () =>
          `${subject} module changed; regenerate and commit ${this.artifactDir} (${files})`,
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
