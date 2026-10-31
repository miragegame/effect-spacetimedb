import { createServer } from "node:net"
import type * as Cause from "effect/Cause"
import * as Config from "effect/Config"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/http/HttpClient"
import * as ChildProcess from "effect/process/ChildProcess"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import { splitBinaryCommand } from "./command.ts"
import {
  DevServerBinaryError,
  type DevServerError,
  DevServerFileSystemError,
  DevServerHttpError,
  DevServerJsonDecodeError,
  DevServerPortError,
  type DevServerProcessEnvironment,
  DevServerResponseError,
  type SpacetimeBinaries,
  standaloneProxyExemptHost,
} from "./model.ts"

// The standalone server process a dev server runs: its port, scratch
// directories, environment, readiness and log.

const IdentityResponse = Schema.Struct({
  identity: Schema.String,
  token: Schema.String,
})

type IdentityResponse = typeof IdentityResponse.Type

export const fileSystemError =
  (operation: string, path: string) =>
  (cause: PlatformError.PlatformError): DevServerFileSystemError =>
    new DevServerFileSystemError({ operation, path, cause })

export const reservePort = Effect.callback<number, DevServerPortError>(
  (resume) => {
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
  },
)

const packageRoot = Effect.fn(function* () {
  const path = yield* Path.Path
  const configuredRoot = yield* Config.option(
    Config.String("EFFECT_SPACETIMEDB_PACKAGE_ROOT"),
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
  const cacheRoot = path.join(root, ".tmp", "effect-spacetimedb", name)

  yield* fs
    .makeDirectory(cacheRoot, { recursive: true })
    .pipe(Effect.mapError(fileSystemError("mkdir", cacheRoot)))

  return cacheRoot
})

export const makeDevServerTempDirectory = Effect.fn(function* () {
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

export const createIdentity = Effect.fn(function* (baseUrl: string) {
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

export const annotateServerFailure = <A, R>(
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

const proxyExemptionKeys = ["NO_PROXY", "no_proxy"] as const

/**
 * The standalone's own variables, with `localhost` added to the proxy
 * exemption list it inherits unless `supplied` sets that list itself: the
 * server posts inter-database calls to `http://localhost:<port>` and honors
 * the standard proxy variables, so a proxied server would hand them to the
 * proxy.
 */
export const standaloneEnvironmentWithProxyExemption = (
  supplied: Readonly<Record<string, string>> | undefined,
  inherited: DevServerProcessEnvironment,
): Readonly<Record<string, string>> => {
  if (proxyExemptionKeys.some((key) => Object.hasOwn(supplied ?? {}, key))) {
    return supplied ?? {}
  }
  const hosts = proxyExemptionKeys
    .flatMap((key) => (inherited[key] ?? "").split(","))
    .map((host) => host.trim())
    .filter((host) => host.length > 0)
  const exempt = [
    ...new Set([
      ...hosts,
      ...(hosts.some((host) => host.toLowerCase() === standaloneProxyExemptHost)
        ? []
        : [standaloneProxyExemptHost]),
    ]),
  ].join(",")
  return { ...supplied, NO_PROXY: exempt, no_proxy: exempt }
}

export const startStandaloneServer = Effect.fn(function* (params: {
  readonly binaries: SpacetimeBinaries
  readonly cwd: string
  readonly dataDir: string
  readonly jwtPrivateKeyPath: string
  readonly jwtPublicKeyPath: string
  readonly logPath: string
  readonly port: number
  readonly standaloneEnvironment: Readonly<Record<string, string>>
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
          env: params.standaloneEnvironment,
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
