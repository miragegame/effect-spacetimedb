import * as AST from "effect/SchemaAST"
import { encodedAst } from "../schema-annotations.ts"
import type { PrimitiveLiteral } from "./core.ts"

export const literalValueTuple = (
  values: ReadonlyArray<unknown>,
): readonly [PrimitiveLiteral, ...PrimitiveLiteral[]] | undefined =>
  values.length === 0 ||
  values.some(
    (value): value is Exclude<typeof value, PrimitiveLiteral> =>
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean",
  )
    ? undefined
    : (values as readonly [PrimitiveLiteral, ...PrimitiveLiteral[]])

export const flattenUnionMembers = (
  members: ReadonlyArray<AST.AST>,
): ReadonlyArray<AST.AST> =>
  members.flatMap((member) =>
    AST.isUnion(member) ? flattenUnionMembers(member.types) : [member],
  )

export const literalValuesFromAst = (
  ast: AST.AST,
):
  | readonly [string | number | boolean, ...(string | number | boolean)[]]
  | undefined => {
  const normalized = encodedAst(ast)

  if (AST.isLiteral(normalized)) {
    return literalValueTuple([normalized.literal])
  }

  if (!AST.isUnion(normalized)) {
    return undefined
  }

  return literalValueTuple(
    flattenUnionMembers(normalized.types).map((member) =>
      AST.isLiteral(member) ? member.literal : Symbol.for("invalid"),
    ),
  )
}

export const optionMemberAst = (ast: AST.AST): AST.AST | undefined => {
  const normalized = encodedAst(ast)
  if (!AST.isUnion(normalized)) {
    return undefined
  }

  const members = flattenUnionMembers(normalized.types)
  const nonUndefinedMembers = members.filter(
    (member) => !AST.isUndefined(member),
  )

  return nonUndefinedMembers.length === 1 &&
    members.some((member) => AST.isUndefined(member))
    ? nonUndefinedMembers[0]
    : undefined
}

export const arrayRestAst = (ast: AST.AST): AST.AST | undefined => {
  const normalized = encodedAst(ast)
  return AST.isArrays(normalized) &&
    normalized.elements.length === 0 &&
    normalized.rest.length === 1
    ? normalized.rest[0]
    : undefined
}
