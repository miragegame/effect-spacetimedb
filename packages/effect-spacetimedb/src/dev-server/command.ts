import * as Effect from "effect/Effect"
import type * as PlatformError from "effect/PlatformError"
import * as Stream from "effect/Stream"
import * as ChildProcess from "effect/process/ChildProcess"
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import { DevServerBinaryError, DevServerCommandError } from "./model.ts"

type CapturedCommandOutput = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

type CommandRunOptions = {
  readonly displayArgs?: ReadonlyArray<string> | undefined
  readonly sensitiveValues?: ReadonlyArray<string> | undefined
  /** Fails the command once its stdout passes this many bytes. */
  readonly stdoutBytesMax?: number | undefined
}

const commandDisplay = (command: string, args: ReadonlyArray<string>): string =>
  [command, ...args].join(" ")

const redactText = (
  text: string,
  sensitiveValues: ReadonlyArray<string>,
): string =>
  sensitiveValues.reduce(
    (redacted, value) =>
      value.length === 0 ? redacted : redacted.replaceAll(value, "<redacted>"),
    text,
  )

const redactCause = (
  cause: unknown,
  sensitiveValues: ReadonlyArray<string>,
): unknown =>
  sensitiveValues.length === 0
    ? cause
    : {
        message: redactText(
          cause instanceof Error ? cause.message : String(cause),
          sensitiveValues,
        ),
      }

export const splitBinaryCommand = (
  binary: ReadonlyArray<string>,
  label: string,
): Effect.Effect<
  readonly [command: string, prefixArgs: ReadonlyArray<string>],
  DevServerBinaryError
> => {
  const [command, ...prefixArgs] = binary
  if (command === undefined || command.length === 0) {
    return Effect.fail(
      new DevServerBinaryError({
        command: label,
        cause: "binary command was empty",
      }),
    )
  }

  return Effect.succeed([command, prefixArgs] as const)
}

const limitBytes = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  command: string,
  bytesMax: number | undefined,
): Stream.Stream<
  Uint8Array,
  PlatformError.PlatformError | DevServerBinaryError
> =>
  bytesMax === undefined
    ? stream
    : Stream.suspend(() => {
        let bytesSeen = 0
        return stream.pipe(
          Stream.mapEffect((chunk) => {
            bytesSeen += chunk.byteLength
            return bytesSeen > bytesMax
              ? Effect.fail(
                  new DevServerBinaryError({
                    command,
                    cause: `output exceeded ${bytesMax.toString()} bytes`,
                  }),
                )
              : Effect.succeed(chunk)
          }),
        )
      })

const collectTextStream = (
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  command: string,
  sensitiveValues: ReadonlyArray<string>,
  bytesMax?: number,
) =>
  Stream.runFold(
    Stream.decodeText(limitBytes(stream, command, bytesMax)),
    () => "",
    (current, chunk) => `${current}${chunk}`,
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof DevServerBinaryError
        ? cause
        : new DevServerBinaryError({
            command,
            cause: redactCause(cause, sensitiveValues),
          }),
    ),
  )

const runCapturedCommand = (
  command: ChildProcess.Command,
  commandName: string,
  sensitiveValues: ReadonlyArray<string>,
  stdoutBytesMax: number | undefined,
): Effect.Effect<
  CapturedCommandOutput,
  DevServerBinaryError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  command.pipe(
    Effect.mapError(
      (cause: PlatformError.PlatformError) =>
        new DevServerBinaryError({
          command: commandName,
          cause: redactCause(cause, sensitiveValues),
        }),
    ),
    Effect.flatMap((process) =>
      Effect.all(
        {
          exitCode: process.exitCode.pipe(
            Effect.map(Number),
            Effect.mapError(
              (cause) =>
                new DevServerBinaryError({
                  command: commandName,
                  cause: redactCause(cause, sensitiveValues),
                }),
            ),
          ),
          stdout: collectTextStream(
            process.stdout,
            commandName,
            sensitiveValues,
            stdoutBytesMax,
          ),
          stderr: collectTextStream(
            process.stderr,
            commandName,
            sensitiveValues,
          ),
        },
        { concurrency: "unbounded" },
      ),
    ),
    Effect.scoped,
  )

export const runCommand = Effect.fn(function* (
  binary: ReadonlyArray<string>,
  args: ReadonlyArray<string>,
  options: ChildProcess.CommandOptions,
  runOptions: CommandRunOptions = {},
) {
  const [command, prefixArgs] = yield* splitBinaryCommand(binary, "command")
  const commandArgs = [...prefixArgs, ...args]
  const sensitiveValues = runOptions.sensitiveValues ?? []
  const rendered = redactText(
    commandDisplay(command, [
      ...prefixArgs,
      ...(runOptions.displayArgs ?? args),
    ]),
    sensitiveValues,
  )
  const output = yield* runCapturedCommand(
    ChildProcess.make(command, commandArgs, {
      extendEnv: true,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      ...options,
    }),
    rendered,
    sensitiveValues,
    runOptions.stdoutBytesMax,
  )

  if (output.exitCode !== 0) {
    return yield* new DevServerCommandError({
      command: rendered,
      exitCode: output.exitCode,
      stdout: redactText(output.stdout, sensitiveValues),
      stderr: redactText(output.stderr, sensitiveValues),
    })
  }

  return output.stdout
})
