import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { testViewRowsLength } from "../helpers/array-bounds"

export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export const UserName = Schema.String.pipe(Schema.brand("UserName"))
export type UserName = typeof UserName.Type

export class MissingAuth extends Schema.TaggedError<MissingAuth>()(
  "MissingAuth",
  {},
  { httpApiStatus: 401 },
) {}

export class UserMissing extends Schema.TaggedError<UserMissing>()(
  "UserMissing",
  { userId: UserId },
  { httpApiStatus: 404 },
) {}

export const ExampleErrors = Stdb.errors(MissingAuth, UserMissing)

export const RotateTokenInput = Schema.Struct({
  userId: UserId,
})

export const RotateTokenOutput = Schema.Struct({
  token: Schema.String,
})

const user = Stdb.table("user", {
  public: true,
  columns: {
    id: Stdb.string(UserId).primaryKey(),
    name: Stdb.string(UserName),
  },
  constraints: [Stdb.unique({ name: "userIdUnique", columns: ["id"] })],
})

const presenceEvent = Stdb.table("presenceEvent", {
  columns: {
    userId: Stdb.string(UserId),
    kind: Stdb.literal("joined", "left"),
  },
  public: true,
  event: true,
})

const reminder = Stdb.scheduledTable("reminder", {
  public: false,
  columns: {
    id: Stdb.u64(),
  },
})

const fullTables = [user, presenceEvent, reminder] as const

const FullCallables = Stdb.Group.make("FullCallables")
  .add(
    Stdb.Fn.anonymousView("allUsers", {
      returns: Stdb.array(user.row, testViewRowsLength),
    }),
  )
  .add(
    Stdb.Fn.reducer("userUpsert", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
        name: Stdb.string(UserName),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("userRequire", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
      }),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.Fn.procedure("userGet", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
      }),
      returns: Stdb.option(user.row),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.Fn.scheduledProcedure("reminderFire", {
      table: reminder,
    }),
  )
  .add(Stdb.Fn.init())
  .add(Stdb.Fn.clientConnected())
  .add(Stdb.Fn.clientDisconnected())

const FullHttpHandlers = Stdb.HttpGroup.make("FullHttp")
  .add(Stdb.Http.post("stripeWebhook", "/webhooks/stripe"))
  .add(
    Stdb.Http.post("rotateToken", "/server-tokens/rotate", {
      request: RotateTokenInput,
      response: RotateTokenOutput,
      errors: ExampleErrors,
    }),
  )

export const FullStdbModule = Stdb.Module.make("example", {})
  .addTables(...fullTables)
  .add(FullCallables)
  .add(FullHttpHandlers)

export const FullModule: (typeof FullStdbModule)["spec"] = FullStdbModule.spec

type RotateTokenHandlerInput = Schema.Schema.Type<typeof RotateTokenInput>

export const FullModuleHttpHandlers = {
  stripeWebhook: Effect.fn(function* (_req: Stdb.Request) {
    return new Stdb.SyncResponse("ok")
  }),
  rotateToken: Effect.fn(function* (_input: RotateTokenHandlerInput) {
    return { token: "ok" }
  }),
}
