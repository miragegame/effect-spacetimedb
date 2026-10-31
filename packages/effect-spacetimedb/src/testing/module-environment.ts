import * as Data from "effect/Data"
import {
  type Declarations as EnvironmentDeclarations,
  type SuppliedValueOf,
  valueBytesMax,
} from "../contract/environment.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { EnvironmentOfSpec } from "../server/environment.ts"
import type { ServerEnvironmentReader } from "../server/runtime-types.ts"

/**
 * The harness refused an environment the host would refuse at publish, or a
 * read of a key the module did not declare. Messages name the key and the
 * violated clause, never the value.
 */
export class TestModuleEnvironmentError extends Data.TaggedError(
  "TestModuleEnvironmentError",
)<{
  readonly key: string
  readonly reason:
    | "requiredValueMissing"
    | "valueOutsideDeclaration"
    | "valueTooLong"
    | "undeclaredKey"
}> {
  override get message(): string {
    switch (this.reason) {
      case "requiredValueMissing":
        return `Environment key ${this.key} is required but has no value`
      case "valueOutsideDeclaration":
        return `Environment key ${this.key} has a value outside its declared literal set`
      case "valueTooLong":
        return `Environment key ${this.key} has a value longer than ${valueBytesMax.toString()} UTF-8 bytes`
      case "undeclaredKey":
        return `Environment key ${this.key} is not declared by the module`
    }
  }
}

/**
 * Environment values for the harness, as a publisher supplies them: raw
 * strings (secrets included), literal keys restricted to their declared set.
 * Required keys are checked when the harness is built, like a publish.
 */
export type TestModuleEnvironmentValues<Module extends AnyModuleSpec> = {
  readonly [Key in keyof EnvironmentOfSpec<Module>]?: SuppliedValueOf<
    EnvironmentOfSpec<Module>[Key]
  >
}

/**
 * An environment-only update: supplied keys are replaced, `undefined` deletes
 * an optional key, and omitted keys keep their values.
 */
export type TestModuleEnvironmentUpdate<Module extends AnyModuleSpec> = {
  readonly [Key in keyof EnvironmentOfSpec<Module>]?:
    | SuppliedValueOf<EnvironmentOfSpec<Module>[Key]>
    | undefined
}

const textEncoder = new TextEncoder()

/** Checks a complete environment the way the host checks it before installing. */
const assertEnvironmentAccepted = (
  declarations: EnvironmentDeclarations,
  values: ReadonlyMap<string, string>,
): void => {
  for (const [key, value] of values) {
    if (textEncoder.encode(value).byteLength > valueBytesMax) {
      throw new TestModuleEnvironmentError({ key, reason: "valueTooLong" })
    }
  }
  for (const [key, declaration] of Object.entries(declarations)) {
    const value = values.get(key)
    if (value === undefined) {
      if (!declaration.optional) {
        throw new TestModuleEnvironmentError({
          key,
          reason: "requiredValueMissing",
        })
      }
      continue
    }
    if (declaration.kind === "literal" && !declaration.values.includes(value)) {
      throw new TestModuleEnvironmentError({
        key,
        reason: "valueOutsideDeclaration",
      })
    }
  }
}

// The value types are mapped over the module's declarations; only strings
// reach here, and `undefined` is the explicit "unset" of an update.
const suppliedEnvironmentEntries = (
  values: object | undefined,
): ReadonlyArray<readonly [string, string | undefined]> =>
  Object.entries(values ?? {}).map(
    ([key, value]) =>
      [key, typeof value === "string" ? value : undefined] as const,
  )

/**
 * The harness's environment store with host semantics: values are validated
 * like a publish, reads of undeclared keys throw, and an update is validated
 * atomically before it replaces the values. Reads are never cached.
 */
export const makeTestModuleEnvironment = (
  declarations: EnvironmentDeclarations,
  initial: object | undefined,
): {
  readonly environment: ServerEnvironmentReader
  readonly updateEnvironment: (values: object) => void
} => {
  let values: ReadonlyMap<string, string> = new Map(
    suppliedEnvironmentEntries(initial).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value] as const],
    ),
  )
  assertEnvironmentAccepted(declarations, values)

  return {
    environment: {
      get: (key) => {
        if (!Object.hasOwn(declarations, key)) {
          throw new TestModuleEnvironmentError({ key, reason: "undeclaredKey" })
        }
        return values.get(key) ?? null
      },
    },
    updateEnvironment: (update) => {
      const next = new Map(values)
      for (const [key, value] of suppliedEnvironmentEntries(update)) {
        if (value === undefined) {
          next.delete(key)
        } else {
          next.set(key, value)
        }
      }
      assertEnvironmentAccepted(declarations, next)
      values = next
    },
  }
}
