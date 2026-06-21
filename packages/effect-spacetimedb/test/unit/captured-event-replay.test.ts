import * as EffectVitest from "@effect/vitest"
const { describe, expect, it } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import { readCapturedJson } from "../helpers/captured-event-codec"

const eventContextFixture = (name: string): URL =>
  new URL(`../fixtures/captured/event-contexts/${name}.json`, import.meta.url)

const decodeFixture = async (
  name: string,
): Promise<StdbTesting.StdbEventContext> =>
  StdbTesting.decodeStdbEventContextSync(
    await readCapturedJson(eventContextFixture(name)),
  )

const expectReducer = (
  value: StdbTesting.StdbEventContext,
): Extract<StdbTesting.StdbEventContext, { readonly _tag: "Reducer" }> => {
  expect(StdbTesting.StdbEventContext.$is("Reducer")(value)).toBe(true)
  if (!StdbTesting.StdbEventContext.$is("Reducer")(value)) {
    throw new Error("Expected captured fixture to decode as Reducer")
  }
  return value
}

describe("captured event-context replay", () => {
  it("replays captured reducer success contexts", async () => {
    const decoded = expectReducer(await decodeFixture("reducer-ok"))

    expect(StdbTesting.StdbReducerOutcome.$is("Ok")(decoded.outcome)).toBe(true)
  })

  it("replays captured subscribe-applied events", async () => {
    const decoded = await decodeFixture("subscribe-applied")

    expect(StdbTesting.StdbEventContext.$is("SubscribeApplied")(decoded)).toBe(
      true,
    )
  })

  it("replays captured unsubscribe-applied events", async () => {
    const decoded = await decodeFixture("unsubscribe-applied")

    expect(
      StdbTesting.StdbEventContext.$is("UnsubscribeApplied")(decoded),
    ).toBe(true)
  })

  it("replays captured relation mutation contexts", async () => {
    for (const name of [
      "relation-insert",
      "relation-update",
      "relation-delete",
    ] as const) {
      const decoded = expectReducer(await decodeFixture(name))
      expect(StdbTesting.StdbReducerOutcome.$is("Ok")(decoded.outcome)).toBe(
        true,
      )
    }
  })
})
