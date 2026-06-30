import * as Predicate from "effect/Predicate"
import { prefixId } from "./utils.ts"

export const errorTypeId = <Tag extends string>(tag: Tag) =>
  Symbol.for(prefixId(`error/${tag}`))

export const hasErrorTypeId =
  <Error>(typeId: symbol) =>
  (error: unknown): error is Error =>
    Predicate.hasProperty(error, typeId)

export const readTaggedErrorTag = (value: unknown): string | undefined =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  typeof value._tag === "string"
    ? value._tag
    : undefined
