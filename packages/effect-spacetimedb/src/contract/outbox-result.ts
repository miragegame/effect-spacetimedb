import * as Data from "effect/Data"
import { result, unit } from "./type/constructors.ts"
import { string } from "./type/primitives.ts"

/**
 * How the receiving database answered one outbox row, as its settle reducer
 * sees it. `Delivered` means the receiver reducer committed. `Refused` carries
 * the receiver's failure text: a refusal it threw, a signature or validation
 * mismatch, or an exhausted energy budget, which the host does not tell apart.
 * Transport failures never settle; the host retries them until they deliver.
 */
export type OutboxResult = Data.TaggedEnum<{
  readonly Delivered: {}
  readonly Refused: { readonly message: string }
}>

export const OutboxResult = Data.taggedEnum<OutboxResult>()

/**
 * The settle reducer's `result` parameter: the host's `Result<(), String>`.
 * One shared value so validation recognises a settle reducer's params by
 * identity; the compiled settle reducer reads it with `outboxResultFromHost`.
 */
export const OutboxResultValue = result(unit(), string())

export class OutboxResultHostValueDefect extends Data.TaggedError(
  "OutboxResultHostValueDefect",
)<{
  readonly value: unknown
}> {}

/**
 * Reads the host's settle outcome, `{ ok: {} }` or `{ err: message }`. The
 * host builds it from the receiver's answer, so any other shape is a defect.
 */
export const outboxResultFromHost = (value: unknown): OutboxResult => {
  if (typeof value === "object" && value !== null) {
    if (Object.hasOwn(value, "err")) {
      const message = (value as { readonly err?: unknown }).err
      if (typeof message === "string") {
        return OutboxResult.Refused({ message })
      }
    } else if (Object.hasOwn(value, "ok")) {
      return OutboxResult.Delivered()
    }
  }
  throw new OutboxResultHostValueDefect({ value })
}
