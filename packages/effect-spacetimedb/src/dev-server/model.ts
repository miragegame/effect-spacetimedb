import * as Data from "effect/Data"
import { declarationCountMax, valueBytesMax } from "../contract/environment.ts"
import type * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import type * as Path from "effect/Path"
import type * as Redacted from "effect/Redacted"
import type * as Scope from "effect/Scope"
import type * as HttpClient from "effect/http/HttpClient"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"

export type SpacetimeBinaries = {
  readonly cli: ReadonlyArray<string>
  readonly standalone: ReadonlyArray<string>
}

export type SpacetimeBinarySource =
  | SpacetimeBinaries
  | { readonly resolve: Effect.Effect<SpacetimeBinaries, DevServerError> }

export type ClearMode = "never" | "on-conflict" | "always"

/**
 * The process variables a publishing CLI inherits so it can run and find its
 * schema extractor. `LD_LIBRARY_PATH` is among them because a release binary
 * whose shared libraries sit outside the loader's default search path (an
 * image that links them into `/lib` under Nix's loader, for one) cannot start
 * without it. The CLI clears the environment of the extractor it starts, so an
 * extractor that needs the path is reached through
 * `SPACETIMEDB_SCHEMA_EXTRACTOR` instead. Nothing else is inherited. The CLI
 * publishes any process variable named like a key the module declares, so none
 * of these names may be a database environment key when publishing through
 * the dev server: a supplied value or a module declaration with one of them is
 * refused with `DevServerReservedEnvironmentKeyError` (compared
 * case-insensitively, as Windows compares environment names).
 */
export const environmentKeysReserved = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "LD_LIBRARY_PATH",
  "SPACETIMEDB_SCHEMA_EXTRACTOR",
] as const

/**
 * Database environment values for a publish, keyed by declared key. The CLI
 * forwards only keys the published bundle declares, so a publish with a bundle
 * refuses any other supplied key (`keyNotDeclared`) rather than letting its
 * value vanish. Pass secrets as `Redacted` so command diagnostics print
 * `<redacted>` in their place. The publishing CLI receives only these values: its process
 * environment is built from scratch, never inherited, because a shell
 * variable named like a declared key would otherwise be published, and it
 * runs with `--no-config`, so no `spacetime.json` contributes values either.
 * The one exception is the reserved base variables in
 * `environmentKeysReserved`, which no key may be named after.
 */
export type DevServerEnvironmentValues = {
  readonly [key: string]: string | Redacted.Redacted<string>
}

/**
 * Where the reserved base variables are read from. Defaults to the current
 * process's environment; tests inject one.
 */
export type DevServerProcessEnvironment = {
  readonly [name: string]: string | undefined
}

export type DevServerOptions = {
  readonly bundlePath: string
  readonly dbNamePrefix: string
  /**
   * Values for the module's declared environment. The first publish and every
   * publish that may clear data (`--delete-data`, which also deletes stored
   * values) supply the current values, dropping any the bundle being
   * published no longer declares; a `never` republish supplies only what its
   * own call passes, and the database keeps the rest.
   */
  readonly environment?: DevServerEnvironmentValues | undefined
  /** Source of the CLI's reserved base variables; defaults to `process.env`. */
  readonly processEnvironment?: DevServerProcessEnvironment | undefined
  /**
   * Variables set on the standalone server process, over the environment it
   * inherits (not to be confused with `environment`, the module's database
   * values, or `processEnvironment`, the CLI's base variables). The server's
   * outbound HTTP from a procedure honors the standard proxy variables, which
   * is how a test routes it through an HTTP proxy: SpacetimeDB refuses
   * private and loopback destinations, and checks the request's own
   * destination, not a proxy on loopback.
   *
   * The server's inter-database calls honor those variables too, and they are
   * posted to `http://localhost:<port>`, so unless these variables set
   * `NO_PROXY` or `no_proxy` themselves, the server gets both set to the
   * inherited exemption list plus `localhost` (`standaloneProxyExemptHost`).
   * That opens no egress: SpacetimeDB refuses a procedure fetch to
   * `localhost` or to a loopback address itself, before any proxy.
   */
  readonly standaloneEnvironment?: Readonly<Record<string, string>> | undefined
  readonly binaries?: SpacetimeBinarySource
  readonly versionRequirement?: string
  readonly logDir?: string
  readonly cwd?: string
  readonly clear?: {
    readonly publishFirst?: ClearMode | undefined
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
  /**
   * The complete set of values `reset` installs: the reset clears every stored
   * value and stores exactly these. Checked against the bundle first; unused
   * when there is no bundle, where `reset` only deletes.
   */
  readonly environment?: DevServerEnvironmentValues | undefined
  /** Source of the CLI's reserved base variables; defaults to `process.env`. */
  readonly processEnvironment?: DevServerProcessEnvironment | undefined
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
  /**
   * Clears the database. With a bundle this is one clearing publish
   * (`--delete-data=always`), the host's own reset: it builds the bundle and
   * runs its `init` with the replacement values before it deletes anything,
   * keeps the database's identity, and on any refusal leaves the database and
   * its stored values as they were. Without a bundle it deletes the database.
   */
  readonly reset: (options?: {
    readonly bundlePath?: string | undefined
    /** Replaces the lifecycle's configured environment for this reset. */
    readonly environment?: DevServerEnvironmentValues | undefined
  }) => Effect.Effect<
    void,
    DevServerError,
    ChildProcessSpawner.ChildProcessSpawner
  >
}

/**
 * The host the dev server exempts from every standalone's proxy: inter-database
 * calls are posted to `http://localhost:<port>`.
 */
export const standaloneProxyExemptHost = "localhost"

/**
 * One database on a dev server's standalone. A runtime is its first database
 * (`makeDevServer`); `publishDatabase` adds more beside it, which is how two
 * databases reach each other through inter-database calls: the host delivers
 * them only between databases on one standalone.
 */
export type PublishedDatabase = {
  readonly databaseName: string
  /**
   * The database's identity, as hex: what a peer database targets and admits.
   * A clearing publish (`reset`) keeps it, and so does `remove` followed by a
   * new publish under the same name: the standalone keeps the name's record,
   * so the database comes back with its old identity and no state.
   */
  readonly databaseIdentity: string
  /**
   * Publishes a bundle over the running database. With the default `never`
   * clear mode only `options.environment` is supplied and every other stored
   * value is kept; a republish that may clear also resupplies the current
   * values the new bundle still declares. The runtime then tracks exactly the
   * published values if the database was cleared (`always`, or `on-conflict`
   * when the CLI clears for a manual migration), and otherwise adds them to
   * what it tracked.
   */
  readonly republish: (
    bundlePath: string,
    options?: {
      readonly environment?: DevServerEnvironmentValues | undefined
    },
  ) => Effect.Effect<
    void,
    DevServerError,
    ChildProcessSpawner.ChildProcessSpawner
  >
  /**
   * An environment-only update (`spacetime publish --env-only`): no module is
   * built or uploaded and neither `init` nor a migration runs. Supplied keys
   * are replaced, `unset` deletes optional or undeclared keys, and the host
   * validates the result atomically; a refusal leaves the values unchanged.
   * With no bundle at hand the deployed declarations are not checked here:
   * the CLI forwards only keys the deployed module declares and silently
   * drops any other.
   */
  readonly updateEnvironment: (
    values: DevServerEnvironmentValues,
    options?: {
      readonly unset?: ReadonlyArray<string> | undefined
    },
  ) => Effect.Effect<
    void,
    DevServerError,
    ChildProcessSpawner.ChildProcessSpawner
  >
  readonly status: ModuleLifecycle["status"]
  /**
   * Resets the database with its first bundle (see `ModuleLifecycle.reset`),
   * resupplying the current values the bundle declares unless `environment`
   * replaces them. The runtime adopts the published values only once the
   * reset succeeded.
   *
   * Reset databases that call each other together: a database keeps its
   * identity through a reset, so resetting one side of an inter-database
   * stream leaves the other side's record of it in place.
   */
  readonly reset: ModuleLifecycle["reset"]
  /**
   * Deletes the database (one already gone counts as deleted) and frees its
   * name for a later `publishDatabase`.
   */
  readonly remove: () => Effect.Effect<
    void,
    DevServerError,
    ChildProcessSpawner.ChildProcessSpawner
  >
}

export type PublishDatabaseOptions = {
  readonly bundlePath: string
  /**
   * The database's name on the runtime's standalone. A name the runtime holds
   * (its first database's, or one published and not removed) is refused.
   */
  readonly databaseName: string
  /** Values for the module's declared environment, as `DevServerOptions.environment`. */
  readonly environment?: DevServerEnvironmentValues | undefined
  /** Clear modes for this database, as `DevServerOptions.clear`. */
  readonly clear?: DevServerOptions["clear"]
}

export type PublishedModuleRuntime = PublishedDatabase & {
  readonly baseUrl: string
  readonly jwtPrivateKeyPath: string
  readonly jwtPublicKeyPath: string
  readonly logPath: string
  /** The owner token of every database the runtime publishes. */
  readonly token: string
  /** Publishes another database on the runtime's standalone. */
  readonly publishDatabase: (
    options: PublishDatabaseOptions,
  ) => Effect.Effect<
    PublishedDatabase,
    DevServerError,
    ChildProcessSpawner.ChildProcessSpawner | HttpClient.HttpClient
  >
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

export class DevServerEnvironmentKeyError extends Data.TaggedError(
  "DevServerEnvironmentKeyError",
)<{
  readonly key: string
}> {
  override get message(): string {
    return `Environment key "${this.key}" must match [A-Za-z_][A-Za-z0-9_]*`
  }
}

export class DevServerReservedEnvironmentKeyError extends Data.TaggedError(
  "DevServerReservedEnvironmentKeyError",
)<{
  readonly key: string
  readonly origin: "supplied" | "declared"
}> {
  override get message(): string {
    const subject =
      this.origin === "supplied"
        ? `Supplied environment key "${this.key}"`
        : `The module's environment key "${this.key}"`
    return `${subject} is reserved by the dev server: the publishing CLI inherits a process variable of that name and would publish its value for the key`
  }
}

/**
 * The values a publish would supply break the bundle's own declarations: the
 * host would refuse them, or (for an undeclared key) the CLI would silently
 * not publish the value. Raised before anything is published. The message
 * names the key and the clause, never the value.
 */
export class DevServerEnvironmentValueError extends Data.TaggedError(
  "DevServerEnvironmentValueError",
)<{
  readonly key: string
  readonly reason:
    | "keyNotDeclared"
    | "requiredValueMissing"
    | "valueOutsideDeclaration"
    | "valueTooLong"
    | "tooManyValues"
}> {
  override get message(): string {
    switch (this.reason) {
      case "keyNotDeclared":
        return `Environment key ${this.key} is not declared by the bundle, so the CLI would not publish its value`
      case "requiredValueMissing":
        return `Environment key ${this.key} is required by the module but no value is supplied`
      case "valueOutsideDeclaration":
        return `Environment key ${this.key} has a value outside its declared literal set`
      case "valueTooLong":
        return `Environment key ${this.key} has a value longer than ${valueBytesMax.toString()} UTF-8 bytes`
      case "tooManyValues":
        return `The environment supplies more than ${declarationCountMax.toString()} values (first over the limit: ${this.key})`
    }
  }
}

export class DevServerDatabaseNameInUseError extends Data.TaggedError(
  "DevServerDatabaseNameInUseError",
)<{
  readonly databaseName: string
}> {
  override get message(): string {
    return `Database ${this.databaseName} is already published by this dev server; remove it before publishing that name again`
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
  | DevServerJsonDecodeError
  | DevServerEnvironmentKeyError
  | DevServerReservedEnvironmentKeyError
  | DevServerEnvironmentValueError
  | DevServerDatabaseNameInUseError
