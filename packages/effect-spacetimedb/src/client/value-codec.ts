import type * as Effect from "effect/Effect"
import * as TypeCodec from "../contract/type/codec.ts"
import type { AnyValueType } from "../contract/type.ts"
import { StdbDecodeError } from "../decode-error.ts"
import * as HttpJson from "./http-json.ts"

export type TransportCodecKind = "httpJson" | "ws" | "db"

export const httpJson = {
  encodeInput: (value: unknown): string => HttpJson.encodeHttpInput(value),
  decodeOutput: <A>(
    type: AnyValueType,
    body: string,
  ): Effect.Effect<A, StdbDecodeError> =>
    HttpJson.decodeHttpOutput<A>(type, body),
} as const

export const ws = {
  encode: <A>(
    type: AnyValueType,
    value: A,
  ): Effect.Effect<unknown, StdbDecodeError> =>
    TypeCodec.ws.encode(type, value, "args"),
  decode: <A>(
    type: AnyValueType,
    value: unknown,
  ): Effect.Effect<A, StdbDecodeError> =>
    TypeCodec.ws.decode(type, value, "ok"),
} as const

export const db = {
  encode: <A>(
    type: AnyValueType,
    value: A,
  ): Effect.Effect<unknown, StdbDecodeError> =>
    TypeCodec.db.encode(type, value, "row"),
  decode: <A>(
    type: AnyValueType,
    value: unknown,
  ): Effect.Effect<A, StdbDecodeError> =>
    TypeCodec.db.decode(type, value, "row"),
} as const

export const http = {
  encode: <A>(
    type: AnyValueType,
    value: A,
  ): Effect.Effect<unknown, StdbDecodeError> =>
    TypeCodec.http.encode(type, value, "args"),
  decode: <A>(
    type: AnyValueType,
    value: unknown,
  ): Effect.Effect<A, StdbDecodeError> =>
    TypeCodec.http.decode(type, value, "ok"),
} as const
