import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { CallableInterruptedError } from "effect-spacetimedb/server"
import {
  toLifecycleThrow,
  toProcedureValue,
  toReducerThrow,
  toViewValue,
} from "../../src/server/callable-runtime.ts"

const { describe, expect, it } = EffectVitest

const interrupted = Exit.failCause(Cause.interrupt(1))

describe("callable interruption labels", () => {
  const cases = [
    ["reducer", () => toReducerThrow(interrupted)],
    ["procedure", () => toProcedureValue(interrupted)],
    ["view", () => toViewValue(interrupted)],
    ["lifecycle", () => toLifecycleThrow(interrupted)],
  ] as const

  for (const [kind, invoke] of cases) {
    it(`labels ${kind} interruption`, () => {
      try {
        invoke()
      } catch (error) {
        expect(error).toBeInstanceOf(CallableInterruptedError)
        expect(error).toMatchObject({ kind })
        return
      }
      throw new Error(`Expected ${kind} interruption`)
    })
  }
})
