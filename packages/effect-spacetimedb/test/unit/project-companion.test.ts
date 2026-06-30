import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import { FullModule } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

describe("module project plan", (it) => {
  it.effect("derives keyed subscription targets from the authored module", () =>
    Effect.gen(function* () {
      const Full = Stdb.project(FullModule)

      expect(Full.targets.tables.user).toEqual({
        kind: "table",
        key: "user",
        name: "user",
      })
      expect(Full.targets.eventTables.presenceEvent).toEqual({
        kind: "eventTable",
        key: "presenceEvent",
        name: "presenceEvent",
      })
      expect(Full.targets.allPublicTables()).toEqual({
        kind: "allPublicTables",
        keys: ["user", "presenceEvent"],
      })
    }),
  )

  it.effect(
    "keeps authored contract sections without redundant callable aliases",
    () =>
      Effect.gen(function* () {
        const Full = Stdb.project(FullModule)

        expect(Object.keys(Full.tables)).toEqual([
          "user",
          "presenceEvent",
          "reminder",
        ])
        expect(Object.keys(Full.reducers)).toEqual([
          "userRequire",
          "userUpsert",
        ])
        expect(Object.keys(Full.procedures)).toEqual([
          "reminderFire",
          "userGet",
        ])
        expect("callables" in (Full as object)).toBe(false)
      }),
  )

  it.effect("keeps views out of the projected ws target surface", () =>
    Effect.gen(function* () {
      const Full = Stdb.project(FullModule)

      expect("views" in (Full.targets as object)).toBe(false)
    }),
  )
})
