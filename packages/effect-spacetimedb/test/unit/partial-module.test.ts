import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import { CallableOnlyModule } from "../fixtures/callable-only-module"
import { MinimalModule } from "../fixtures/minimal-module"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

describe("partial module shapes", (it) => {
  it.effect("supports table-only modules", () =>
    Effect.gen(function* () {
      const plan = StdbTesting.makeModulePlan(MinimalModule)

      expect(plan.scheduleBindings).toEqual([])
      expect(Object.keys(plan.publicTables)).toEqual(["thing"])
      expect(Object.keys(plan.publicReducers)).toEqual([])
    }),
  )

  it.effect("supports callable-only modules", () =>
    Effect.gen(function* () {
      const plan = StdbTesting.makeModulePlan(CallableOnlyModule)

      expect(plan.scheduleBindings).toEqual([])
      expect(Object.keys(plan.publicTables)).toEqual([])
      expect(Object.keys(plan.publicReducers)).toEqual(["ping"])
      expect(Object.keys(plan.publicProcedures)).toEqual(["echo"])
    }),
  )
})
