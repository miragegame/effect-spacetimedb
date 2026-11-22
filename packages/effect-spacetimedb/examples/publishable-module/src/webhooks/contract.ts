import * as Stdb from "effect-spacetimedb"
import { ExampleErrors, RotateTokenInput, RotateTokenOutput } from "../errors"

export const WebhookRoutes = Stdb.HttpGroup.make("Webhooks")
  .prefix("/webhooks")
  .add(Stdb.Http.post("stripeWebhook", "/stripe"))
  .merge(
    Stdb.HttpGroup.make("ServerTokens")
      .prefix("/server-tokens")
      .add(
        Stdb.Http.post("rotateToken", "/rotate", {
          request: RotateTokenInput,
          response: RotateTokenOutput,
          errors: ExampleErrors,
        }),
      ),
  )
