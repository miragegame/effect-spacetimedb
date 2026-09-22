import * as Match from "effect/Match"

type LowerAsciiLetter =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z"

type UpperAsciiLetter = Uppercase<LowerAsciiLetter>
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
type Delimiter = "_" | "-" | " "

type AppendSnakeCaseWord<
  Output extends string,
  Word extends string,
> = Word extends ""
  ? Output
  : Output extends ""
    ? Lowercase<Word>
    : `${Output}_${Lowercase<Word>}`

type IsSnakeCaseBoundary<
  Previous extends string,
  Current extends string,
  Next extends string,
> = Previous extends LowerAsciiLetter
  ? Current extends UpperAsciiLetter | Digit
    ? true
    : false
  : Previous extends UpperAsciiLetter
    ? Current extends Digit
      ? true
      : Current extends UpperAsciiLetter
        ? Next extends LowerAsciiLetter
          ? true
          : false
        : false
    : Previous extends Digit
      ? Current extends UpperAsciiLetter | LowerAsciiLetter
        ? true
        : false
      : false

type SnakeCaseNameLoop<
  Input extends string,
  CurrentWord extends string = "",
  Previous extends string = "",
  Output extends string = "",
> = Input extends `${infer Current}${infer Rest}`
  ? Current extends Delimiter
    ? SnakeCaseNameLoop<Rest, "", "", AppendSnakeCaseWord<Output, CurrentWord>>
    : CurrentWord extends ""
      ? SnakeCaseNameLoop<Rest, Current, Current, Output>
      : Rest extends `${infer Next}${string}`
        ? IsSnakeCaseBoundary<Previous, Current, Next> extends true
          ? SnakeCaseNameLoop<
              Rest,
              Current,
              Current,
              AppendSnakeCaseWord<Output, CurrentWord>
            >
          : SnakeCaseNameLoop<Rest, `${CurrentWord}${Current}`, Current, Output>
        : IsSnakeCaseBoundary<Previous, Current, ""> extends true
          ? AppendSnakeCaseWord<
              AppendSnakeCaseWord<Output, CurrentWord>,
              Current
            >
          : AppendSnakeCaseWord<Output, `${CurrentWord}${Current}`>
  : AppendSnakeCaseWord<Output, CurrentWord>

export type SnakeCaseName<Name extends string> = string extends Name
  ? string
  : SnakeCaseNameLoop<Name>

export type CanonicalNameForPolicy<
  Policy extends "none" | "snake_case" | undefined,
  Name extends string,
> = [Policy] extends ["none"] ? Name : SnakeCaseName<Name>

const isDelimiter = (char: string): boolean =>
  char === "_" || char === "-" || char === " "

const isLower = (char: string): boolean => char >= "a" && char <= "z"

const isUpper = (char: string): boolean => char >= "A" && char <= "Z"

const isDigit = (char: string): boolean => char >= "0" && char <= "9"

const isBoundary = (
  previous: string,
  current: string,
  next: string | undefined,
): boolean => {
  if (isLower(previous) && isUpper(current)) {
    return true
  }

  if (isUpper(previous) && isDigit(current)) {
    return true
  }

  if (isDigit(previous) && isUpper(current)) {
    return true
  }

  if (isDigit(previous) && isLower(current)) {
    return true
  }

  if (isLower(previous) && isDigit(current)) {
    return true
  }

  return (
    isUpper(previous) && isUpper(current) && next !== undefined && isLower(next)
  )
}

export const splitWords = (name: string): ReadonlyArray<string> => {
  const words: Array<string> = []
  let current = ""

  for (let index = 0; index < name.length; index += 1) {
    const char = name[index]!
    if (isDelimiter(char)) {
      if (current.length > 0) {
        words.push(current)
        current = ""
      }
      continue
    }

    if (current.length > 0) {
      const previous = current[current.length - 1]!
      if (isBoundary(previous, char, name[index + 1])) {
        words.push(current)
        current = ""
      }
    }

    current += char
  }

  if (current.length > 0) {
    words.push(current)
  }

  return words
}

const capitalizeLower = (word: string): string => {
  const lower = word.toLowerCase()
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`
}

export const snakeCaseName = (name: string): string =>
  splitWords(name)
    .map((word) => word.toLowerCase())
    .join("_")

export const camelCaseName = (name: string): string => {
  const [first, ...rest] = splitWords(name)
  return first === undefined
    ? ""
    : `${first.toLowerCase()}${rest.map(capitalizeLower).join("")}`
}

export const pascalCaseName = (name: string): string =>
  splitWords(name).map(capitalizeLower).join("")

/**
 * Whether a declared contract key is already its own camelCase spelling.
 *
 * This is the single site that makes "contract key = generated-client accessor
 * key" true, so both the runtime lookups and the client types index tables and
 * views by contract key and never touch a deprecated alias.
 *
 * SpacetimeDB's TypeScript generator (`crates/codegen/src/typescript.rs` at
 * v2.10.1) keys `tablesSchema`, `tables` and `DbConnection#db` by
 * `accessor_name.to_case(Case::Camel)` — identically for tables and for views —
 * and keeps the unconverted spelling only as a `@deprecated` alias slated for
 * removal in the next major. The accessor name of a relation is the name our
 * compiler exports it under, i.e. its wire name: the contract key itself under
 * the `none` policy, `snakeCaseName(key)` under `snake_case`.
 *
 * Because every declared name is required to be a camelCase fixed point,
 * `camelCaseName` of either wire spelling returns the contract key unchanged
 * (`splitWords` is stable under lowercase-and-underscore-join), so the mapping
 * from contract key to accessor key is the identity. Only SQL and subscription
 * text keep using the wire name.
 */
export const isCamelCaseCanonical = (name: string): boolean =>
  name === camelCaseName(name)

export const canonicalNameForPolicy = (
  policy: "none" | "snake_case" | undefined,
  name: string,
): string =>
  Match.value(policy).pipe(
    Match.when("none", () => name),
    Match.when("snake_case", () => snakeCaseName(name)),
    Match.when(undefined, () => snakeCaseName(name)),
    Match.exhaustive,
  )
