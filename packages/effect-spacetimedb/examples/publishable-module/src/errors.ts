import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { UserId } from "./schema"

export const ExampleErrors = Stdb.errors.namespace("EffectSpacetimeDbExample")({
  UserMissingError: Stdb.error(
    {
      userId: Stdb.string(UserId),
    },
    { status: 404 },
  ),
})

export const UserMissingError = ExampleErrors.UserMissingError

export const RotateTokenInput = Schema.Struct({
  userId: UserId,
})

export const RotateTokenOutput = Schema.Struct({
  token: Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
})
