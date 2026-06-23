import * as Effect from "effect/Effect"

import * as Schema from "effect/Schema"

import { type AnyValueType } from "../../contract/type.ts"

import { StdbDecodeError } from "../../decode-error.ts"

import { normalizeValueType } from "./http-json-output.ts"

import {
  escapeJsonString,
  parseFailure,
  parseJsonPreservingIntegers,
} from "./http-json-parser.ts"

import type { JsonStringifyState } from "./http-json-parser.ts"

export const stringifyValue = (
  value: unknown,
  state: JsonStringifyState,
): string | undefined => {
  if (value === null) {
    return "null"
  }

  if (typeof value === "bigint") {
    return value.toString()
  }

  if (typeof value === "string") {
    return escapeJsonString(value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot encode non-finite number over HTTP JSON")
    }
    return String(value)
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }

  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return undefined
  }

  if (typeof value !== "object") {
    return escapeJsonString(String(value))
  }

  if (value instanceof Uint8Array) {
    return `[${Array.from(value).join(",")}]`
  }

  const toJSON = (value as { readonly toJSON?: unknown }).toJSON
  if (typeof toJSON === "function") {
    const jsonValue = toJSON.call(value)
    if (jsonValue !== value) {
      return stringifyValue(jsonValue, state)
    }
  }

  if (state.seen.has(value)) {
    throw new TypeError("Converting circular structure to JSON")
  }
  state.seen.add(value)

  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((entry) => stringifyValue(entry, state) ?? "null")
        .join(",")}]`
    }

    const fields = Object.entries(value).flatMap(([key, entry]) => {
      const encoded = stringifyValue(entry, state)
      return encoded === undefined
        ? []
        : [`${escapeJsonString(key)}:${encoded}`]
    })

    return `{${fields.join(",")}}`
  } finally {
    state.seen.delete(value)
  }
}

export const stringify = (value: unknown): string =>
  stringifyValue(value, { seen: new WeakSet() }) ?? "null"

export const encodeHttpInput = (value: unknown): string => stringify(value)

export const decodeHttpOutput = <A>(
  type: AnyValueType,
  body: string,
): Effect.Effect<A, StdbDecodeError> =>
  parseJsonPreservingIntegers(body).pipe(
    Effect.flatMap((parsed) =>
      Effect.try({
        try: () => normalizeValueType(type, parsed),
        catch: (cause) => parseFailure(body, cause),
      }),
    ),
    Effect.flatMap((normalized) =>
      Schema.decodeUnknownEffect(type.schema)(normalized),
    ),
    Effect.map((decoded) => decoded as A),
    Effect.mapError((cause) => new StdbDecodeError({ phase: "ok", cause })),
  )
