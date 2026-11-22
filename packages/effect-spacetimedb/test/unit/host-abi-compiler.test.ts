import * as EffectVitest from "@effect/vitest"
import {
  assertCompilerHostAbiCapabilities,
  StdbHostAbiCapabilityDefect,
  type CompilerHostAbiShape,
} from "../../src/server/host-abi-compiler"

const { describe, expect, it } = EffectVitest

class TestSenderError extends Error {}

const validCompilerHostAbi = {
  CaseConversionPolicy: {
    None: "none",
    SnakeCase: "snake_case",
  },
  isRowTypedQuery: () => false,
  Range: class {},
  Router: class {},
  remoteModule: () => ({}),
  schema: () => ({}),
  SenderError: TestSenderError,
  t: {},
  table: () => ({}),
} as const satisfies CompilerHostAbiShape

describe("compiler host ABI", () => {
  it("reports the missing compiler host capability", () => {
    const shape = {
      ...validCompilerHostAbi,
      schema: undefined,
    } satisfies CompilerHostAbiShape

    expect(() => assertCompilerHostAbiCapabilities(shape)).toThrow(
      StdbHostAbiCapabilityDefect,
    )
    expect(() => assertCompilerHostAbiCapabilities(shape)).toThrow(
      "missing or malformed schema",
    )

    try {
      assertCompilerHostAbiCapabilities(shape)
    } catch (cause) {
      expect(cause).toBeInstanceOf(StdbHostAbiCapabilityDefect)
      expect(cause).toMatchObject({
        capability: "schema",
      })
    }
  })
})
