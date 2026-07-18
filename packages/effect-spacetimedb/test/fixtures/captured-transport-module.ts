import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

export const UserId = Schema.String.pipe(
  Schema.brand("EffectSpacetimeDbExample/UserId"),
)
export type UserId = typeof UserId.Type

export const ThingId = Schema.String.pipe(
  Schema.brand("EffectSpacetimeDbExample/ThingId"),
)
export type ThingId = typeof ThingId.Type

const String255 = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

const U64 = Stdb.u64(
  Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(0n)),
)

const user = Stdb.table("user", {
  public: true,
  columns: {
    id: Stdb.string(UserId).primaryKey(),
  },
})

const thing = Stdb.table("thing", {
  public: true,
  columns: {
    id: Stdb.string(ThingId).primaryKey(),
    label: String255,
    count: U64,
  },
})

export const ExampleErrors = Stdb.errors.namespace("EffectSpacetimeDbExample")({
  UserMissingError: Stdb.error(
    {
      userId: Stdb.string(UserId),
    },
    { status: 404 },
  ),
})

export const UserMissingError = ExampleErrors.UserMissingError

const CapturedCallables = Stdb.StdbGroup.make("CapturedCallables")
  .add(
    Stdb.StdbFn.reducer("userRequire", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
      }),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.StdbFn.reducer("thingNoop", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("thingPanic", {
      params: Stdb.struct({}),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("thingOutcome", {
      params: Stdb.struct({
        thingId: Stdb.string(ThingId),
      }),
      returns: Stdb.result(thing.row, String255),
    }),
  )

export const CapturedTransportModule = Stdb.StdbModule.make(
  "captured_transport",
  {},
)
  .addTables(user, thing)
  .add(CapturedCallables).spec
