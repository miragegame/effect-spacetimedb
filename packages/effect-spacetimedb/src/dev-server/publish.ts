import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import {
  declarationCountMax,
  keyPattern as environmentKeyPattern,
  unionEntryCountMax,
  valueBytesMax,
} from "../contract/environment.ts"
import { runCommand } from "./command.ts"
import {
  type ClearMode,
  DevServerBinaryError,
  DevServerEnvironmentKeyError,
  DevServerEnvironmentValueError,
  type DevServerEnvironmentValues,
  DevServerJsonDecodeError,
  type DevServerProcessEnvironment,
  DevServerReservedEnvironmentKeyError,
  environmentKeysReserved,
  type SpacetimeBinaries,
} from "./model.ts"

export const cliConfigArg = (cliRootDir: string): string =>
  `--config-path=${cliRootDir.replace(/[\\/]+$/u, "")}/cli.toml`

export const loginCliToDevServer = Effect.fn(function* (params: {
  readonly binaries: SpacetimeBinaries
  readonly cliRootDir: string
  readonly cwd: string
  readonly token: string
}) {
  yield* runCommand(
    params.binaries.cli,
    [cliConfigArg(params.cliRootDir), "login", "--token", params.token],
    { cwd: params.cwd },
    {
      displayArgs: [
        cliConfigArg(params.cliRootDir),
        "login",
        "--token",
        "<redacted>",
      ],
      sensitiveValues: [params.token],
    },
  )
})

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

export const indicatesMissingDatabase = (
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

/** Deletes the database; one that is already gone counts as deleted. */
export const deleteDatabase = Effect.fn(function* (params: {
  readonly baseUrl: string
  readonly binaries: SpacetimeBinaries
  readonly cliRootDir: string
  readonly cwd: string
  readonly databaseName: string
}) {
  yield* runCommand(
    params.binaries.cli,
    [
      cliConfigArg(params.cliRootDir),
      "delete",
      "--yes",
      "--no-config",
      "--server",
      params.baseUrl,
      params.databaseName,
    ],
    { cwd: params.cwd },
  ).pipe(
    Effect.catchTags({
      DevServerCommandError: (error) =>
        indicatesMissingDatabase(
          `${error.stdout}\n${error.stderr}`,
          params.databaseName,
        )
          ? Effect.void
          : error,
    }),
  )
})

const environmentKeysReservedUpper = new Set<string>(
  environmentKeysReserved.map((name) => name.toUpperCase()),
)

// Windows compares environment names case-insensitively, so `Path` or
// `systemroot` would collide there just as `PATH` does everywhere.
const isReservedKey = (key: string): boolean =>
  environmentKeysReservedUpper.has(key.toUpperCase())

/**
 * The reserved base variables the CLI inherits, read from the process
 * environment itself rather than an ambient `ConfigProvider`, which a host
 * application may back with something other than the process environment.
 */
const cliEnvironmentBase = (
  processEnvironment: DevServerProcessEnvironment,
): Record<string, string> =>
  Object.fromEntries(
    environmentKeysReserved.flatMap((name) => {
      const value = processEnvironment[name]
      return value === undefined || value.length === 0 ? [] : [[name, value]]
    }),
  )

export const currentProcessEnvironment = (): DevServerProcessEnvironment =>
  globalThis.process.env

/**
 * The bound on reading a bundle's declarations; it matches the CLI's own bound
 * on the same schema extraction.
 */
export const schemaExtractionDurationMax = Duration.seconds(60)

/** The CLI's own cap on the extracted schema it will read (16 MiB). */
export const schemaExtractionBytesMax = 16 * 1024 * 1024

// Raw module definitions hold a dozen section kinds; environments are bounded
// by the host's declaration limit.
const moduleDefSectionCountMax = 64

const ExtractedModuleDef = Schema.Struct({
  V10: Schema.Struct({
    sections: Schema.Array(Schema.Unknown).check(
      Schema.isBetweenLength(0, moduleDefSectionCountMax),
    ),
  }),
})

// `EnvVarType` as SATS serde writes it: a unit variant is `[]`.
const ExtractedType = Schema.Union([
  Schema.Struct({ String: Schema.Tuple([]) }),
  Schema.Struct({ StringLiteral: Schema.String }),
  Schema.Struct({
    Union: Schema.Array(Schema.String).check(
      Schema.isBetweenLength(1, unionEntryCountMax),
    ),
  }),
])

const ExtractedDeclaration = Schema.Struct({
  name: Schema.String,
  ty: ExtractedType,
  optional: Schema.Boolean,
})

type ExtractedDeclaration = typeof ExtractedDeclaration.Type

// Every section that carries an `Environment` key must have this shape; one
// that does not is a decode failure, never a skipped section, so a drift in
// the extractor's output cannot silently disable the checks below.
const EnvironmentSections = Schema.Array(
  Schema.Struct({
    Environment: Schema.Array(ExtractedDeclaration).check(
      Schema.isBetweenLength(0, declarationCountMax),
    ),
  }),
).check(Schema.isBetweenLength(0, moduleDefSectionCountMax))

const decodeExtractedModuleDef = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ExtractedModuleDef),
)
const decodeEnvironmentSections =
  Schema.decodeUnknownEffect(EnvironmentSections)

const carriesEnvironment = (section: unknown): boolean =>
  Predicate.hasProperty(section, "Environment")

/**
 * The environment a bundle declares, read with the same
 * `spacetimedb-standalone extract-schema` the CLI runs before publishing.
 */
const declaredEnvironment = Effect.fn(function* (params: {
  readonly binaries: SpacetimeBinaries
  readonly bundlePath: string
  readonly cwd: string
  readonly env: Record<string, string>
}) {
  const output = yield* runCommand(
    params.binaries.standalone,
    ["extract-schema", params.bundlePath, "--host-type", "js"],
    { cwd: params.cwd, extendEnv: false, env: params.env },
    { stdoutBytesMax: schemaExtractionBytesMax },
  ).pipe(
    Effect.timeoutOrElse({
      duration: schemaExtractionDurationMax,
      orElse: () =>
        Effect.fail(
          new DevServerBinaryError({
            command: "spacetimedb-standalone extract-schema",
            cause: `schema extraction exceeded ${Duration.format(schemaExtractionDurationMax)}`,
          }),
        ),
    }),
  )
  const decodeError = (cause: unknown) =>
    new DevServerJsonDecodeError({ text: output.slice(0, 2_000), cause })
  const moduleDef = yield* decodeExtractedModuleDef(output).pipe(
    Effect.mapError(decodeError),
  )
  const sections = yield* decodeEnvironmentSections(
    moduleDef.V10.sections.filter(carriesEnvironment),
  ).pipe(Effect.mapError(decodeError))
  return sections.flatMap((section) => section.Environment)
})

const checkSuppliedKeys = (
  keys: ReadonlyArray<string>,
): Effect.Effect<
  void,
  DevServerEnvironmentKeyError | DevServerReservedEnvironmentKeyError
> => {
  const invalid = keys.find((key) => !environmentKeyPattern.test(key))
  if (invalid !== undefined) {
    return Effect.fail(new DevServerEnvironmentKeyError({ key: invalid }))
  }
  const reserved = keys.find(isReservedKey)
  return reserved === undefined
    ? Effect.void
    : Effect.fail(
        new DevServerReservedEnvironmentKeyError({
          key: reserved,
          origin: "supplied",
        }),
      )
}

const textEncoder = new TextEncoder()

const allowsValue = (ty: ExtractedDeclaration["ty"], value: string) =>
  "StringLiteral" in ty
    ? ty.StringLiteral === value
    : "Union" in ty
      ? ty.Union.includes(value)
      : true

/**
 * What the publish will store: exactly the supplied values (`complete`, a new
 * or cleared database) or the supplied values on top of what the database
 * keeps (`supplied`, so required keys may already be stored).
 */
export type PublishedValuesCoverage = "complete" | "supplied"

/**
 * Mirrors the host's `validate_values` (`crates/lib/src/environment.rs`) for
 * the values a publish supplies: the value count, each value's size, literal
 * membership for declared keys, then (for `complete`) every required key.
 */
const environmentValueProblem = (
  declarations: ReadonlyArray<ExtractedDeclaration>,
  values: Readonly<Record<string, string>>,
  coverage: PublishedValuesCoverage,
): DevServerEnvironmentValueError | undefined => {
  const entries = Object.entries(values)
  if (entries.length > declarationCountMax) {
    return new DevServerEnvironmentValueError({
      key: entries.at(declarationCountMax)?.[0] ?? "",
      reason: "tooManyValues",
    })
  }
  const byName = new Map(
    declarations.map((declared) => [declared.name, declared]),
  )
  for (const [key, value] of entries) {
    if (textEncoder.encode(value).byteLength > valueBytesMax) {
      return new DevServerEnvironmentValueError({ key, reason: "valueTooLong" })
    }
    const declared = byName.get(key)
    if (declared !== undefined && !allowsValue(declared.ty, value)) {
      return new DevServerEnvironmentValueError({
        key,
        reason: "valueOutsideDeclaration",
      })
    }
  }
  if (coverage === "supplied") {
    return undefined
  }
  const missing = declarations.find(
    (declared) => !declared.optional && !Object.hasOwn(values, declared.name),
  )
  return missing === undefined
    ? undefined
    : new DevServerEnvironmentValueError({
        key: missing.name,
        reason: "requiredValueMissing",
      })
}

export type PublishEnvironment = {
  readonly env: Record<string, string>
  readonly sensitiveValues: ReadonlyArray<string>
}

/** The supplied values as the child sees them, plus what to redact. */
const revealEnvironment = (
  values: DevServerEnvironmentValues,
): PublishEnvironment => {
  const entries = Object.entries(values).map(
    ([key, value]) =>
      [
        key,
        Redacted.isRedacted(value) ? Redacted.value(value) : value,
        Redacted.isRedacted(value),
      ] as const,
  )
  return {
    env: Object.fromEntries(entries.map(([key, value]) => [key, value])),
    sensitiveValues: entries.flatMap(([, value, sensitive]) =>
      sensitive ? [value] : [],
    ),
  }
}

export type PreparedPublish = PublishEnvironment & {
  /**
   * The values the CLI will actually publish: with a bundle, only keys it
   * declares (the CLI forwards nothing else). What the runtime tracks after a
   * successful publish is derived from this, never from the raw request.
   */
  readonly published: DevServerEnvironmentValues
}

const pickKeys = (
  values: DevServerEnvironmentValues,
  keep: (key: string) => boolean,
): DevServerEnvironmentValues =>
  Object.fromEntries(Object.entries(values).filter(([key]) => keep(key)))

/**
 * Builds the publishing CLI's environment from scratch: the reserved base
 * variables plus exactly the values to publish. Before anything is published
 * it refuses a malformed or reserved key and, when a bundle is given, a
 * reserved declared key, a `supplied` key the bundle does not declare (the CLI
 * forwards only declared keys, so its value would silently vanish), and any
 * value the host's own validation would refuse against those declarations.
 * `carried` values (what the runtime resupplies from earlier calls) are
 * filtered to the declared keys instead of refused. Redacted values are
 * unwrapped for the child only and registered for redaction in every
 * diagnostic.
 */
export const preparePublishEnvironment = Effect.fn(function* (params: {
  readonly binaries: SpacetimeBinaries
  readonly bundle:
    | {
        readonly bundlePath: string
        readonly coverage: PublishedValuesCoverage
      }
    | undefined
  readonly cwd: string
  readonly supplied: DevServerEnvironmentValues
  readonly carried?: DevServerEnvironmentValues | undefined
  readonly processEnvironment: DevServerProcessEnvironment
}) {
  const requested = { ...params.carried, ...params.supplied }
  yield* checkSuppliedKeys(Object.keys(requested))
  const base = cliEnvironmentBase(params.processEnvironment)
  let published: DevServerEnvironmentValues = requested
  if (params.bundle !== undefined) {
    const declarations = yield* declaredEnvironment({
      binaries: params.binaries,
      bundlePath: params.bundle.bundlePath,
      cwd: params.cwd,
      env: base,
    })
    const reserved = declarations.find((declared) =>
      isReservedKey(declared.name),
    )
    if (reserved !== undefined) {
      return yield* new DevServerReservedEnvironmentKeyError({
        key: reserved.name,
        origin: "declared",
      })
    }
    const declaredNames = new Set(declarations.map((declared) => declared.name))
    const undeclared = Object.keys(params.supplied).find(
      (key) => !declaredNames.has(key),
    )
    if (undeclared !== undefined) {
      return yield* new DevServerEnvironmentValueError({
        key: undeclared,
        reason: "keyNotDeclared",
      })
    }
    published = pickKeys(requested, (key) => declaredNames.has(key))
    const problem = environmentValueProblem(
      declarations,
      revealEnvironment(published).env,
      params.bundle.coverage,
    )
    if (problem !== undefined) {
      return yield* problem
    }
  }

  const revealed = revealEnvironment(published)
  return {
    env: { ...base, ...revealed.env },
    sensitiveValues: revealed.sensitiveValues,
    published,
  } satisfies PreparedPublish
})

export const mergeEnvironment = (
  current: DevServerEnvironmentValues,
  supplied: DevServerEnvironmentValues,
  unset: ReadonlyArray<string> = [],
): DevServerEnvironmentValues =>
  Object.fromEntries(
    Object.entries({ ...current, ...supplied }).filter(
      ([key]) => !unset.includes(key),
    ),
  )

// What the CLI prints when an `on-conflict` publish needs a manual migration
// and clears the database instead (`apply_pre_publish_if_needed` in
// `crates/cli/src/subcommands/publish.rs`, v2.12.0). Nothing else in its output
// says whether the stored values survived.
const onConflictClearedLine =
  "Proceeding with database clear due to --delete-data=on-conflict."

/**
 * Publishes the bundle and succeeds with whether the publish cleared the
 * database, which deletes its stored values too: always for `always`, never
 * for `never`, and for `on-conflict` only when the CLI took the clearing path.
 *
 * `--no-config`: a `spacetime.json` above `cwd` would otherwise contribute its
 * `env` map (declared or not) and could retarget the command.
 */
export const publishModule = Effect.fn(function* (params: {
  readonly baseUrl: string
  readonly binaries: SpacetimeBinaries
  readonly bundlePath: string
  readonly cliRootDir: string
  readonly cwd: string
  readonly databaseName: string
  readonly clearMode: ClearMode
  readonly publishEnvironment: PublishEnvironment
}) {
  const stdout = yield* runCommand(
    params.binaries.cli,
    [
      cliConfigArg(params.cliRootDir),
      "publish",
      params.databaseName,
      "--server",
      params.baseUrl,
      "--no-config",
      "--js-path",
      params.bundlePath,
      "--yes",
      `--delete-data=${params.clearMode}`,
    ],
    { cwd: params.cwd, extendEnv: false, env: params.publishEnvironment.env },
    { sensitiveValues: params.publishEnvironment.sensitiveValues },
  )
  switch (params.clearMode) {
    case "always":
      return true
    case "never":
      return false
    case "on-conflict":
      return stdout.includes(onConflictClearedLine)
  }
})

/**
 * An environment-only publish. The deployed module's declarations were
 * checked when this runtime published it, so only the supplied keys are
 * checked here.
 */
export const publishEnvironmentOnly = Effect.fn(function* (params: {
  readonly baseUrl: string
  readonly binaries: SpacetimeBinaries
  readonly cliRootDir: string
  readonly cwd: string
  readonly databaseName: string
  readonly environment: DevServerEnvironmentValues
  readonly processEnvironment: DevServerProcessEnvironment
  readonly unset: ReadonlyArray<string>
}) {
  const invalidUnset = params.unset.find(
    (key) => !environmentKeyPattern.test(key),
  )
  if (invalidUnset !== undefined) {
    return yield* new DevServerEnvironmentKeyError({ key: invalidUnset })
  }
  const publishEnvironment = yield* preparePublishEnvironment({
    binaries: params.binaries,
    bundle: undefined,
    cwd: params.cwd,
    supplied: params.environment,
    processEnvironment: params.processEnvironment,
  })
  yield* runCommand(
    params.binaries.cli,
    [
      cliConfigArg(params.cliRootDir),
      "publish",
      params.databaseName,
      "--server",
      params.baseUrl,
      "--no-config",
      "--env-only",
      "--yes",
      ...params.unset.flatMap((key) => ["--unset-env", key]),
    ],
    { cwd: params.cwd, extendEnv: false, env: publishEnvironment.env },
    { sensitiveValues: publishEnvironment.sensitiveValues },
  )
})
