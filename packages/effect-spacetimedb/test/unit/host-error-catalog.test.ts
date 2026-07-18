import * as EffectVitest from "@effect/vitest"
import { SpacetimeHostError as NativeSpacetimeHostError } from "spacetimedb/server"
import {
  SpacetimeHostError,
  SpacetimeHostErrorCodes,
  SpacetimeHostErrors,
  SpacetimeHostErrorsByCode,
} from "../../src/server/index.ts"

const { describe, expect, it } = EffectVitest

describe("SpacetimeDB host error catalog", () => {
  it("recognizes direct and upstream base host errors", () => {
    expect(new SpacetimeHostError("local base")).toBeInstanceOf(
      SpacetimeHostError,
    )
    expect(new NativeSpacetimeHostError("upstream base")).toBeInstanceOf(
      SpacetimeHostError,
    )
  })

  it("maps every named native host error to its numeric code and class", () => {
    expect(Object.keys(SpacetimeHostErrorCodes).sort()).toEqual(
      Object.keys(SpacetimeHostErrors).sort(),
    )

    for (const [name, code] of Object.entries(SpacetimeHostErrorCodes)) {
      const NamedError =
        SpacetimeHostErrors[name as keyof typeof SpacetimeHostErrors]
      const CodedError = SpacetimeHostErrorsByCode[code]
      const error = new CodedError(`${name} failed`)

      expect(CodedError).toBe(NamedError)
      expect(error).toBeInstanceOf(SpacetimeHostError)
      expect(error.name).toBe(name)
    }
  })
})
