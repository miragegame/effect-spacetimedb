import { pascalCaseName } from "./canonical-name.ts"

const SpaceTimeDbAsciiIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/

export type StringLiteralTagCollision = {
  readonly first: string
  readonly second: string
  readonly collisionTag: string
  readonly firstGeneratedClientTag: string
  readonly secondGeneratedClientTag: string
}

export type InvalidStringLiteralTag = {
  readonly authored: string
  readonly schemaTag: string
}

export const isSpaceTimeDbAsciiIdentifier = (value: string): boolean =>
  SpaceTimeDbAsciiIdentifier.test(value)

export const stringLiteralSatsVariantTag = (authored: string): string =>
  isSpaceTimeDbAsciiIdentifier(authored) ? authored : pascalCaseName(authored)

export const stringLiteralGeneratedClientTag = (authored: string): string =>
  pascalCaseName(stringLiteralSatsVariantTag(authored))

export const findInvalidStringLiteralTag = (
  values: ReadonlyArray<string>,
): InvalidStringLiteralTag | undefined => {
  for (const authored of values) {
    const schemaTag = stringLiteralSatsVariantTag(authored)
    if (!isSpaceTimeDbAsciiIdentifier(schemaTag)) {
      return {
        authored,
        schemaTag,
      }
    }
  }

  return undefined
}

export const findStringLiteralTagCollision = (
  values: ReadonlyArray<string>,
): StringLiteralTagCollision | undefined => {
  const seen = new Map<
    string,
    {
      readonly authored: string
      readonly generatedClientTag: string
    }
  >()

  for (const authored of values) {
    const generatedClientTag = stringLiteralGeneratedClientTag(authored)
    const keys = new Set([authored, generatedClientTag])

    for (const key of keys) {
      const previous = seen.get(key)
      if (previous !== undefined) {
        return {
          first: previous.authored,
          second: authored,
          collisionTag: key,
          firstGeneratedClientTag: previous.generatedClientTag,
          secondGeneratedClientTag: generatedClientTag,
        }
      }

      if (previous === undefined) {
        seen.set(key, {
          authored,
          generatedClientTag,
        })
      }
    }
  }

  return undefined
}

export const stringLiteralTagCollisionMessage = (
  collision: StringLiteralTagCollision,
): string =>
  collision.firstGeneratedClientTag === collision.secondGeneratedClientTag
    ? `String literal values ${collision.first} and ${collision.second} both map to generated-client variant tag ${collision.firstGeneratedClientTag}`
    : `String literal values ${collision.first} and ${collision.second} collide across authored/generated-client variant tag ${collision.collisionTag}`

export const invalidStringLiteralTagMessage = (
  invalid: InvalidStringLiteralTag,
): string =>
  `String literal value ${invalid.authored} maps to invalid SpaceTimeDB enum variant tag ${invalid.schemaTag}; use a value that maps to an ASCII identifier`
