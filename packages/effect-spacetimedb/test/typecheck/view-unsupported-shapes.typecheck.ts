import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { testViewRowsLength } from "../helpers/array-bounds"

const ViewString = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

const MissingVisibilityView =
  // views default to public when not specified in the grouped API
  Stdb.StdbFn.anonymousView("hidden_view", {
    returns: Stdb.array(ViewString, testViewRowsLength),
  })

const UnstructuredParamsView = Stdb.StdbFn.view("user_by_id", {
  public: true,
  // @ts-expect-error view params are a struct of named arguments
  params: ViewString,
  returns: Stdb.option(ViewString),
})

void MissingVisibilityView
void UnstructuredParamsView
