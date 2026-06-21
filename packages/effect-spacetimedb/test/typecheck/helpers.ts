import type * as Effect from "effect/Effect"

export type Assert<T extends true> = T

export type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends <
  T,
>() => T extends B ? 1 : 2
  ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
    ? true
    : false
  : false

export type ErrorOf<T extends Effect.Effect<unknown, unknown, unknown>> = [
  T,
] extends [Effect.Effect<unknown, infer E, unknown>]
  ? E
  : never
