import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { testViewRowsLength } from "../helpers/array-bounds"

const ViewString = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

const PlainView = Stdb.Fn.anonymousView("plain_view", {
  returns: Stdb.array(ViewString, testViewRowsLength),
})

const UnstructuredParamsView = Stdb.Fn.view("user_by_id", {
  // @ts-expect-error view params are a struct of named arguments
  params: ViewString,
  returns: Stdb.option(ViewString),
})

void PlainView
void UnstructuredParamsView
