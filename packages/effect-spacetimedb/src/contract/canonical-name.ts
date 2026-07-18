import * as Match from "effect/Match"

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
