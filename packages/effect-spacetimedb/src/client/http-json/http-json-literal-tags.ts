import {
  stringLiteralGeneratedClientTag,
  stringLiteralSatsVariantTag,
} from "../../contract/literal-tags.ts"
import * as TypeDescriptor from "../../contract/type/descriptor.ts"
import { integerToNumber, isIntegerToken } from "./http-json-parser.ts"

export const stringLiteralWireTags = (
  values: TypeDescriptor.StdbLiteralDescriptor["values"],
):
  | ReadonlyArray<{
      readonly authored: string
      readonly tag: string
      readonly generatedClientTag: string
    }>
  | undefined =>
  values.every((entry) => typeof entry === "string")
    ? (values as ReadonlyArray<string>).map((authored) => ({
        authored,
        tag: stringLiteralSatsVariantTag(authored),
        generatedClientTag: stringLiteralGeneratedClientTag(authored),
      }))
    : undefined

export const normalizeStringLiteralTag = (
  tags: NonNullable<ReturnType<typeof stringLiteralWireTags>>,
  value: string,
): string | undefined => {
  const entry = tags.find(
    (tag) =>
      tag.authored === value ||
      tag.tag === value ||
      tag.generatedClientTag === value,
  )

  return entry?.tag
}

export const literalTagFromIndex = (
  tags: NonNullable<ReturnType<typeof stringLiteralWireTags>>,
  value: unknown,
): string | undefined => {
  const index =
    isIntegerToken(value) ||
    typeof value === "number" ||
    typeof value === "bigint"
      ? integerToNumber(value)
      : undefined
  return index === undefined ? undefined : tags[index]?.tag
}
