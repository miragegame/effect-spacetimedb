import os from "node:os"
import * as Config from "effect/Config"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as ChildProcess from "effect/process/ChildProcess"
import { runCommand } from "./command.ts"
import {
  type ClearMode,
  DevServerBinaryError,
  DevServerDatabaseNameInUseError,
  type DevServerEffect,
  type DevServerEnvironmentValues,
  DevServerHttpError,
  type DevServerOptions,
  DevServerResponseError,
  type ModuleLifecycle,
  type ModuleLifecycleOptions,
  type PublishDatabaseOptions,
  type PublishedDatabase,
  type PublishedModuleRuntime,
  type SpacetimeBinaries,
  type SpacetimeBinarySource,
} from "./model.ts"

import {
  currentProcessEnvironment,
  deleteDatabase,
  indicatesMissingDatabase,
  loginCliToDevServer,
  mergeEnvironment,
  preparePublishEnvironment,
  type PublishedValuesCoverage,
  publishEnvironmentOnly,
  publishModule,
} from "./publish.ts"

import {
  annotateServerFailure,
  createIdentity,
  fileSystemError,
  makeDevServerTempDirectory,
  reservePort,
  standaloneEnvironmentWithProxyExemption,
  startStandaloneServer,
} from "./standalone.ts"

export * from "./model.ts"
export { publishEnvironmentOnly } from "./publish.ts"

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

const workingCommandFirst = Effect.fn(function* (
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
    Config.String("SPACETIME_CLI_BIN"),
  ).pipe(Effect.orElseSucceed(() => Option.none()))
  const configuredCli = Option.getOrUndefined(configuredCliConfig)?.trim()
  const cli =
    configuredCli == null || configuredCli.length === 0
      ? (["spacetime"] as const)
      : ([configuredCli] as const)
  const cliPath = yield* resolveCommandPath(cli[0])
  const standalone = yield* workingCommandFirst(
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

const isMissingDatabaseResponse = (
  status: number,
  body: string,
  databaseName: string,
): boolean =>
  ([400, 404, 500] as const).includes(status as 400 | 404 | 500) &&
  indicatesMissingDatabase(body, databaseName)

// `GET /v1/database/<name>/identity` answers the identity as bare hex.
const databaseIdentityPattern = /^[0-9a-fA-F]{64}$/u

const readDatabaseIdentity = Effect.fn(function* (params: {
  readonly baseUrl: string
  readonly databaseName: string
  readonly token: string
}) {
  const url = `${params.baseUrl}/v1/database/${encodeURIComponent(params.databaseName)}/identity`
  const response = yield* lifecycleRequest({ url, token: params.token })
  const identity = response.body.trim()
  if (
    response.status < 200 ||
    response.status >= 300 ||
    !databaseIdentityPattern.test(identity)
  ) {
    return yield* new DevServerResponseError({
      url,
      status: response.status,
      body: response.body,
    })
  }
  return identity
})

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
  const reset: ModuleLifecycle["reset"] = Effect.fn(function* (resetOptions) {
    const binaries = yield* resolveBinaries(options.binaries, cwd)
    const bundlePath = resetOptions?.bundlePath ?? options.bundlePath
    // With a bundle, the reset is one clearing publish: the host's own reset,
    // which builds the bundle and runs its `init` with the replacement values
    // before it deletes anything, so any refusal (an `init` failure included)
    // keeps the database and its stored values. The replacement values must
    // be complete, since the reset stores exactly them; checking them here
    // against the bundle's declarations is an early, typed refusal.
    const publishEnvironment =
      bundlePath === undefined
        ? undefined
        : yield* preparePublishEnvironment({
            binaries,
            bundle: { bundlePath, coverage: "complete" },
            cwd,
            supplied: resetOptions?.environment ?? options.environment ?? {},
            processEnvironment:
              options.processEnvironment ?? currentProcessEnvironment(),
          })
    if (options.token !== undefined) {
      yield* loginCliToDevServer({
        binaries,
        cliRootDir,
        cwd,
        token: options.token,
      })
    }
    if (bundlePath === undefined || publishEnvironment === undefined) {
      // Nothing to republish: the reset is a plain delete.
      return yield* deleteDatabase({
        baseUrl,
        binaries,
        cliRootDir,
        cwd,
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
      clearMode: "always",
      publishEnvironment,
    })
  })
  return { reset, status }
}

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
    const processEnvironment =
      options.processEnvironment ?? currentProcessEnvironment()

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
      standaloneEnvironment: standaloneEnvironmentWithProxyExemption(
        options.standaloneEnvironment,
        processEnvironment,
      ),
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
        // `supplied` keys come from the call and must be declared by the
        // bundle; `carried` keys are tracked values being resupplied, and any
        // the bundle no longer declares are dropped rather than refused.
        const publish = Effect.fn(function* (params: {
          readonly databaseName: string
          readonly bundlePath: string
          readonly clearMode: ClearMode
          readonly coverage: PublishedValuesCoverage
          readonly supplied: DevServerEnvironmentValues
          readonly carried?: DevServerEnvironmentValues | undefined
        }) {
          const prepared = yield* preparePublishEnvironment({
            binaries,
            bundle: {
              bundlePath: params.bundlePath,
              coverage: params.coverage,
            },
            cwd,
            supplied: params.supplied,
            carried: params.carried,
            processEnvironment,
          })
          const cleared = yield* publishModule({
            baseUrl,
            binaries,
            bundlePath: params.bundlePath,
            cliRootDir,
            cwd,
            databaseName: params.databaseName,
            clearMode: params.clearMode,
            publishEnvironment: prepared,
          })
          return { cleared, published: prepared.published }
        })

        // The names of the databases this runtime holds on its standalone.
        const heldNames = yield* Ref.make<ReadonlySet<string>>(new Set())
        const release = (name: string) =>
          Ref.update(heldNames, (held) => {
            const next = new Set(held)
            next.delete(name)
            return next
          })
        const hold = Effect.fn(function* (name: string) {
          const held = yield* Ref.get(heldNames)
          if (held.has(name)) {
            return yield* new DevServerDatabaseNameInUseError({
              databaseName: name,
            })
          }
          yield* Ref.set(heldNames, new Set([...held, name]))
        })

        const publishNewDatabase = Effect.fn(function* (
          params: PublishDatabaseOptions,
        ) {
          const name = params.databaseName
          yield* hold(name)
          // A new database: the values are all it will store.
          const first = yield* publish({
            databaseName: name,
            bundlePath: params.bundlePath,
            clearMode: params.clear?.publishFirst ?? "always",
            coverage: "complete",
            supplied: params.environment ?? {},
          }).pipe(Effect.onError(() => release(name)))
          const databaseIdentity = yield* readDatabaseIdentity({
            baseUrl,
            databaseName: name,
            token: identity.token,
          })
          // The values this database stores so far. A publish that may clear
          // data resupplies them, since `--delete-data` deletes stored values
          // along with everything else.
          const currentEnvironment =
            yield* Ref.make<DevServerEnvironmentValues>(first.published)
          // Only `status` is used; `reset` goes through `publish` above.
          const lifecycle = makeModuleLifecycle({
            baseUrl,
            databaseName: name,
            token: identity.token,
            binaries,
          })
          const republishClearMode = params.clear?.republish ?? "never"

          return {
            databaseName: name,
            databaseIdentity,
            republish: Effect.fn(function* (
              bundlePath: string,
              republishOptions?: {
                readonly environment?: DevServerEnvironmentValues | undefined
              },
            ) {
              const supplied = republishOptions?.environment ?? {}
              const current = yield* Ref.get(currentEnvironment)
              // `never` keeps every stored value, so only this call's values
              // are supplied; a publish that may clear resupplies the tracked
              // ones.
              const { cleared, published } = yield* publish({
                databaseName: name,
                bundlePath,
                clearMode: republishClearMode,
                coverage:
                  republishClearMode === "always" ? "complete" : "supplied",
                supplied,
                carried: republishClearMode === "never" ? undefined : current,
              })
              // A cleared database stores exactly what was published;
              // otherwise the published values land on top of what it kept.
              yield* Ref.set(
                currentEnvironment,
                cleared ? published : mergeEnvironment(current, published),
              )
            }),
            updateEnvironment: Effect.fn(function* (
              values: DevServerEnvironmentValues,
              updateOptions?: {
                readonly unset?: ReadonlyArray<string> | undefined
              },
            ) {
              const unset = updateOptions?.unset ?? []
              yield* publishEnvironmentOnly({
                baseUrl,
                binaries,
                cliRootDir,
                cwd,
                databaseName: name,
                environment: values,
                processEnvironment,
                unset,
              })
              yield* Ref.update(currentEnvironment, (current) =>
                mergeEnvironment(current, values, unset),
              )
            }),
            status: lifecycle.status,
            reset: Effect.fn(function* (resetOptions?: {
              readonly bundlePath?: string | undefined
              readonly environment?: DevServerEnvironmentValues | undefined
            }) {
              // One clearing publish, the host's own reset (see
              // `ModuleLifecycle.reset`): it stores exactly the published
              // values, and only once it succeeded, so a refused reset keeps
              // the old ones.
              const replacement = resetOptions?.environment
              const current = yield* Ref.get(currentEnvironment)
              const { published } = yield* publish({
                databaseName: name,
                bundlePath: resetOptions?.bundlePath ?? params.bundlePath,
                clearMode: "always",
                coverage: "complete",
                supplied: replacement ?? {},
                carried: replacement === undefined ? current : undefined,
              })
              yield* Ref.set(currentEnvironment, published)
            }),
            remove: Effect.fn(function* () {
              yield* deleteDatabase({
                baseUrl,
                binaries,
                cliRootDir,
                cwd,
                databaseName: name,
              })
              yield* release(name)
            }),
          } satisfies PublishedDatabase
        })

        const first = yield* publishNewDatabase({
          bundlePath: options.bundlePath,
          databaseName,
          environment: options.environment,
          clear: options.clear,
        })

        return {
          ...first,
          baseUrl,
          jwtPrivateKeyPath,
          jwtPublicKeyPath,
          logPath,
          token: identity.token,
          publishDatabase: (databaseOptions: PublishDatabaseOptions) =>
            annotateServerFailure(
              publishNewDatabase(databaseOptions),
              logPath,
            ).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
        } satisfies PublishedModuleRuntime
      }),
      logPath,
    )
  })
