import * as EffectVitest from "@effect/vitest"
import { HostErrorCodeSnapshot } from "../helpers/host-error-snapshot"

const { describe, expect, it } = EffectVitest

type HostErrors = Record<string, new (message: string) => Error>

const loadHostErrors = async (): Promise<HostErrors> => {
  const sourcePath = new URL(
    "../src/server/errors.ts",
    import.meta.resolve("spacetimedb"),
  ).href
  const module = (await import(sourcePath)) as {
    readonly errors: HostErrors
  }
  return module.errors
}

describe("host error registry drift", () => {
  it("matches the pinned SpaceTimeDB host error registry names", async () => {
    const errors = await loadHostErrors()

    expect(Object.keys(errors).sort()).toEqual(
      Object.keys(HostErrorCodeSnapshot).sort(),
    )

    for (const [name, HostError] of Object.entries(errors)) {
      expect(new HostError(`${name} failed`).name).toBe(name)
    }
  })
})
