import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as AST from "effect/SchemaAST"

export const httpWireCodec = <S extends Schema.Top>(
  schema: S,
): Schema.Codec<Schema.Schema.Type<S>, string, never, never> =>
  schema.pipe(
    Schema.toCodecJson,
    Schema.fromJsonString,
  ) as unknown as Schema.Codec<Schema.Schema.Type<S>, string, never, never>

const schemaAst = (schema: unknown): AST.AST | undefined =>
  typeof schema === "object" && schema !== null && "ast" in schema
    ? (schema as { readonly ast: AST.AST }).ast
    : undefined

export const isHttpEmptySchema = (schema: unknown): boolean => {
  const ast = schemaAst(schema)
  return ast !== undefined && (AST.isVoid(ast) || AST.isUndefined(ast))
}

const emptyBodyCodec = <S extends Schema.Top>(
  schema: S,
): Schema.Codec<S["Type"], unknown, never, never> =>
  schema as unknown as Schema.Codec<S["Type"], unknown, never, never>

export const decodeEmptyHttpBody = <S extends Schema.Top>(
  schema: S,
): Effect.Effect<S["Type"], Schema.SchemaError> =>
  Schema.decodeUnknownEffect(emptyBodyCodec(schema))(undefined)

export const encodeEmptyHttpBody = <S extends Schema.Top>(
  schema: S,
  value: unknown,
): Effect.Effect<void, Schema.SchemaError> =>
  Schema.encodeEffect(emptyBodyCodec(schema))(value as S["Type"]).pipe(
    Effect.asVoid,
  )
