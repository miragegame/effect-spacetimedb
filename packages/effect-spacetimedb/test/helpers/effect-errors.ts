import * as Data from "effect/Data"

export class TestEffectCallbackError extends Data.TaggedError(
  "TestEffectCallbackError",
)<{
  readonly operation: string
  readonly cause: unknown
}> {}

export const testEffectCallbackError =
  (operation: string) => (cause: unknown) =>
    new TestEffectCallbackError({ operation, cause })

export const unwrapTestEffectCallbackError = (cause: unknown): unknown =>
  cause instanceof TestEffectCallbackError ? cause.cause : cause
