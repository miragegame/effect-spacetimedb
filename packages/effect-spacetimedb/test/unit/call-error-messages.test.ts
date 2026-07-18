import * as EffectVitest from "@effect/vitest"
import { messageFromUnknown } from "../../src/client/call-errors.ts"

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
