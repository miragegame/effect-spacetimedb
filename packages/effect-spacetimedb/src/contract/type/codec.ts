import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import { StdbDecodeError, type StdbDecodePhase } from "../../decode-error.ts"
import type { AnyValueType, ValueCodec } from "./core.ts"
import { dbCodec, httpCodec, wsCodec } from "./representation-codec.ts"

export type TransportCodecKind = "http" | "ws" | "db"

const mapValueCodecError = (
  phase: StdbDecodePhase,
  cause: unknown,
): StdbDecodeError =>
  new StdbDecodeError({
    phase,
    cause,
  })

const valueCodec = <A>(
  kind: TransportCodecKind,
  type: AnyValueType,
): ValueCodec<A, unknown> =>
  Match.value(kind).pipe(
    Match.when("http", () => httpCodec<A, unknown>(type)),
    Match.when("ws", () => wsCodec<A, unknown>(type)),
    Match.when("db", () => dbCodec<A, unknown>(type)),
    Match.exhaustive,
  )

export const encode = <A>(
  kind: TransportCodecKind,
  type: AnyValueType,
  value: A,
  phase: StdbDecodePhase,
): Effect.Effect<unknown, StdbDecodeError> =>
  valueCodec<A>(kind, type)
    .encode(value)
    .pipe(Effect.mapError((cause) => mapValueCodecError(phase, cause)))

export const decode = <A>(
  kind: TransportCodecKind,
  type: AnyValueType,
  value: unknown,
  phase: StdbDecodePhase,
): Effect.Effect<A, StdbDecodeError> =>
  valueCodec<A>(kind, type)
    .decode(value)
    .pipe(Effect.mapError((cause) => mapValueCodecError(phase, cause)))

export const http = {
  encode: <A>(
    type: AnyValueType,
    value: A,
    phase: StdbDecodePhase = "args",
  ): Effect.Effect<unknown, StdbDecodeError> =>
    encode("http", type, value, phase),
  decode: <A>(
    type: AnyValueType,
    value: unknown,
    phase: StdbDecodePhase = "ok",
  ): Effect.Effect<A, StdbDecodeError> => decode("http", type, value, phase),
} as const

export const ws = {
  encode: <A>(
    type: AnyValueType,
    value: A,
    phase: StdbDecodePhase = "args",
  ): Effect.Effect<unknown, StdbDecodeError> =>
    encode("ws", type, value, phase),
  decode: <A>(
    type: AnyValueType,
    value: unknown,
    phase: StdbDecodePhase = "ok",
  ): Effect.Effect<A, StdbDecodeError> => decode("ws", type, value, phase),
} as const

export const db = {
  encode: <A>(
    type: AnyValueType,
    value: A,
    phase: StdbDecodePhase = "row",
  ): Effect.Effect<unknown, StdbDecodeError> =>
    encode("db", type, value, phase),
  decode: <A>(
    type: AnyValueType,
    value: unknown,
    phase: StdbDecodePhase = "row",
  ): Effect.Effect<A, StdbDecodeError> => decode("db", type, value, phase),
} as const
