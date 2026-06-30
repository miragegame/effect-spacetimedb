import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

describe("testing entrypoint", (it) => {
  it.effect("exposes curated low-level namespaces", () =>
    Effect.gen(function* () {
      expect(
        StdbTesting.ContractTypeSchemaFallback.unsupportedTypeMessage(["root"]),
      ).toMatchInlineSnapshot(
        `"Unsupported SpaceTimeDB type at root. Use a supported Stdb.* value constructor or Stdb.custom(schema, { type }) to make SpaceTimeDB lowering explicit."`,
      )
    }),
  )
})
