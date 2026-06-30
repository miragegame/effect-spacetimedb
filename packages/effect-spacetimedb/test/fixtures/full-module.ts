import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

export const UserId = Schema.String.pipe(Schema.brand("UserId"))
export type UserId = typeof UserId.Type

export const UserName = Schema.String.pipe(Schema.brand("UserName"))
export type UserName = typeof UserName.Type

export class MissingAuth extends Schema.TaggedErrorClass<MissingAuth>()(
  "MissingAuth",
  {},
  { httpApiStatus: 401 },
) {}

export class UserMissing extends Schema.TaggedErrorClass<UserMissing>()(
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

const FullCallables = Stdb.StdbGroup.make("FullCallables")
  .add(
    Stdb.StdbFn.anonymousView("allUsers", {
      returns: Stdb.array(user.row),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("userUpsert", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
        name: Stdb.string(UserName),
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("userRequire", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
      }),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.StdbFn.procedure("userGet", {
      params: Stdb.struct({
        userId: Stdb.string(UserId),
      }),
      returns: Stdb.option(user.row),
      errors: ExampleErrors,
    }),
  )
  .add(
    Stdb.StdbFn.scheduledProcedure("reminderFire", {
      table: reminder,
    }),
  )
  .add(Stdb.StdbFn.init())
  .add(Stdb.StdbFn.clientConnected())
  .add(Stdb.StdbFn.clientDisconnected())

const FullHttpHandlers = Stdb.StdbHttpGroup.make("FullHttp")
  .add(Stdb.StdbHttp.post("stripeWebhook", "/webhooks/stripe"))
  .add(
    Stdb.StdbHttp.post("rotateToken", "/server-tokens/rotate", {
      request: RotateTokenInput,
      response: RotateTokenOutput,
      errors: ExampleErrors,
    }),
  )

export const FullStdbModule = Stdb.StdbModule.make("example", {})
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
