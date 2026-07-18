import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { UserMissingError } from "../errors"
import { Db, ExampleModule, HttpTx } from "../module"

export const WebhookRoutesLive = Stdb.StdbBuilder.group(
  ExampleModule,
  "Webhooks",
  {
    stripeWebhook: (req) =>
      Effect.succeed(new Stdb.SyncResponse(req.text(), { status: 202 })),
    rotateToken: Effect.fn(function* ({ userId }) {
      const tx = yield* HttpTx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          yield* db.user.id.findOrFail(userId, (missingUserId) =>
            UserMissingError.make({
              userId: missingUserId,
            }),
          )

          return { token: "rotated-example-token" }
        }),
      )
    }),
  },
)
