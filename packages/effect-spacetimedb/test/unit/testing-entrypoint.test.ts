import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullStdbModule } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

describe("testing entrypoint", (it) => {
  it.effect("has unique top-level export names", () =>
    Effect.gen(function* () {
      const names = Object.keys(StdbTesting)
      expect(new Set(names).size).toBe(names.length)
    }),
  )

  it.effect("exposes curated low-level namespaces", () =>
    Effect.gen(function* () {
      expect(
        StdbTesting.ContractTypeSchemaFallback.unsupportedTypeMessage(["root"]),
      ).toMatchInlineSnapshot(
        `"Unsupported SpaceTimeDB type at root. Use a supported Stdb.* value constructor or Stdb.custom(schema, { type }) to make SpaceTimeDB lowering explicit."`,
      )
    }),
  )

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
