
import { createServer } from "node:net"
import os from "node:os"
import type * as Cause from "effect/Cause"
import * as Config from "effect/Config"
import * as Data from "effect/Data"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"

export type SpacetimeBinaries = {
  readonly cli: ReadonlyArray<string>
  readonly standalone: ReadonlyArray<string>
}

export type SpacetimeBinarySource =
  | SpacetimeBinaries
  | { readonly resolve: Effect.Effect<SpacetimeBinaries, DevServerError> }

export type DevServerOptions = {
  readonly bundlePath: string
  readonly dbNamePrefix: string
  readonly binaries?: SpacetimeBinarySource
  readonly versionRequirement?: string
  readonly logDir?: string
  readonly cwd?: string
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

const IdentityResponse = Schema.Struct({
  identity: Schema.String,
  token: Schema.String,
})

type IdentityResponse = typeof IdentityResponse.Type

type CapturedCommandOutput = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

const fileSystemError =
  (operation: string, path: string) =>
  (cause: PlatformError.PlatformError): DevServerFileSystemError =>
    new DevServerFileSystemError({ operation, path, cause })

const commandDisplay = (command: string, args: ReadonlyArray<string>): string =>
  [command, ...args].join(" ")

const splitBinaryCommand = (
  binary: ReadonlyArray<string>,
  label: string,
): Effect.Effect<
  readonly [command: string, prefixArgs: ReadonlyArray<string>],
  DevServerBinaryError
> => {
  const [command, ...prefixArgs] = binary
  if (command === undefined || command.length === 0) {
    return Effect.fail(
      new DevServerBinaryError({
        command: label,
        cause: "binary command was empty",
      }),
    )
  }

  return Effect.succeed([command, prefixArgs] as const)
}

const collectTextStream = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  command: string,
) =>
  Stream.runFold(
    Stream.decodeText(stream),
    () => "",
    (current, chunk) => `${current}${chunk}`,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DevServerBinaryError({
          command,
          cause,
        }),
    ),
  )

const runCapturedCommand = (
  command: ChildProcess.Command,
  commandName: string,
): Effect.Effect<
  CapturedCommandOutput,
  DevServerBinaryError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  command.pipe(
    Effect.mapError(
      (cause: PlatformError.PlatformError) =>
        new DevServerBinaryError({
          command: commandName,
          cause,
        }),
    ),
    Effect.flatMap((process) =>
      Effect.all(
        {
          exitCode: process.exitCode.pipe(
            Effect.map(Number),
            Effect.mapError(
              (cause) =>
                new DevServerBinaryError({
                  command: commandName,
                  cause,
                }),
            ),
          ),
          stdout: collectTextStream(process.stdout, commandName),
          stderr: collectTextStream(process.stderr, commandName),
        },
        { concurrency: "unbounded" },
      ),
    ),
    Effect.scoped,
  )

const runCommand = Effect.fn(function* (
  binary: ReadonlyArray<string>,
  args: ReadonlyArray<string>,
  options: ChildProcess.CommandOptions,
) {
  const [command, prefixArgs] = yield* splitBinaryCommand(binary, "command")
  const commandArgs = [...prefixArgs, ...args]
  const rendered = commandDisplay(command, commandArgs)
  const output = yield* runCapturedCommand(
    ChildProcess.make(command, commandArgs, {
      extendEnv: true,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      ...options,
    }),
    rendered,
  )

  if (output.exitCode !== 0) {
    return yield* new DevServerCommandError({
      command: rendered,
      exitCode: output.exitCode,
      stdout: output.stdout,
      stderr: output.stderr,
    })
  }

  return output.stdout
})

const resolveCommandPath = Effect.fn(function* (command: string) {
  if (command.includes("/") || command.length === 0) {
    return command
  }

  return yield* runCommand(["which"], [command], {
    cwd: os.tmpdir(),
  }).pipe(
    Effect.map((output) => output.trim()),
    Effect.map((resolved) => (resolved.length > 0 ? resolved : command)),
    Effect.orElseSucceed(() => command),
  )
})

const standaloneCandidatesForCli = (cliPath: string) => {
  const pathParts = cliPath.split("/")
  const cliFile = pathParts[pathParts.length - 1] ?? "spacetime"
  const extensionIndex = cliFile.lastIndexOf(".")
  const extension = extensionIndex >= 0 ? cliFile.slice(extensionIndex) : ""
  const standaloneName = `spacetimedb-standalone${extension}`
  const cliDir = pathParts.slice(0, -1).join("/") || "."
  const localPrefix = pathParts.slice(0, -2).join("/") || "."

  return [
    `${cliDir}/${standaloneName}`,
    `${localPrefix}/share/spacetime/bin/current/${standaloneName}`,
    "spacetimedb-standalone",
  ]
}

const firstWorkingCommand = Effect.fn(function* (
  candidates: ReadonlyArray<ReadonlyArray<string>>,
  options: ChildProcess.CommandOptions,
) {
  for (const candidate of candidates) {
    const result = yield* runCommand(candidate, ["--version"], options).pipe(
      Effect.result,
    )
    if (Result.isSuccess(result)) {
      return candidate
    }
  }

  return yield* new DevServerBinaryError({
    command: candidates.map((candidate) => candidate.join(" ")).join(", "),
    cause: "none of the candidate commands reported a version",
  })
})

const resolveDefaultBinaries = Effect.fn(function* (cwd: string) {
  const configuredCliConfig = yield* Config.option(
    Config.string("SPACETIME_CLI_BIN"),
  ).pipe(Effect.orElseSucceed(() => Option.none()))
  const configuredCli = Option.getOrUndefined(configuredCliConfig)?.trim()
  const cli =
    configuredCli == null || configuredCli.length === 0
      ? (["spacetime"] as const)
      : ([configuredCli] as const)
  const cliPath = yield* resolveCommandPath(cli[0])
  const standalone = yield* firstWorkingCommand(
    standaloneCandidatesForCli(cliPath).map((candidate) => [candidate]),
    { cwd },
  )

  yield* runCommand(cli, ["--version"], { cwd })

  return {
    cli,
    standalone,
  }
})

const resolveBinaries = Effect.fn(function* (
  source: SpacetimeBinarySource | undefined,
  cwd: string,
) {
  if (source === undefined) {
    return yield* resolveDefaultBinaries(cwd)
  }

  if ("resolve" in source) {
    return yield* source.resolve
  }

  return source
})

const assertBinaryVersion = Effect.fn(function* (
  binary: ReadonlyArray<string>,
  versionRequirement: string | undefined,
  cwd: string,
  label: string,
) {
  if (versionRequirement === undefined) {
    return
  }

  const output = yield* runCommand(binary, ["--version"], { cwd })
  if (output.includes(versionRequirement)) {
    return
  }

  return yield* new DevServerBinaryError({
    command: label,
    cause: `version output did not satisfy ${versionRequirement}: ${output}`,
  })
})

const assertVersionRequirement = Effect.fn(function* (
  binaries: SpacetimeBinaries,
  versionRequirement: string | undefined,
  cwd: string,
) {
  yield* assertBinaryVersion(binaries.cli, versionRequirement, cwd, "spacetime")
  yield* assertBinaryVersion(
    binaries.standalone,
    versionRequirement,
    cwd,
    "spacetimedb-standalone",
  )
})

const reservePort = Effect.callback<number, DevServerPortError>((resume) => {
  const server = createServer()
  server.unref()

  server.once("error", (cause) => {
    resume(Effect.fail(new DevServerPortError({ cause })))
  })

  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    if (address == null || typeof address === "string") {
      resume(
        Effect.fail(
          new DevServerPortError({
            cause: "server did not allocate a TCP address",
          }),
        ),
      )
      return
    }

    server.close((cause) => {
      if (cause != null) {
        resume(Effect.fail(new DevServerPortError({ cause })))
        return
      }

      resume(Effect.succeed(address.port))
    })
  })

  return Effect.try({
    try: () => {
      server.close()
    },
    catch: (cause) =>
      new DevServerPortError({
        cause,
      }),
  }).pipe(Effect.orDie)
})

const packageRoot = Effect.fn(function* () {
  const path = yield* Path.Path
  const configuredRoot = yield* Config.option(
    Config.string("EFFECT_SPACETIMEDB_PACKAGE_ROOT"),
  ).pipe(Effect.orElseSucceed(() => Option.none()))
  const root = Option.getOrUndefined(configuredRoot)?.trim()
  if (root !== undefined && root.length > 0) {
    return root
  }

  return yield* path.fromFileUrl(new URL("../../", import.meta.url)).pipe(
    Effect.mapError(
      (cause) =>
        new DevServerFileSystemError({
          operation: "resolve package root",
          path: import.meta.url,
          cause,
        }),
    ),
  )
})

const makePackageCacheDirectory = Effect.fn(function* (name: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* packageRoot()
  const cacheRoot = path.join(
    root,
    "node_modules",
    ".cache",
    "effect-spacetimedb",
    name,
  )

  yield* fs
    .makeDirectory(cacheRoot, { recursive: true })
    .pipe(Effect.mapError(fileSystemError("mkdir", cacheRoot)))

  return cacheRoot
})

const makeDevServerTempDirectory = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem
  const cacheRoot = yield* makePackageCacheDirectory("dev-server")

  return yield* fs
    .makeTempDirectoryScoped({
      directory: cacheRoot,
      prefix: "runtime-",
    })
    .pipe(Effect.mapError(fileSystemError("mkdtemp", cacheRoot)))
})

const createIdentityOnce = Effect.fn(function* (baseUrl: string) {
  const url = `${baseUrl}/v1/identity`
  const response = yield* HttpClient.post(url).pipe(
    Effect.mapError((cause) => new DevServerHttpError({ url, cause })),
  )
  const text = yield* response.text.pipe(
    Effect.mapError((cause) => new DevServerHttpError({ url, cause })),
  )

  if (response.status < 200 || response.status >= 300) {
    return yield* new DevServerResponseError({
      url,
      status: response.status,
      body: text,
    })
  }

  return yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(IdentityResponse),
  )(text).pipe(
    Effect.mapError(
      (cause) =>
        new DevServerJsonDecodeError({
          text,
          cause,
        }),
    ),
  )
})

const createIdentity = Effect.fn(function* (baseUrl: string) {
  const poll: (
    remaining: number,
  ) => Effect.Effect<IdentityResponse, DevServerError, HttpClient.HttpClient> =
    Effect.fn(function* (remaining: number) {
      const result = yield* createIdentityOnce(baseUrl).pipe(Effect.result)
      if (Result.isSuccess(result)) {
        return result.success
      }

      if (remaining <= 1) {
        return yield* result.failure
      }

      yield* Effect.sleep(Duration.millis(250))
      return yield* poll(remaining - 1)
    })

  return yield* poll(240)
})

const readServerLogTail = Effect.fn(function* (logPath: string) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs
    .readFileString(logPath)
    .pipe(Effect.catchTag("PlatformError", () => Effect.succeed("")))
  const lines = text.split(/\r?\n/u)
  return lines.slice(Math.max(0, lines.length - 80)).join("\n")
})

const annotateServerFailure = <A, R>(
  effect: Effect.Effect<A, DevServerError, R>,
  logPath: string,
) =>
  effect.pipe(
    Effect.tapCause((_cause: Cause.Cause<DevServerError>) =>
      readServerLogTail(logPath).pipe(
        Effect.flatMap((tail) =>
          tail.trim().length === 0
            ? Effect.logError(`SpaceTimeDB standalone server log: ${logPath}`)
            : Effect.logError(
                `SpaceTimeDB standalone server log: ${logPath}\n${tail}`,
              ),
        ),
        Effect.orElseSucceed(() => undefined),
      ),
    ),
  )

const startStandaloneServer = Effect.fn(function* (params: {
  readonly binaries: SpacetimeBinaries
  readonly cwd: string
  readonly dataDir: string
  readonly jwtPrivateKeyPath: string
  readonly jwtPublicKeyPath: string
  readonly logPath: string
  readonly port: number
}) {
  const fs = yield* FileSystem.FileSystem
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const [standaloneCommand, standalonePrefixArgs] = yield* splitBinaryCommand(
    params.binaries.standalone,
    "spacetimedb-standalone",
  )

  yield* fs
    .writeFileString(params.logPath, "")
    .pipe(Effect.mapError(fileSystemError("write", params.logPath)))

  const handle = yield* spawner
    .spawn(
      ChildProcess.make(
        standaloneCommand,
        [
          ...standalonePrefixArgs,
          "start",
          "--listen-addr",
          `127.0.0.1:${params.port.toString()}`,
          "--data-dir",
          params.dataDir,
          "--jwt-pub-key-path",
          params.jwtPublicKeyPath,
          "--jwt-priv-key-path",
          params.jwtPrivateKeyPath,
          "--non-interactive",
        ],
        {
          cwd: params.cwd,
          extendEnv: true,
          forceKillAfter: Duration.seconds(2),
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      ),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new DevServerBinaryError({
            command: "spacetimedb-standalone start",
            cause,
          }),
      ),
    )

  yield* Effect.forkScoped(
    Stream.run(handle.all, fs.sink(params.logPath, { flag: "a" })).pipe(
      Effect.orElseSucceed(() => undefined),
    ),
  )

  return handle
})

const publishModule = Effect.fn(function* (params: {
  readonly baseUrl: string
  readonly binaries: SpacetimeBinaries
  readonly bundlePath: string
  readonly cliRootDir: string
  readonly cwd: string
  readonly databaseName: string
  readonly deleteData: boolean
}) {
  const deleteDataArgs = params.deleteData ? ["--delete-data=always"] : []
  yield* runCommand(
    params.binaries.cli,
    [
      "--root-dir",
      params.cliRootDir,
      "publish",
      params.databaseName,
      "--server",
      params.baseUrl,
      "--js-path",
      params.bundlePath,
      "--yes",
      ...deleteDataArgs,
    ],
    { cwd: params.cwd },
  )
})

const loginCliToDevServer = Effect.fn(function* (params: {
  readonly binaries: SpacetimeBinaries
  readonly cliRootDir: string
  readonly cwd: string
  readonly token: string
}) {
  yield* runCommand(
    params.binaries.cli,
    ["--root-dir", params.cliRootDir, "login", "--token", params.token],
    { cwd: params.cwd },
  )
})

export const makeDevServer: (options: DevServerOptions) => DevServerEffect =
  Effect.fn(function* (options: DevServerOptions) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const cwd = options.cwd ?? os.tmpdir()
    const binaries = yield* resolveBinaries(options.binaries, cwd)
    yield* assertVersionRequirement(binaries, options.versionRequirement, cwd)
    const port = yield* reservePort
    const tempDir = yield* makeDevServerTempDirectory()
    const now = yield* DateTime.now
    const stamp = DateTime.toEpochMillis(now)
    const databaseName = `${options.dbNamePrefix}-${stamp.toString()}-${port.toString()}`
    const baseUrl = `http://127.0.0.1:${port.toString()}`
    const jwtDir = path.join(tempDir, "jwt")
    const dataDir = path.join(tempDir, "data")
    const logDir = options.logDir ?? path.join(tempDir, "logs")
    const logPath = path.join(logDir, `${databaseName}.log`)
    const cliRootDir = path.join(tempDir, "cli")
    const jwtPublicKeyPath = path.join(jwtDir, "jwt_public_key.pem")
    const jwtPrivateKeyPath = path.join(jwtDir, "jwt_private_key.pem")

    yield* fs
      .makeDirectory(jwtDir, { recursive: true })
      .pipe(Effect.mapError(fileSystemError("mkdir", jwtDir)))
    yield* fs
      .makeDirectory(logDir, { recursive: true })
      .pipe(Effect.mapError(fileSystemError("mkdir", logDir)))
    yield* fs
      .makeDirectory(cliRootDir, { recursive: true })
      .pipe(Effect.mapError(fileSystemError("mkdir", cliRootDir)))

    yield* startStandaloneServer({
      binaries,
      cwd,
      dataDir,
      jwtPrivateKeyPath,
      jwtPublicKeyPath,
      logPath,
      port,
    })

    return yield* annotateServerFailure(
      Effect.gen(function* () {
        const identity = yield* createIdentity(baseUrl)
        yield* loginCliToDevServer({
          binaries,
          cliRootDir,
          cwd,
          token: identity.token,
        })
        yield* publishModule({
          baseUrl,
          binaries,
          bundlePath: options.bundlePath,
          cliRootDir,
          cwd,
          databaseName,
          deleteData: true,
        })

        return {
          baseUrl,
          databaseName,
          jwtPrivateKeyPath,
          jwtPublicKeyPath,
          logPath,
          republish: (bundlePath: string) =>
            publishModule({
              baseUrl,
              binaries,
              bundlePath,
              cliRootDir,
              cwd,
              databaseName,
              deleteData: false,
            }),
          token: identity.token,
        } satisfies PublishedModuleRuntime
      }),
      logPath,
    )
  })
