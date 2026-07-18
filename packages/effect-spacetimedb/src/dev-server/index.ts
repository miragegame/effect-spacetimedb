
import { createServer } from "node:net"
import os from "node:os"
import type * as Cause from "effect/Cause"
import * as Config from "effect/Config"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { runCommand, splitBinaryCommand } from "./command.ts"
import {
  type ClearMode,
  DevServerBinaryError,
  type DevServerEffect,
  type DevServerError,
  DevServerFileSystemError,
  DevServerHttpError,
  DevServerJsonDecodeError,
  type DevServerOptions,
  DevServerPortError,
  DevServerResponseError,
  DevServerResetVerificationError,
  type ModuleLifecycle,
  type ModuleLifecycleOptions,
  type PublishedModuleRuntime,
  type SpacetimeBinaries,
  type SpacetimeBinarySource,
} from "./model.ts"

export * from "./model.ts"

const IdentityResponse = Schema.Struct({
  identity: Schema.String,
  token: Schema.String,
})

type IdentityResponse = typeof IdentityResponse.Type

const fileSystemError =
  (operation: string, path: string) =>
  (cause: PlatformError.PlatformError): DevServerFileSystemError =>
    new DevServerFileSystemError({ operation, path, cause })

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
  readonly clearMode: ClearMode
}) {
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
      `--delete-data=${params.clearMode}`,
    ],
    { cwd: params.cwd },
  )
})

const lifecycleRequest = Effect.fn(function* (params: {
  readonly url: string
  readonly token?: string | undefined
}) {
  const request = HttpClientRequest.get(params.url).pipe(
    params.token === undefined
      ? (request) => request
      : HttpClientRequest.bearerToken(params.token),
  )
  const response = yield* HttpClient.execute(request).pipe(
    Effect.mapError(
      (cause) => new DevServerHttpError({ url: params.url, cause }),
    ),
  )
  const body = yield* response.text.pipe(
    Effect.mapError(
      (cause) => new DevServerHttpError({ url: params.url, cause }),
    ),
  )
  return { body, status: response.status }
})

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const indicatesMissingDatabase = (
  body: string,
  databaseName: string,
): boolean => {
  const normalized = body.replace(/\u001b\[[0-9;]*m/gu, "").toLowerCase()
  const escapedName = escapeRegularExpression(databaseName.toLowerCase())
  const optionalQuote = "[`'\"]?"
  const qualifiedDatabaseMissing = new RegExp(
    `\\bdatabase\\s+${optionalQuote}${escapedName}${optionalQuote}\\s+(?:was\\s+)?(?:not found|does not exist)\\b`,
    "u",
  )
  return (
    normalized.includes("database not found") ||
    normalized.includes("no such database") ||
    normalized.includes("unknown database") ||
    normalized.includes(
      `failed to find database \`${databaseName.toLowerCase()}\``,
    ) ||
    qualifiedDatabaseMissing.test(normalized)
  )
}

const isMissingDatabaseResponse = (
  status: number,
  body: string,
  databaseName: string,
): boolean =>
  ([400, 404, 500] as const).includes(status as 400 | 404 | 500) &&
  indicatesMissingDatabase(body, databaseName)

export const makeModuleLifecycle = (
  options: ModuleLifecycleOptions,
): ModuleLifecycle => {
  const cwd = options.cwd ?? os.tmpdir()
  const cliRootDir = options.cliRootDir ?? cwd
  const baseUrl = options.baseUrl.replace(/\/$/u, "")
  const status: ModuleLifecycle["status"] = () =>
    Effect.gen(function* () {
      const pingUrl = `${baseUrl}/v1/ping`
      const ping = yield* lifecycleRequest({
        url: pingUrl,
        token: options.token,
      })
      if (ping.status < 200 || ping.status >= 300) {
        return yield* new DevServerResponseError({
          url: pingUrl,
          status: ping.status,
          body: ping.body,
        })
      }
      const identityUrl = `${baseUrl}/v1/database/${encodeURIComponent(options.databaseName)}/identity`
      const identity = yield* lifecycleRequest({
        url: identityUrl,
        token: options.token,
      })
      if (
        isMissingDatabaseResponse(
          identity.status,
          identity.body,
          options.databaseName,
        )
      ) {
        return { reachable: true, published: false }
      }
      const databaseIdentity = identity.body.trim()
      if (
        identity.status < 200 ||
        identity.status >= 300 ||
        databaseIdentity.length === 0
      ) {
        return yield* new DevServerResponseError({
          url: identityUrl,
          status: identity.status,
          body: identity.body,
        })
      }

      const databaseUrl = `${baseUrl}/v1/database/${encodeURIComponent(options.databaseName)}`
      const database = yield* lifecycleRequest({
        url: databaseUrl,
        token: options.token,
      })
      if (
        isMissingDatabaseResponse(
          database.status,
          database.body,
          options.databaseName,
        )
      ) {
        return { reachable: true, published: false }
      }
      if (database.status < 200 || database.status >= 300) {
        return yield* new DevServerResponseError({
          url: databaseUrl,
          status: database.status,
          body: database.body,
        })
      }
      return { reachable: true, published: true, databaseIdentity }
    })
  const reset: ModuleLifecycle["reset"] = Effect.fn(function* (
    resetOptions: Parameters<ModuleLifecycle["reset"]>[0],
  ) {
    const binaries = yield* resolveBinaries(options.binaries, cwd)
    if (options.token !== undefined) {
      yield* loginCliToDevServer({
        binaries,
        cliRootDir,
        cwd,
        token: options.token,
      })
    }
    yield* runCommand(
      binaries.cli,
      [
        "--root-dir",
        cliRootDir,
        "delete",
        "--yes",
        "--server",
        baseUrl,
        options.databaseName,
      ],
      { cwd },
    ).pipe(
      Effect.catchTags({
        DevServerCommandError: (error) =>
          indicatesMissingDatabase(
            `${error.stdout}\n${error.stderr}`,
            options.databaseName,
          )
            ? Effect.void
            : error,
      }),
    )
    const bundlePath = resetOptions?.bundlePath ?? options.bundlePath
    if (bundlePath !== undefined) {
      const deletionStatus = yield* status()
      if (deletionStatus.published) {
        return yield* new DevServerResetVerificationError({
          baseUrl,
          databaseName: options.databaseName,
        })
      }
      yield* publishModule({
        baseUrl,
        binaries,
        bundlePath,
        cliRootDir,
        cwd,
        databaseName: options.databaseName,
        clearMode: "never",
      })
    }
  })
  return { reset, status }
}

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
    {
      displayArgs: [
        "--root-dir",
        params.cliRootDir,
        "login",
        "--token",
        "<redacted>",
      ],
      sensitiveValues: [params.token],
    },
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
          clearMode: options.clear?.firstPublish ?? "always",
        })

        const lifecycle = makeModuleLifecycle({
          baseUrl,
          databaseName,
          token: identity.token,
          binaries,
          bundlePath: options.bundlePath,
          cliRootDir,
          cwd,
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
              clearMode: options.clear?.republish ?? "never",
            }),
          status: lifecycle.status,
          reset: lifecycle.reset,
          token: identity.token,
        } satisfies PublishedModuleRuntime
      }),
      logPath,
    )
  })
