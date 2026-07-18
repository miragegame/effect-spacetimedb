import * as AST from "effect/SchemaAST"
import {
  annotationInEncodedShape,
  encodedAst,
  StdbFieldOptionsAnnotationId,
} from "../schema-annotations.ts"
import type { AnyNormalizedStructFieldOptions, AnyValueType } from "./core.ts"
import { hasTypeKind, typeInfo } from "./metadata.ts"
import type { FieldOptionsAnnotation } from "./shapes.ts"

export const structFieldOptions = (
  value: AnyValueType,
): AnyNormalizedStructFieldOptions => ({
  optional:
    annotationInEncodedShape<FieldOptionsAnnotation>(
      StdbFieldOptionsAnnotationId,
      value.schema.ast,
    )?.optional === true,
})

export const hasOptionalFieldOption = (value: AnyValueType): boolean =>
  structFieldOptions(value).optional

export const isOptionValueType = (value: AnyValueType): boolean =>
  hasTypeKind(typeInfo(value), "option")

export const isUnitValueType = (value: AnyValueType): boolean => {
  if (hasTypeKind(typeInfo(value), "unit")) {
    return true
  }

  const ast = encodedAst(value.schema.ast)
  return AST.isVoid(ast)
}

export const astIsAuthoredVoid = (ast: AST.AST): boolean => {
  if (AST.isVoid(ast) || AST.isUndefined(ast)) {
    return true
  }

  return AST.isSuspend(ast) && astIsAuthoredVoid(ast.thunk())
}

export const isAuthoredUnitValueType = (value: AnyValueType): boolean =>
  hasTypeKind(typeInfo(value), "unit") || astIsAuthoredVoid(value.schema.ast)
