import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { FullStdbModule } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

describe("testing entrypoint", (it) => {
  it.effect("exposes curated low-level namespaces", () =>
    Effect.gen(function* () {
      expect(
        StdbInternal.ContractTypeSchemaFallback.unsupportedTypeMessage([
          "root",
        ]),
      ).toMatchInlineSnapshot(
        `"Unsupported SpaceTimeDB type at root. Use a supported Stdb.* value constructor or Stdb.custom(schema, { type }) to make SpaceTimeDB lowering explicit."`,
      )
    }),
  )

  it("binds flat handlers named after handler sections", () => {
    const module = Stdb.Module.make("handlers").add(
      Stdb.Group.make("cache").add(
        Stdb.Fn.reducer("reducers", {}),
        Stdb.Fn.reducer("views", {}),
      ),
    )
    const bound = StdbTesting.bindCallables(module, {
      reducers: Effect.void,
      views: () => Effect.void,
    })
    expect(typeof bound.reducers?.invoke).toBe("function")
    expect(typeof bound.views?.invoke).toBe("function")
  })

  it("binds reducers, procedures, HTTP handlers, views, and lifecycle", () => {
    const bound = StdbTesting.bindCallables(FullStdbModule, {
      reducers: {
        userUpsert: Effect.void,
      },
      procedures: {
        userGet: Effect.void,
        reminderFire: Effect.void,
      },
      httpHandlers: {
        stripeWebhook: Effect.void,
        rotateToken: Effect.void,
      },
      views: {
        allUsers: Effect.void,
      },
      lifecycle: {
        init: Effect.void,
        clientConnected: Effect.void,
        clientDisconnected: Effect.void,
      },
    })

    expect(Object.keys(bound).sort()).toEqual([
      "allUsers",
      "clientConnected",
      "clientDisconnected",
      "init",
      "reminderFire",
      "rotateToken",
      "stripeWebhook",
      "userGet",
      "userUpsert",
    ])
  })
})
