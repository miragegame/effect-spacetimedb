import type * as Redacted from "effect/Redacted"

/**
 * Database environment declarations.
 *
 * A module declares the environment keys it reads; values are supplied by the
 * publisher (CLI process environment or `spacetime.json`, or
 * `spacetime-environment` headers over HTTP), validated by the host before
 * `init` or a migration runs, and kept across publishes. Every value is a
 * string. A declaration accepts any string, a secret string (surfaced as
 * `Redacted`), or one string out of a fixed literal set, and may be optional.
 */

/** Keys must match this pattern (SpacetimeDB's environment key grammar). */
export const keyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u

/** Host limit on the UTF-8 length of one key. */
export const keyBytesMax = 256

/** Host limit on the UTF-8 length of one value, which also bounds literals. */
export const valueBytesMax = 8 * 1024

/** Host limit on the number of declarations a module may make. */
export const declarationCountMax = 256

/** Host limit on the allowed values of one literal set (`MAX_ENV_UNION_ENTRIES`). */
export const unionEntryCountMax = 256

/**
 * Host limit on a module's whole declaration schema (`MAX_ENV_SCHEMA_BYTES`):
 * the UTF-8 bytes of every key and every allowed literal, counted in
 * declaration order.
 */
export const schemaBytesMax = 2 * 1024 * 1024

export type StringDeclaration<Optional extends boolean = boolean> = {
  readonly kind: "string"
  readonly optional: Optional
}

/**
 * A string whose value surfaces as `Redacted<string>` at read time, so logs,
 * spans and error messages print `<redacted>` instead of the value. Secrets are
 * still stored in plain text in the private `st_env` table, which the database
 * owner can read.
 */
export type SecretDeclaration<Optional extends boolean = boolean> = {
  readonly kind: "secret"
  readonly optional: Optional
}

/** A non-empty set of allowed strings. */
export type LiteralValues = readonly [string, ...ReadonlyArray<string>]

export type LiteralDeclaration<
  Values extends LiteralValues = LiteralValues,
  Optional extends boolean = boolean,
> = {
  readonly kind: "literal"
  readonly values: Values
  readonly optional: Optional
}

export type Declaration =
  | StringDeclaration
  | SecretDeclaration
  | LiteralDeclaration

export type Declarations = { readonly [key: string]: Declaration }

/** The value a declared key holds when present. */
export type PresentValueOf<D> = D extends {
  readonly kind: "secret"
}
  ? Redacted.Redacted<string>
  : D extends {
        readonly kind: "literal"
        readonly values: ReadonlyArray<infer Value>
      }
    ? Value
    : string

/** What a read of the declared key yields: absent optional values are `undefined`. */
export type ValueOf<D> = D extends {
  readonly optional: true
}
  ? PresentValueOf<D> | undefined
  : PresentValueOf<D>

/**
 * The raw string a publisher supplies for a declared key. Secrets are supplied
 * as strings too; redaction applies to what module code reads.
 */
export type SuppliedValueOf<D> = D extends {
  readonly kind: "literal"
  readonly values: ReadonlyArray<infer Value>
}
  ? Value
  : string

/** Any string. */
export const string = (): StringDeclaration<false> => ({
  kind: "string",
  optional: false,
})

/** Any string, read back as `Redacted<string>`. */
export const secret = (): SecretDeclaration<false> => ({
  kind: "secret",
  optional: false,
})

/** One string out of a fixed, non-empty set. One value pins the key to it. */
export const literal = <const Values extends LiteralValues>(
  ...values: Values
): LiteralDeclaration<Values, false> => ({
  kind: "literal",
  values,
  optional: false,
})

/** Permits the key to be absent; a read then yields `undefined`. */
export function optional<const Values extends LiteralValues>(
  declaration: LiteralDeclaration<Values, false>,
): LiteralDeclaration<Values, true>
export function optional(
  declaration: SecretDeclaration<false>,
): SecretDeclaration<true>
export function optional(
  declaration: StringDeclaration<false>,
): StringDeclaration<true>
export function optional(declaration: Declaration): Declaration {
  return { ...declaration, optional: true }
}
