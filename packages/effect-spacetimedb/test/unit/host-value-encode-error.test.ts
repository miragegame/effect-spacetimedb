import * as EffectVitest from "@effect/vitest"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { TestLayer } from "../helpers/test-layer"
import { testArrayLength } from "../helpers/array-bounds"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

type HostEncodeReason = InstanceType<
  typeof StdbInternal.StdbHostEncodeError
>["reason"]

const captureHostEncodeError = (
  evaluate: () => unknown,
): StdbInternal.StdbHostEncodeError => {
  try {
    evaluate()
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(StdbInternal.StdbHostEncodeError)
    if (error instanceof StdbInternal.StdbHostEncodeError) {
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
    const String = StdbInternal.ContractType.string()
    const StringArray = StdbInternal.ContractType.array(String, testArrayLength)
    const User = StdbInternal.ContractType.struct({
      id: String,
      displayName: String,
    })
    const Result = StdbInternal.ContractType.result(String, String)
    const Status = StdbInternal.ContractType.sum({
      Active: String,
      Deleted: StdbInternal.ContractType.unit(),
    })

    expectHostEncodeError(
      () => StdbInternal.encodeHostValue(StringArray, "Ada"),
      {
        reason: "ExpectedArray",
        message: "Expected array host value",
      },
    )
    expectHostEncodeError(() => StdbInternal.encodeHostValue(User, null), {
      reason: "ExpectedStruct",
      message: "Expected struct host value",
    })
    expectHostEncodeError(
      () => StdbInternal.encodeHostValue(User, { id: "user-1" }),
      {
        reason: "MissingStructField",
        field: "displayName",
        message: "Missing required host struct field displayName",
      },
    )
    expectHostEncodeError(() => StdbInternal.encodeHostValue(Result, null), {
      reason: "ExpectedResult",
      message: "Expected result host value",
    })
    expectHostEncodeError(
      () => StdbInternal.encodeHostValue(Result, { tag: "ok" }),
      {
        reason: "MissingResultOkValue",
        message: "Missing result host ok value",
      },
    )
    expectHostEncodeError(
      () => StdbInternal.encodeHostValue(Result, { tag: "err" }),
      {
        reason: "MissingResultErrValue",
        message: "Missing result host err value",
      },
    )
    expectHostEncodeError(
      () => StdbInternal.encodeHostValue(Result, { tag: "pending" }),
      {
        reason: "ExpectedResultEnvelope",
        message: "Expected result host envelope",
      },
    )
    expectHostEncodeError(() => StdbInternal.encodeHostValue(Status, {}), {
      reason: "ExpectedSumEnvelope",
      message: "Expected sum host envelope",
    })
    expectHostEncodeError(
      () =>
        StdbInternal.encodeHostValue(Status, {
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
      () => StdbInternal.encodeHostValue(Status, { tag: "Active" }),
      {
        reason: "MissingSumValue",
        variant: "Active",
        message: "Missing sum host value for Active",
      },
    )
  })
})
