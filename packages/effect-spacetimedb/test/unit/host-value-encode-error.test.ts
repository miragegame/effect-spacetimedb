// lint-ignore: stdb-string-columns-require-domain - interop tests intentionally exercise raw STDB schema constructors.
import * as EffectVitest from "@effect/vitest"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

type HostEncodeReason = InstanceType<
  typeof StdbTesting.StdbHostEncodeError
>["reason"]

const captureHostEncodeError = (
  evaluate: () => unknown,
): StdbTesting.StdbHostEncodeError => {
  try {
    evaluate()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(StdbTesting.StdbHostEncodeError)
    if (error instanceof StdbTesting.StdbHostEncodeError) {
      return error
    }
  }

  throw new Error("Expected encodeHostValue to throw StdbHostEncodeError")
}

const expectHostEncodeError = (
  evaluate: () => unknown,
  expected: {
    readonly reason: HostEncodeReason
    readonly field?: string
    readonly variant?: string
    readonly message: string
  },
): void => {
  const error = captureHostEncodeError(evaluate)
  expect(error.reason).toBe(expected.reason)
  expect(error.field).toBe(expected.field)
  expect(error.variant).toBe(expected.variant)
  expect(error.message).toBe(expected.message)
}

describe("effect-spacetimedb host value encode errors", (it) => {
  it("throws structured errors for host shape mismatches", () => {
    const String = StdbTesting.ContractType.string()
    const StringArray = StdbTesting.ContractType.array(String)
    const User = StdbTesting.ContractType.struct({
      id: String,
      displayName: String,
    })
    const Result = StdbTesting.ContractType.result(String, String)
    const Status = StdbTesting.ContractType.sum({
      Active: String,
      Deleted: StdbTesting.ContractType.unit(),
    })

    expectHostEncodeError(
      () => StdbTesting.encodeHostValue(StringArray, "Ada"),
      {
        reason: "ExpectedArray",
        message: "Expected array host value",
      },
    )
    expectHostEncodeError(() => StdbTesting.encodeHostValue(User, null), {
      reason: "ExpectedStruct",
      message: "Expected struct host value",
    })
    expectHostEncodeError(
      () => StdbTesting.encodeHostValue(User, { id: "user-1" }),
      {
        reason: "MissingStructField",
        field: "displayName",
        message: "Missing required host struct field displayName",
      },
    )
    expectHostEncodeError(() => StdbTesting.encodeHostValue(Result, null), {
      reason: "ExpectedResult",
      message: "Expected result host value",
    })
    expectHostEncodeError(
      () => StdbTesting.encodeHostValue(Result, { tag: "ok" }),
      {
        reason: "MissingResultOkValue",
        message: "Missing result host ok value",
      },
    )
    expectHostEncodeError(
      () => StdbTesting.encodeHostValue(Result, { tag: "err" }),
      {
        reason: "MissingResultErrValue",
        message: "Missing result host err value",
      },
    )
    expectHostEncodeError(
      () => StdbTesting.encodeHostValue(Result, { tag: "pending" }),
      {
        reason: "ExpectedResultEnvelope",
        message: "Expected result host envelope",
      },
    )
    expectHostEncodeError(() => StdbTesting.encodeHostValue(Status, {}), {
      reason: "ExpectedSumEnvelope",
      message: "Expected sum host envelope",
    })
    expectHostEncodeError(
      () =>
        StdbTesting.encodeHostValue(Status, {
          tag: "Archived",
          value: "off",
        }),
      {
        reason: "UnknownSumVariant",
        variant: "Archived",
        message: "Unknown sum host variant Archived",
      },
    )
    expectHostEncodeError(
      () => StdbTesting.encodeHostValue(Status, { tag: "Active" }),
      {
        reason: "MissingSumValue",
        variant: "Active",
        message: "Missing sum host value for Active",
      },
    )
  })
})
