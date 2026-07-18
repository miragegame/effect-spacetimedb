import * as Stdb from "effect-spacetimedb"
import { ExampleErrors, RotateTokenInput, RotateTokenOutput } from "../errors"

export const WebhookRoutes = Stdb.StdbHttpGroup.make("Webhooks")
  .prefix("/webhooks")
  .add(Stdb.StdbHttp.post("stripeWebhook", "/stripe"))
  .merge(
    Stdb.StdbHttpGroup.make("ServerTokens")
      .prefix("/server-tokens")
      .add(
        Stdb.StdbHttp.post("rotateToken", "/rotate", {
          request: RotateTokenInput,
          response: RotateTokenOutput,
          errors: ExampleErrors,
        }),
      ),
  )
