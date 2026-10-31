import * as EffectVitest from "@effect/vitest"
import { messageFromUnknown } from "../../src/client/call-errors.ts"
import { StdbDecodeError } from "../../src/decode-error.ts"

const { describe, expect, it } = EffectVitest

describe("unknown error messages", () => {
  it("renders object fields and handles circular context", () => {
    const context: Record<string, unknown> = { code: 42, phase: "connect" }
    context.self = context

    const message = messageFromUnknown(context)
    expect(message).toContain('"code":42')
    expect(message).toContain('"phase":"connect"')
    expect(message).not.toBe("[object Object]")
  })
})

describe("decode error messages", () => {
  it("renders a null-prototype cause instead of throwing", () => {
    const cause: Record<string, unknown> = Object.create(null)
    cause.field = "unitsTotal"

    const message = new StdbDecodeError({
      phase: "args",
      callable: "computeAllocationClaim",
      cause,
    }).message
    expect(message).toContain("callable=computeAllocationClaim")
    expect(message).toContain('"field":"unitsTotal"')
  })

  it("renders a cause that neither serializes nor stringifies", () => {
    const cause: Record<string, unknown> = Object.create(null)
    Object.defineProperty(cause, "toJSON", {
      value: () => {
        throw new Error("not serializable")
      },
    })

    const message = new StdbDecodeError({ phase: "row", cause }).message
    expect(message).toContain("SpaceTimeDB decode failed during row")
  })
})
