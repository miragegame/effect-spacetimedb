import * as Data from "effect/Data"

export class LiveTestEffectCallbackError extends Data.TaggedError(
  "LiveTestEffectCallbackError",
)<{
  readonly operation: string
  readonly cause: unknown
}> {}

export const liveTestEffectCallbackError =
  (operation: string) => (cause: unknown) =>
    new LiveTestEffectCallbackError({ operation, cause })
