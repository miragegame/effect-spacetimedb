import * as Data from "effect/Data"
import * as Result from "effect/Result"
import { Identity } from "spacetimedb"

declare const IdentityHexTypeId: unique symbol

export type IdentityHex = string & {
  readonly [IdentityHexTypeId]: "IdentityHex"
}

export class IdentityFormatError extends Data.TaggedError(
  "IdentityFormatError",
)<{
  readonly input: unknown
  readonly issue: "invalid-hex" | "negative" | "overflow" | "unsupported"
}> {}

const U256_LIMIT = 1n << 256n
const fixedWidthHex = /^(?:0x)?([0-9a-fA-F]{64})$/

const normalizeBigint = (
  value: bigint,
  input: unknown,
): Result.Result<IdentityHex, IdentityFormatError> => {
  if (value < 0n) {
    return Result.fail(new IdentityFormatError({ input, issue: "negative" }))
  }
  if (value >= U256_LIMIT) {
    return Result.fail(new IdentityFormatError({ input, issue: "overflow" }))
  }
  return Result.succeed(value.toString(16).padStart(64, "0") as IdentityHex)
}

/**
 * Normalizes a native Identity, a non-negative U256 bigint, or an exactly
 * 64-digit hexadecimal string. Strings may use a lowercase `0x` prefix; the
 * canonical result is lowercase, full-width, and unprefixed.
 */
export const normalizeIdentity = (
  value: unknown,
): Result.Result<IdentityHex, IdentityFormatError> => {
  if (value instanceof Identity) {
    return normalizeBigint(value.__identity__, value)
  }
  if (typeof value === "bigint") {
    return normalizeBigint(value, value)
  }
  if (typeof value === "string") {
    const match = fixedWidthHex.exec(value)
    return match === null
      ? Result.fail(
          new IdentityFormatError({ input: value, issue: "invalid-hex" }),
        )
      : Result.succeed(match[1]!.toLowerCase() as IdentityHex)
  }
  return Result.fail(
    new IdentityFormatError({ input: value, issue: "unsupported" }),
  )
}

/** Invalid inputs compare unequal, including two equally malformed values. */
export const identityEquals = (left: unknown, right: unknown): boolean => {
  const normalizedLeft = normalizeIdentity(left)
  const normalizedRight = normalizeIdentity(right)
  return Result.isSuccess(normalizedLeft) && Result.isSuccess(normalizedRight)
    ? normalizedLeft.success === normalizedRight.success
    : false
}
