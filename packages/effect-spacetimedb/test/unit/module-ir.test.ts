import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { FullModule } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

describe("module projections", (it) => {
  it.effect("keeps only derived module metadata we actually reuse", () =>
    Effect.gen(function* () {
      const plan = StdbInternal.makeModulePlan(FullModule)

      expect(plan.scheduleBindings).toEqual([
        {
          tableKey: "reminder",
          tableName: "reminder",
          targetKey: "reminderFire",
          targetKind: "procedure",
          allowExternalCallers: false,
        },
      ])
      expect("clientIr" in (plan as object)).toBe(false)
      expect("moduleIr" in (plan as object)).toBe(false)
    }),
  )
})
