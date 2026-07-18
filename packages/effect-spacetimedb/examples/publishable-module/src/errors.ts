import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { ThingId, UserId } from "./schema"

export const ExampleErrors = Stdb.errors.namespace("EffectSpacetimeDbExample")({
  ThingAbortError: Stdb.error(
    {
      thingId: Stdb.string(ThingId),
    },
    { status: 409 },
  ),
  UserMissingError: Stdb.error(
    {
      userId: Stdb.string(UserId),
    },
    { status: 404 },
  ),
})

export const ThingAbortError = ExampleErrors.ThingAbortError
export const UserMissingError = ExampleErrors.UserMissingError

export const RotateTokenInput = Schema.Struct({
  userId: UserId,
})

export const RotateTokenOutput = Schema.Struct({
  token: Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
})
