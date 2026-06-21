import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as AST from "effect/SchemaAST"
import * as SchemaIssue from "effect/SchemaIssue"

export type ParseIssue = SchemaIssue.Issue
export type ParseError = Schema.SchemaError

export class Type extends SchemaIssue.InvalidValue {
  constructor(_ast: AST.AST, actual: unknown, message?: string) {
    super(Option.some(actual), message === undefined ? undefined : { message })
  }
}

export class Unexpected extends SchemaIssue.InvalidValue {
  constructor(actual: unknown) {
    super(Option.some(actual))
  }
}

export const parseError = (issue: SchemaIssue.Issue): Schema.SchemaError =>
  new Schema.SchemaError(issue)
