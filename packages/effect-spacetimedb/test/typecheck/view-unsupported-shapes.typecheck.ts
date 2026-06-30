import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

const ViewString = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

const MissingVisibilityView =
  // views default to public when not specified in the grouped API
  Stdb.StdbFn.anonymousView("hidden_view", {
    returns: Stdb.array(ViewString),
  })

const UnsupportedParameterizedView = Stdb.StdbFn.view("user_by_id", {
  public: true,
  // @ts-expect-error parameterized views remain outside the supported authored surface because the current public upstream compiler API still does not support them
  params: Stdb.struct({
    userId: ViewString,
  }),
  returns: Stdb.option(ViewString),
})

void MissingVisibilityView
void UnsupportedParameterizedView
