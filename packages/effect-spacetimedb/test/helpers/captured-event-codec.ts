import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import { ConnectionId, Identity, Timestamp } from "spacetimedb"

type CapturedLeaf =
  | {
      readonly $capturedType: "Timestamp"
      readonly micros: string
    }
  | {
      readonly $capturedType: "Uint8Array"
      readonly bytes: ReadonlyArray<number>
    }
  | {
      readonly $capturedType: "Identity"
      readonly hex: string
    }
  | {
      readonly $capturedType: "ConnectionId"
      readonly hex: string
    }
  | {
      readonly $capturedType: "Error"
      readonly name: string
      readonly message: string
      readonly properties?: { readonly [key: string]: CapturedJson }
    }
  | {
      readonly $capturedType: "BigInt"
      readonly value: string
    }
  | {
      readonly $capturedType: "Undefined"
    }
  | {
      readonly $capturedType: "Function"
      readonly name: string
    }

export type CapturedJson =
  | null
  | string
  | number
  | boolean
  | CapturedLeaf
  | ReadonlyArray<CapturedJson>
  | { readonly [key: string]: CapturedJson }

type WriteCapturedJsonOptions = {
  readonly normalizeVolatileLeaves?: boolean
}

const ownString = (
  value: Record<string, unknown>,
  key: string,
): string | undefined =>
  typeof value[key] === "string" ? value[key] : undefined

const captureType = (value: Record<string, unknown>): string | undefined =>
  ownString(value, "$capturedType")

const stableConnectionIdHex = new ConnectionId(0n).toHexString()
const stableIdentityHex = Identity.zero().toHexString()

const normalizeVolatileCapturedLeaves = (value: CapturedJson): CapturedJson => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(normalizeVolatileCapturedLeaves)
  }

  const record = value as Record<string, CapturedJson>
  switch (captureType(record)) {
    case "Timestamp":
      return {
        $capturedType: "Timestamp",
        micros: "0",
      }
    case "Identity":
      return {
        $capturedType: "Identity",
        hex: stableIdentityHex,
      }
    case "ConnectionId":
      return {
        $capturedType: "ConnectionId",
        hex: stableConnectionIdHex,
      }
    case "Error":
      return {
        ...record,
        ...(typeof record.properties === "object" &&
        record.properties !== null &&
        !Array.isArray(record.properties)
          ? {
              properties: normalizeVolatileCapturedLeaves(record.properties),
            }
          : {}),
      }
    default:
      return Object.fromEntries(
        Object.entries(record).map(([key, entry]) => [
          key,
          normalizeVolatileCapturedLeaves(entry),
        ]),
      )
  }
}

export const serializeCapturedValue = (value: unknown): CapturedJson => {
  if (value === undefined) {
    return {
      $capturedType: "Undefined",
    }
  }

  if (typeof value === "function") {
    return {
      $capturedType: "Function",
      name: value.name,
    }
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (typeof value === "bigint") {
    return {
      $capturedType: "BigInt",
      value: value.toString(),
    }
  }

  if (value instanceof Timestamp) {
    return {
      $capturedType: "Timestamp",
      micros: value.microsSinceUnixEpoch.toString(),
    }
  }

  if (value instanceof Uint8Array) {
    return {
      $capturedType: "Uint8Array",
      bytes: Array.from(value),
    }
  }

  if (value instanceof Identity) {
    return {
      $capturedType: "Identity",
      hex: value.toHexString(),
    }
  }

  if (value instanceof ConnectionId) {
    return {
      $capturedType: "ConnectionId",
      hex: value.toHexString(),
    }
  }

  if (value instanceof Error) {
    const properties = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        serializeCapturedValue(entry),
      ]),
    )

    return {
      $capturedType: "Error",
      name: value.name,
      message: value.message,
      ...(Object.keys(properties).length === 0 ? {} : { properties }),
    }
  }

  if (Array.isArray(value)) {
    return value.map(serializeCapturedValue)
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        serializeCapturedValue(entry),
      ]),
    )
  }

  throw new TypeError(`Unsupported captured value leaf: ${String(value)}`)
}

export const deserializeCapturedValue = (value: CapturedJson): unknown => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(deserializeCapturedValue)
  }

  const record = value as Record<string, CapturedJson>
  switch (captureType(record)) {
    case "Timestamp":
      return new Timestamp(BigInt(ownString(record, "micros") ?? "0"))
    case "Uint8Array":
      return new Uint8Array(
        Array.isArray(record.bytes) ? (record.bytes as Array<number>) : [],
      )
    case "Identity":
      return new Identity(ownString(record, "hex") ?? "0")
    case "ConnectionId":
      return ConnectionId.fromString(ownString(record, "hex") ?? "0")
    case "Error": {
      const error = new Error(ownString(record, "message") ?? "")
      Object.defineProperty(error, "name", {
        value: ownString(record, "name") ?? "Error",
        configurable: true,
        writable: true,
      })
      if (
        typeof record.properties === "object" &&
        record.properties !== null &&
        !Array.isArray(record.properties)
      ) {
        for (const [key, entry] of Object.entries(
          record.properties as Record<string, CapturedJson>,
        )) {
          ;(error as unknown as Record<string, unknown>)[key] =
            deserializeCapturedValue(entry)
        }
      }
      return error
    }
    case "BigInt":
      return BigInt(ownString(record, "value") ?? "0")
    case "Undefined":
      return undefined
    case "Function": {
      const fn = () => undefined
      Object.defineProperty(fn, "name", {
        value: ownString(record, "name") ?? "",
        configurable: true,
      })
      return fn
    }
    default:
      return Object.fromEntries(
        Object.entries(record).map(([key, entry]) => [
          key,
          deserializeCapturedValue(entry),
        ]),
      )
  }
}

export const readCapturedJson: (
  url: URL,
) => Effect.Effect<
  unknown,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> = Effect.fn(function* (url) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const filePath = yield* path.fromFileUrl(url).pipe(Effect.orDie)
  const text = yield* fs.readFileString(filePath)
  return deserializeCapturedValue(JSON.parse(text))
})

export const writeCapturedJson: (
  url: URL,
  value: unknown,
  options?: WriteCapturedJsonOptions,
) => Effect.Effect<
  void,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> = Effect.fn(function* (url, value, options = {}) {
  const serialized = serializeCapturedValue(value)
  const captured = (() => {
    switch (options.normalizeVolatileLeaves) {
      case true:
        return normalizeVolatileCapturedLeaves(serialized)
      case false:
      case undefined:
        return serialized
    }
  })()

  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const filePath = yield* path.fromFileUrl(url).pipe(Effect.orDie)
  yield* fs.writeFileString(filePath, `${JSON.stringify(captured, null, 2)}\n`)
})

export const normalizeCapturedEventContext = (value: unknown): unknown => {
  const serialized = serializeCapturedValue(value)
  return deserializeCapturedValue(serialized)
}
