import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import type {
  Declaration,
  Declarations,
  ValueOf,
} from "../contract/environment.ts"
import type { AnyModuleSpec } from "../contract/module.ts"

/**
 * The host environment reader every native context carries as `ctx.env`. The
 * library reads through `get` only: it returns the stored string, or `null`
 * for an absent optional value, and throws for an undeclared key.
 */
export type ServerEnvironmentReader = {
  readonly get: (key: string) => string | null
}

export type EnvironmentOfSpec<Module> = Module extends {
  readonly environment?: infer Environment extends Declarations
}
  ? Environment
  : {}

/**
 * Each declared key is an effect that reads the host when it runs. Reads are
 * never cached: inside a transaction a read sees the transaction's snapshot,
 * and in a procedure outside one every read is its own snapshot. Yield several
 * keys inside one transaction to read them consistently.
 */
export type EnvServiceFor<Environment extends Declarations> = {
  readonly [Key in keyof Environment]: Effect.Effect<ValueOf<Environment[Key]>>
}

export type EnvService<Module extends AnyModuleSpec> = EnvServiceFor<
  EnvironmentOfSpec<Module>
>

export type AnyEnvService = {
  readonly [key: string]: Effect.Effect<unknown>
}

/**
 * The host failed to read a declared key. The host validated the environment
 * at publish and every key the service exposes is declared, so this is the
 * host breaking its own contract, not an outside input.
 */
export class StdbEnvironmentHostReadDefect extends Data.TaggedError(
  "StdbEnvironmentHostReadDefect",
)<{
  readonly key: string
  readonly cause: unknown
}> {
  override get message(): string {
    return `SpaceTimeDB failed to read the declared environment key ${this.key}`
  }
}

/**
 * The host returned a value its own publish-time validation should have
 * refused. The message names the key and the violated clause, never the value.
 */
export class StdbEnvironmentValueDefect extends Data.TaggedError(
  "StdbEnvironmentValueDefect",
)<{
  readonly key: string
  readonly reason: "requiredValueAbsent" | "valueOutsideDeclaration"
}> {
  override get message(): string {
    switch (this.reason) {
      case "requiredValueAbsent":
        return `SpaceTimeDB returned no value for the required environment key ${this.key}`
      case "valueOutsideDeclaration":
        return `SpaceTimeDB returned a value outside the declared literal set for environment key ${this.key}`
    }
  }
}

type EnvironmentSource = {
  readonly env: ServerEnvironmentReader
}

const presentValue = (
  key: string,
  declaration: Declaration,
  value: string,
): Effect.Effect<unknown> => {
  switch (declaration.kind) {
    case "string":
      return Effect.succeed(value)
    case "secret":
      return Effect.succeed(Redacted.make(value, { label: key }))
    case "literal":
      return declaration.values.includes(value)
        ? Effect.succeed(value)
        : Effect.die(
            new StdbEnvironmentValueDefect({
              key,
              reason: "valueOutsideDeclaration",
            }),
          )
  }
}

const readDeclared = (
  source: EnvironmentSource,
  key: string,
  declaration: Declaration,
): Effect.Effect<unknown> =>
  Effect.try({
    try: () => source.env.get(key),
    catch: (cause) => new StdbEnvironmentHostReadDefect({ key, cause }),
  }).pipe(
    Effect.orDie,
    Effect.flatMap((value) => {
      if (typeof value === "string") {
        return presentValue(key, declaration, value)
      }
      return declaration.optional
        ? Effect.void
        : Effect.die(
            new StdbEnvironmentValueDefect({
              key,
              reason: "requiredValueAbsent",
            }),
          )
    }),
  )

const emptyEnvService: AnyEnvService = Object.freeze({})

/**
 * Prepares the per-call `Env` service for one module. The returned function
 * runs once per callable invocation and binds that call's context; it reads
 * `source.env` only when a key is yielded, so a module that declares nothing
 * never touches the host environment. A transaction body is bound to the
 * transaction context's reader (an HTTP transaction to its handler's, the
 * host's single accessor), so reads made while the transaction is open see its
 * snapshot.
 */
export const makeEnvServiceFactory = (
  environment: Declarations | undefined,
): ((source: EnvironmentSource) => AnyEnvService) => {
  const entries = Object.entries(environment ?? {})
  if (entries.length === 0) {
    return () => emptyEnvService
  }

  return (source) =>
    Object.freeze(
      Object.fromEntries(
        entries.map(([key, declaration]) => [
          key,
          readDeclared(source, key, declaration),
        ]),
      ),
    )
}
