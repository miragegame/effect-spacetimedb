import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as References from "effect/References"

export type CapturedLog = {
  readonly annotations: Record<string, unknown>
}

const makeCapturedLogger = (records: Array<CapturedLog>) =>
  Logger.make<unknown, void>((options) => {
    records.push({
      annotations: {
        ...options.fiber.getRef(References.CurrentLogAnnotations),
      },
    })
  })

export const logWithCapturedLogger = (
  records: Array<CapturedLog>,
  message: string,
) =>
  Effect.log(message).pipe(
    Effect.provide(Logger.layer([makeCapturedLogger(records)])),
  )

export const hostCause = (name: string): Error => {
  const cause = new Error(`${name} failed`)
  Object.defineProperty(cause, "name", {
    value: name,
  })
  return cause
}

export const assertHostBoundaryThrow = (
  cause: unknown,
  op: string,
  originalCause: Error,
): void => {
  if (!(cause instanceof Error)) {
    throw new Error("Expected host boundary to throw an Error")
  }
  if (!cause.message.includes(`SpaceTimeDB host call failed at ${op}`)) {
    throw new Error(`Expected host boundary message to include op ${op}`)
  }
  if (!cause.message.includes(originalCause.message)) {
    throw new Error("Expected host boundary message to include original cause")
  }
  if (cause.cause !== originalCause) {
    throw new Error("Expected host boundary Error.cause to preserve cause")
  }
}
