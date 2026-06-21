import * as EffectVitest from "@effect/vitest"
const { describe, expect, it } = EffectVitest
import {
  deserializeCapturedValue,
  serializeCapturedValue,
} from "../helpers/captured-event-codec"
import {
  reducerContext,
  reducerOk,
  subscribeAppliedContext,
} from "../helpers/sdk-event-oracle"

const ownStringKeys = (value: unknown): ReadonlyArray<string> =>
  typeof value === "object" && value !== null ? Object.keys(value).sort() : []

const assertSameOwnStringKeys = (actual: unknown, expected: unknown): void => {
  expect(ownStringKeys(actual)).toEqual(ownStringKeys(expected))

  if (
    Array.isArray(actual) ||
    Array.isArray(expected) ||
    actual instanceof Uint8Array ||
    expected instanceof Uint8Array ||
    actual instanceof Error ||
    expected instanceof Error ||
    typeof actual !== "object" ||
    actual === null ||
    typeof expected !== "object" ||
    expected === null
  ) {
    return
  }

  for (const key of Object.keys(expected)) {
    assertSameOwnStringKeys(
      (actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key],
    )
  }
}

const ownKeyShape = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(ownKeyShape)
  }
  if (value instanceof Uint8Array || value instanceof Error) {
    return value.constructor.name
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, ownKeyShape(entry)]),
    )
  }
  return typeof value
}

describe("captured event codec", () => {
  it("preserves SDK object key structure without whitelisting event fields", () => {
    const original = reducerContext({
      outcome: reducerOk(new Uint8Array([1, 2, 3])),
    })
    const decoded = deserializeCapturedValue(serializeCapturedValue(original))

    expect(ownKeyShape(decoded)).toEqual(ownKeyShape(original))
    assertSameOwnStringKeys(decoded, original)
  })

  it("preserves known SDK event context own keys across event variants", () => {
    const original = subscribeAppliedContext()
    const decoded = deserializeCapturedValue(serializeCapturedValue(original))

    assertSameOwnStringKeys(decoded, original)
  })
})
