import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

const CallableString = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

const InvalidReducer = Stdb.StdbFn.reducer("invalid_reducer", {
  // @ts-expect-error reducer params must be authored with struct(...)
  params: CallableString,
})

const InvalidProcedure = Stdb.StdbFn.procedure("invalid_procedure", {
  // @ts-expect-error procedure params must be authored with struct(...)
  params: CallableString,
  returns: CallableString,
})

void InvalidReducer
void InvalidProcedure
