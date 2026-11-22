import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import * as References from "effect/References"
import type { SyncRunner } from "effect-spacetimedb/server"

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

/** Records what the host would read in the module log, warnings included. */
export const makeRecordingRunner = (lines: Array<string>): SyncRunner => {
  const record = (...args: ReadonlyArray<unknown>) => {
    lines.push(args.map(String).join(" "))
  }
  const recording = { ...globalThis.console, error: record, warn: record }
  const withRecording = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, Console.Console, recording)
  return {
    runSync: (effect) => effect.pipe(withRecording, Effect.runSync),
    runSyncExit: (effect) => effect.pipe(withRecording, Effect.runSyncExit),
  }
}

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
