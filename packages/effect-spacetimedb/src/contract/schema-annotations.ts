import * as AST from "effect/SchemaAST"
import * as Schema from "effect/Schema"

export type SchemaAnnotationId = string | symbol

export const StdbTypeAnnotationId = Symbol.for("effect-spacetimedb/StdbType")
export const StdbTypeInfoAnnotationId = Symbol.for(
  "effect-spacetimedb/StdbTypeInfo",
)
export const StdbFieldOptionsAnnotationId = Symbol.for(
  "effect-spacetimedb/StdbFieldOptions",
)

export const annotateSchema = <A, Encoded, Annotation>(
  schema: Schema.Codec<A, Encoded, never, never>,
  annotationId: SchemaAnnotationId,
  value: Annotation,
): Schema.Codec<A, Encoded, never, never> => {
  if (typeof annotationId === "string") {
    return schema.annotate({
      [annotationId]: value,
    })
  }

  return schema.annotate({
    [annotationId]: value,
  } as never)
}

const ownAnnotation = <Annotation>(
  annotationId: SchemaAnnotationId,
  ast: AST.AST,
): Annotation | undefined =>
  (typeof annotationId === "string"
    ? AST.resolveAt<Annotation>(annotationId)(ast)
    : AST.resolveAt<Annotation>(annotationId as never)(ast)) ?? undefined

export const encodedAst = (ast: AST.AST): AST.AST => AST.toEncoded(ast)

export const annotationInEncodedShape = <Annotation>(
  annotationId: SchemaAnnotationId,
  ast: AST.AST,
): Annotation | undefined => {
  const annotation = ownAnnotation<Annotation>(annotationId, ast)
  if (annotation !== undefined) {
    return annotation
  }

  if (AST.isSuspend(ast)) {
    return annotationInEncodedShape(annotationId, ast.thunk())
  }

  for (const link of ast.encoding ?? []) {
    const encodedAnnotation = annotationInEncodedShape(annotationId, link.to)
    if (encodedAnnotation !== undefined) {
      return encodedAnnotation as Annotation
    }
  }

  return undefined
}
