import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

const StructFieldString = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

const Params = Stdb.struct({
  id: StructFieldString,
  child: Stdb.optional(StructFieldString),
})

type ParamsType = Stdb.TypeOf<typeof Params>

const withoutChild: ParamsType = {
  id: "user-1",
}

const withChild: ParamsType = {
  id: "user-1",
  child: "Ada",
}

const LegacyParams = Stdb.struct({
  child: Stdb.option(StructFieldString),
})

// @ts-expect-error Type.option(...) in a struct field no longer makes the property itself optional
const legacyWithoutChild: Stdb.TypeOf<typeof LegacyParams> = {}

void withoutChild
void withChild
void legacyWithoutChild
