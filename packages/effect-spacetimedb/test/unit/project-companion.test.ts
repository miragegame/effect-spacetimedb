import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

const { expect } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import { FullModule, UserId } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

describe("module project plan", (it) => {
  it.effect("derives keyed subscription targets from the authored module", () =>
    Effect.gen(function* () {
      const Full = Stdb.project(FullModule)

      expect(Full.targets.tables.user).toMatchObject({
        kind: "table",
        key: "user",
        name: "user",
      })
      expect(Full.targets.eventTables.presenceEvent).toMatchObject({
        kind: "eventTable",
        key: "presenceEvent",
        name: "presenceEvent",
      })
      expect(Full.targets.tables.user.where).toBeTypeOf("function")
      expect(Full.targets.eventTables.presenceEvent.where).toBeTypeOf(
        "function",
      )
      const userId = Schema.decodeUnknownSync(UserId)("user-1")
      const userPredicate: Parameters<
        typeof Full.targets.tables.user.where
      >[0] = (row) => row.id.eq(userId)
      const presencePredicate: Parameters<
        typeof Full.targets.eventTables.presenceEvent.where
      >[0] = (row) => row.kind.eq("joined")
      expect(Full.targets.tables.user.where(userPredicate)).toEqual({
        kind: "query",
        key: "user",
        name: "user",
        predicate: userPredicate,
      })
      expect(
        Full.targets.eventTables.presenceEvent.where(presencePredicate),
      ).toEqual({
        kind: "query",
        key: "presenceEvent",
        name: "presenceEvent",
        predicate: presencePredicate,
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
