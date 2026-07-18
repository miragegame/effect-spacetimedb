import * as Data from "effect/Data"
import type * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import type * as Path from "effect/Path"
import type * as Scope from "effect/Scope"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import type * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

export type SpacetimeBinaries = {
  readonly cli: ReadonlyArray<string>
  readonly standalone: ReadonlyArray<string>
}

export type SpacetimeBinarySource =
  | SpacetimeBinaries
  | { readonly resolve: Effect.Effect<SpacetimeBinaries, DevServerError> }

export type ClearMode = "never" | "on-conflict" | "always"

export type DevServerOptions = {
  readonly bundlePath: string
  readonly dbNamePrefix: string
  readonly binaries?: SpacetimeBinarySource
  readonly versionRequirement?: string
  readonly logDir?: string
  readonly cwd?: string
  readonly clear?: {
    readonly firstPublish?: ClearMode | undefined
    readonly republish?: ClearMode | undefined
  }
}

export type ModuleLifecycleOptions = {
  readonly baseUrl: string
  readonly databaseName: string
  readonly token?: string | undefined
  readonly binaries: SpacetimeBinarySource
  readonly cliRootDir?: string | undefined
  readonly cwd?: string | undefined
  readonly bundlePath?: string | undefined
}

export type ModuleLifecycleStatus = {
  readonly reachable: true
  readonly published: boolean
  readonly databaseIdentity?: string | undefined
}

export type ModuleLifecycle = {
  readonly status: () => Effect.Effect<
    ModuleLifecycleStatus,
    DevServerError,
    HttpClient.HttpClient
  >
  readonly reset: (options?: {
    readonly bundlePath?: string | undefined
  }) => Effect.Effect<
    void,
    DevServerError,
    ChildProcessSpawner.ChildProcessSpawner | HttpClient.HttpClient
  >
}

export type PublishedModuleRuntime = {
  readonly baseUrl: string
  readonly databaseName: string
  readonly jwtPrivateKeyPath: string
  readonly jwtPublicKeyPath: string
  readonly logPath: string
  readonly token: string
  readonly republish: (
    bundlePath: string,
  ) => Effect.Effect<
    void,
    DevServerError,
    ChildProcessSpawner.ChildProcessSpawner
  >
  readonly status: ModuleLifecycle["status"]
  readonly reset: ModuleLifecycle["reset"]
}

export type DevServerRequirements =
  | ChildProcessSpawner.ChildProcessSpawner
  | HttpClient.HttpClient
  | FileSystem.FileSystem
  | Path.Path
  | Scope.Scope

export type DevServerEffect = Effect.Effect<
  PublishedModuleRuntime,
  DevServerError,
  DevServerRequirements
>

export class DevServerPortError extends Data.TaggedError("DevServerPortError")<{
  readonly cause: unknown
}> {
  override get message(): string {
    return "Failed to allocate a local SpaceTimeDB port"
  }
}

export class DevServerBinaryError extends Data.TaggedError(
  "DevServerBinaryError",
)<{
  readonly command: string
  readonly cause: unknown
}> {
  override get message(): string {
    return `Failed to resolve SpaceTimeDB binary: ${this.command}`
  }
}

export class DevServerCommandError extends Data.TaggedError(
  "DevServerCommandError",
)<{
  readonly command: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}> {
  override get message(): string {
    return `${this.command} failed with exit code ${this.exitCode.toString()}`
  }
}

export class DevServerFileSystemError extends Data.TaggedError(
  "DevServerFileSystemError",
)<{
  readonly operation: string
  readonly path: string
  readonly cause: unknown
}> {
  override get message(): string {
    return `${this.operation} failed for ${this.path}`
  }
}

export class DevServerHttpError extends Data.TaggedError("DevServerHttpError")<{
  readonly url: string
  readonly cause: unknown
}> {
  override get message(): string {
    return `SpaceTimeDB dev server request failed: ${this.url}`
  }
}

export class DevServerResponseError extends Data.TaggedError(
  "DevServerResponseError",
)<{
  readonly url: string
  readonly status: number
  readonly body: string
}> {
  override get message(): string {
    return `SpaceTimeDB dev server returned HTTP ${this.status.toString()} for ${this.url}`
  }
}

export class DevServerResetVerificationError extends Data.TaggedError(
  "DevServerResetVerificationError",
)<{
  readonly baseUrl: string
  readonly databaseName: string
}> {
  override get message(): string {
    return `SpaceTimeDB database ${this.databaseName} remained published after delete at ${this.baseUrl}`
  }
}

export class DevServerJsonDecodeError extends Data.TaggedError(
  "DevServerJsonDecodeError",
)<{
  readonly text: string
  readonly cause: unknown
}> {
  override get message(): string {
    return "Failed to decode SpaceTimeDB dev server JSON response"
  }
}

export type DevServerError =
  | DevServerPortError
  | DevServerBinaryError
  | DevServerCommandError
  | DevServerFileSystemError
  | DevServerHttpError
  | DevServerResponseError
  | DevServerResetVerificationError
  | DevServerJsonDecodeError
