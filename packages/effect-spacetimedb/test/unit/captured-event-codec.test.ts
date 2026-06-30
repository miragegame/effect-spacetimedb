import * as EffectVitest from "@effect/vitest"
import * as FastCheck from "effect/testing/FastCheck"
import { ConnectionId, Identity, Timestamp } from "spacetimedb"
import {
  deserializeCapturedValue,
  serializeCapturedValue,
} from "../helpers/captured-event-codec"
import {
  reducerContext,
  reducerOk,
  subscribeAppliedContext,
} from "../helpers/sdk-event-oracle"

const { describe, expect, it } = EffectVitest

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

const codecPropertyOptions = {
  fastCheck: { numRuns: 100, seed: 0xcae7_2026 },
} as const

const U128Max = (1n << 128n) - 1n
const U256Max = (1n << 256n) - 1n

const makeCapturedFunction = (): (() => undefined) => {
  const fn = () => undefined
  Object.defineProperty(fn, "name", { value: "" })
  return fn
}

const bytesArbitrary = FastCheck.array(
  FastCheck.integer({ min: 0, max: 255 }),
  { minLength: 1, maxLength: 8 },
).map((bytes) => new Uint8Array(bytes))

const generatedCapturedValueArbitrary = FastCheck.record({
  text: FastCheck.string({ maxLength: 64 }),
  count: FastCheck.integer({ min: -1_000_000, max: 1_000_000 }),
  enabled: FastCheck.boolean(),
  nil: FastCheck.constant(null),
  bigint: FastCheck.bigInt(),
  bytes: bytesArbitrary,
  timestamp: FastCheck.bigInt({ min: 0n, max: U128Max }).map(
    (micros) => new Timestamp(micros),
  ),
  identity: FastCheck.bigInt({ min: 1n, max: U256Max }).map(
    (value) => new Identity(value),
  ),
  connectionId: FastCheck.bigInt({ min: 1n, max: U128Max }).map(
    (value) => new ConnectionId(value),
  ),
  errorWithProperties: FastCheck.record({
    message: FastCheck.string({ maxLength: 64 }),
    code: FastCheck.integer({ min: 100, max: 599 }),
    bytes: bytesArbitrary,
    amount: FastCheck.bigInt(),
  }).map(({ message, code, bytes, amount }) => {
    const error = new Error(message) as Error & Record<string, unknown>
    Object.defineProperty(error, "name", {
      value: "GeneratedCapturedError",
      configurable: true,
      writable: true,
    })
    error.code = code
    error.bytes = bytes
    error.amount = amount
    return error
  }),
  plainError: FastCheck.string({ maxLength: 64 }).map(
    (message) => new Error(message),
  ),
  fn: FastCheck.constantFrom(makeCapturedFunction()),
  undef: FastCheck.constant(undefined),
  nested: FastCheck.record({
    array: FastCheck.array(
      FastCheck.oneof(
        FastCheck.string({ maxLength: 16 }),
        FastCheck.integer({ min: -1000, max: 1000 }),
        FastCheck.boolean(),
      ),
      { maxLength: 4 },
    ),
    object: FastCheck.record({
      maybe: FastCheck.option(FastCheck.string({ maxLength: 16 }), {
        nil: undefined,
      }),
    }),
  }),
})

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

  it("preserves captured leaf values across every codec branch", () => {
    const errorWithProperties = new Error("exploded") as Error &
      Record<string, unknown>
    Object.defineProperty(errorWithProperties, "name", {
      value: "CapturedFixtureError",
      configurable: true,
      writable: true,
    })
    errorWithProperties.code = 409
    errorWithProperties.payload = {
      bytes: new Uint8Array([9, 8, 7]),
      amount: 123456789012345678901234567890n,
    }
    const namedFn = function capturedFixtureFunction() {
      return undefined
    }

    const original = {
      text: "fixture",
      count: 42,
      enabled: true,
      nil: null,
      bigint: 123456789012345678901234567890n,
      bytes: new Uint8Array([1, 2, 3, 250, 255]),
      timestamp: new Timestamp(123456789n),
      identity: new Identity(42n),
      connectionId: new ConnectionId(17n),
      errorWithProperties,
      plainError: new Error("plain"),
      fn: makeCapturedFunction(),
      namedFn,
      undef: undefined,
      nested: [
        {
          value: 7n,
          bytes: new Uint8Array([4, 5, 6]),
        },
      ],
    }

    const serialized = serializeCapturedValue(original)
    expect(serialized).toEqual({
      text: "fixture",
      count: 42,
      enabled: true,
      nil: null,
      bigint: {
        $capturedType: "BigInt",
        value: "123456789012345678901234567890",
      },
      bytes: {
        $capturedType: "Uint8Array",
        bytes: [1, 2, 3, 250, 255],
      },
      timestamp: {
        $capturedType: "Timestamp",
        micros: "123456789",
      },
      identity: {
        $capturedType: "Identity",
        hex: "000000000000000000000000000000000000000000000000000000000000002a",
      },
      connectionId: {
        $capturedType: "ConnectionId",
        hex: "00000000000000000000000000000011",
      },
      errorWithProperties: {
        $capturedType: "Error",
        name: "CapturedFixtureError",
        message: "exploded",
        properties: {
          code: 409,
          payload: {
            bytes: {
              $capturedType: "Uint8Array",
              bytes: [9, 8, 7],
            },
            amount: {
              $capturedType: "BigInt",
              value: "123456789012345678901234567890",
            },
          },
        },
      },
      plainError: {
        $capturedType: "Error",
        name: "Error",
        message: "plain",
      },
      fn: {
        $capturedType: "Function",
        name: "",
      },
      namedFn: {
        $capturedType: "Function",
        name: "capturedFixtureFunction",
      },
      undef: {
        $capturedType: "Undefined",
      },
      nested: [
        {
          value: {
            $capturedType: "BigInt",
            value: "7",
          },
          bytes: {
            $capturedType: "Uint8Array",
            bytes: [4, 5, 6],
          },
        },
      ],
    })

    const decoded = deserializeCapturedValue(serialized) as Record<
      string,
      unknown
    >
    expect(decoded.bigint).toBe(123456789012345678901234567890n)
    expect(Array.from(decoded.bytes as Uint8Array)).toEqual([1, 2, 3, 250, 255])
    expect(
      (decoded.timestamp as Timestamp).microsSinceUnixEpoch.toString(),
    ).toBe("123456789")
    expect((decoded.identity as Identity).toHexString()).toBe(
      "000000000000000000000000000000000000000000000000000000000000002a",
    )
    expect((decoded.connectionId as ConnectionId).toHexString()).toBe(
      "00000000000000000000000000000011",
    )
    expect(decoded.nil).toBeNull()

    const decodedError = decoded.errorWithProperties as Error &
      Record<string, unknown>
    expect(decodedError).toBeInstanceOf(Error)
    expect(decodedError.name).toBe("CapturedFixtureError")
    expect(decodedError.message).toBe("exploded")
    expect(decodedError.code).toBe(409)
    const decodedPayload = decodedError.payload as Record<string, unknown>
    expect(Array.from(decodedPayload.bytes as Uint8Array)).toEqual([9, 8, 7])
    expect(decodedPayload.amount).toBe(123456789012345678901234567890n)

    const decodedPlainError = decoded.plainError as Error
    expect(decodedPlainError).toBeInstanceOf(Error)
    expect(decodedPlainError.name).toBe("Error")
    expect(decodedPlainError.message).toBe("plain")

    expect(typeof decoded.fn).toBe("function")
    expect((decoded.fn as () => unknown)()).toBeUndefined()
    expect(typeof decoded.namedFn).toBe("function")
    expect((decoded.namedFn as () => unknown).name).toBe(
      "capturedFixtureFunction",
    )
    expect((decoded.namedFn as () => unknown)()).toBeUndefined()
    expect(decoded.undef).toBeUndefined()

    const nested = decoded.nested as ReadonlyArray<Record<string, unknown>>
    expect(nested[0]?.value).toBe(7n)
    expect(Array.from(nested[0]?.bytes as Uint8Array)).toEqual([4, 5, 6])
  })

  it.prop(
    "serializes identically after deserialize/serialize roundtrip",
    [generatedCapturedValueArbitrary],
    ([original]) => {
      const serialized = serializeCapturedValue(original)

      expect(
        serializeCapturedValue(deserializeCapturedValue(serialized)),
      ).toEqual(serialized)
    },
    codecPropertyOptions,
  )
})
