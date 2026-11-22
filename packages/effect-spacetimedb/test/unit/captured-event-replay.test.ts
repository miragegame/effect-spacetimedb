import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

const { expect } = EffectVitest

import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { readCapturedJson } from "../helpers/captured-event-codec"

const describe = EffectVitest.layer(
  Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
)

const eventContextFixture = (name: string): URL =>
  new URL(`../fixtures/captured/event-contexts/${name}.json`, import.meta.url)

const decodeFixture = Effect.fn(function* (name: string) {
  return StdbInternal.decodeStdbEventContextSync(
    yield* readCapturedJson(eventContextFixture(name)),
  )
})

const expectReducer = (
  value: StdbInternal.StdbEventContext,
): Extract<StdbInternal.StdbEventContext, { readonly _tag: "Reducer" }> => {
  expect(StdbInternal.StdbEventContext.$is("Reducer")(value)).toBe(true)
  if (!StdbInternal.StdbEventContext.$is("Reducer")(value)) {
    throw new Error("Expected captured fixture to decode as Reducer")
  }
  return value
}

describe("captured event-context replay", (it) => {
  it.effect("replays captured reducer success contexts", () =>
    Effect.gen(function* () {
      const decoded = expectReducer(yield* decodeFixture("reducer-ok"))

      expect(StdbInternal.StdbReducerOutcome.$is("Ok")(decoded.outcome)).toBe(
        true,
      )
    }),
  )

  it.effect("replays captured subscribe-applied events", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeFixture("subscribe-applied")

      expect(
        StdbInternal.StdbEventContext.$is("SubscribeApplied")(decoded),
      ).toBe(true)
    }),
  )

  it.effect("replays captured unsubscribe-applied events", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeFixture("unsubscribe-applied")

      expect(
        StdbInternal.StdbEventContext.$is("UnsubscribeApplied")(decoded),
      ).toBe(true)
    }),
  )

  it.effect("replays captured relation mutation contexts", () =>
    Effect.forEach(
      ["relation-insert", "relation-update", "relation-delete"] as const,
      Effect.fn(function* (name) {
        const decoded = expectReducer(yield* decodeFixture(name))
        expect(StdbInternal.StdbReducerOutcome.$is("Ok")(decoded.outcome)).toBe(
          true,
        )
      }),
    ),
  )
})
