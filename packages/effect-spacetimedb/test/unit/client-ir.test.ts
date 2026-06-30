import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

describe("client projections", (it) => {
  it.effect("filters private surfaces into keyed public projections", () =>
    Effect.gen(function* () {
      const plan = StdbTesting.makeModulePlan(FullModule)

      expect(Object.keys(plan.publicTables)).toEqual(["user"])
      expect(Object.keys(plan.publicEventTables)).toEqual(["presenceEvent"])
      expect(Object.keys(plan.publicReducers)).toEqual([
        "userRequire",
        "userUpsert",
      ])
      expect(Object.keys(plan.publicProcedures)).toEqual(["userGet"])
    }),
  )

  it.effect("keeps event tables separate from persistent table rows", () =>
    Effect.gen(function* () {
      const plan = StdbTesting.makeModulePlan(FullModule)

      expect("presenceEvent" in (plan.publicTables as object)).toBe(false)
      expect("presenceEvent" in (plan.publicEventTables as object)).toBe(true)
    }),
  )
})
