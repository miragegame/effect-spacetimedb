import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Inspectable from "effect/Inspectable"
import * as Result from "effect/Result"
import { errorTypeId, hasErrorTypeId } from "./error-identity.ts"

export type StdbDecodePhase = "args" | "ok" | "row" | "declaredError"

/** The longest rendering of a structured cause an error message carries. */
const structuredCauseCharsMax = 2048

/**
 * A structured cause, rendered as JSON for an error message. The JSON
 * rendering falls back to `String` when the record cannot be serialized (a
 * throwing getter or `toJSON`), so that fallback is guarded too: rendering
 * never throws.
 */
export const renderStructuredCause = (cause: object): string => {
  const rendered = Result.getOrElse(
    Result.try(() => Inspectable.toStringUnknown(cause, 0)),
    () => Object.prototype.toString.call(cause),
  )
  return rendered.length <= structuredCauseCharsMax
    ? rendered
    : `${rendered.slice(0, structuredCauseCharsMax)}…`
}

/**
 * A cause with no message of its own reads as `String` gives it, as before;
 * only when `String` throws (a null-prototype record has nothing to convert
 * with) is it rendered structurally. A throw there would take down the
 * message being built and every report that reads it, which hid a live
 * suite's decode failure behind "TypeError: No default value".
 */
const messageFromUnknown = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message
  }
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof (cause as { readonly message?: unknown }).message === "string" &&
    (cause as { readonly message: string }).message.length > 0
  ) {
    return (cause as { readonly message: string }).message
  }
  return Result.getOrElse(
    Result.try(() => String(cause)),
    () =>
      typeof cause === "object" && cause !== null
        ? renderStructuredCause(cause)
        : Object.prototype.toString.call(cause),
  )
}

const StdbDecodeErrorTypeId = errorTypeId("StdbDecodeError")

export class StdbDecodeError extends Data.TaggedError("StdbDecodeError")<{
  readonly phase: StdbDecodePhase
  readonly cause: unknown
  readonly table?: string
  readonly callable?: string
  readonly op?: string
  readonly declaredTag?: string
}> {
  readonly [StdbDecodeErrorTypeId] = StdbDecodeErrorTypeId
  static is = hasErrorTypeId<StdbDecodeError>(StdbDecodeErrorTypeId)

  override get message(): string {
    const context = [
      this.table != null ? `table=${this.table}` : undefined,
      this.callable != null ? `callable=${this.callable}` : undefined,
      this.op != null ? `op=${this.op}` : undefined,
      this.declaredTag != null ? `declaredTag=${this.declaredTag}` : undefined,
    ].filter((entry): entry is string => entry !== undefined)

    return `SpaceTimeDB decode failed during ${this.phase}${
      context.length > 0 ? ` (${context.join(", ")})` : ""
    }: ${messageFromUnknown(this.cause)}`
  }
}

export const addDecodeContext = (
  error: StdbDecodeError,
  context: {
    readonly table?: string
    readonly callable?: string
    readonly op?: string
  },
): StdbDecodeError => {
  const table = error.table ?? context.table
  const callable = error.callable ?? context.callable
  const op = context.op ?? error.op

  return new StdbDecodeError({
    phase: error.phase,
    cause: error.cause,
    ...(error.declaredTag !== undefined
      ? { declaredTag: error.declaredTag }
      : {}),
    ...(table !== undefined ? { table } : {}),
    ...(callable !== undefined ? { callable } : {}),
    ...(op !== undefined ? { op } : {}),
  })
}

export const decodeDefectFromCause = (
  cause: Cause.Cause<unknown>,
): StdbDecodeError | undefined =>
  cause.reasons
    .filter(Cause.isDieReason)
    .map((reason) => reason.defect)
    .find(StdbDecodeError.is)
