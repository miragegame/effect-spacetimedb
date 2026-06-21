import * as Cause from "effect/Cause"
import * as Data from "effect/Data"

export type StdbDecodePhase = "args" | "ok" | "row" | "declaredError"

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

  return String(cause)
}

export class StdbDecodeError extends Data.TaggedError("StdbDecodeError")<{
  readonly phase: StdbDecodePhase
  readonly cause: unknown
  readonly table?: string
  readonly callable?: string
  readonly op?: string
  readonly declaredTag?: string
}> {
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
    .find(
      (defect): defect is StdbDecodeError => defect instanceof StdbDecodeError,
    )
