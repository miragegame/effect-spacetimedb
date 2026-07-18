import * as Schema from "effect/Schema"
import type * as AST from "effect/SchemaAST"
import { type AnyValueType, makeValueType } from "./core.ts"
import { narrowSchema } from "./wire-schema.ts"

export const valueSchemaFromAst = (ast: AST.AST): AnyValueType =>
  makeValueType(narrowSchema<unknown, unknown>(Schema.make(ast)), "custom")
