import * as Schema from "effect/Schema"
import * as SchemaIssue from "effect/SchemaIssue"

export type ParseIssue = SchemaIssue.Issue
export type ParseError = Schema.SchemaError

/**
 * Effect gates the rejected input on the parser's `reportInput` option, but
 * these issues are hand-built by the STDB wire codec rather than produced by a
 * schema parse, so there are no caller options to honour. The wire value is the
 * only thing that makes a wire decode failure debuggable and it has always been
 * attached, so retention is requested explicitly.
 */
const retainWireInput = { reportInput: true } as const

export class Type extends SchemaIssue.InvalidValue {
  constructor(actual: unknown, message?: string) {
    super(
      message === undefined ? undefined : { message },
      actual,
      retainWireInput,
    )
  }
}

export class Unexpected extends SchemaIssue.InvalidValue {
  constructor(actual: unknown) {
    super(undefined, actual, retainWireInput)
  }
}

export const parseError = (issue: SchemaIssue.Issue): Schema.SchemaError =>
  new Schema.SchemaError(issue)
