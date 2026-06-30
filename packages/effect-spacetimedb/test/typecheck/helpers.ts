import type * as Effect from "effect/Effect"

export type Assert<T extends true> = T

export type IsEqual<A, B> = (<T>() => T extends A ? 1 : 2) extends <
  T,
>() => T extends B ? 1 : 2
  ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
    ? true
    : false
  : false

export type ExpandObject<T> = { [K in keyof T]: T[K] }

export type Expand<T> = T extends (infer Item)[]
  ? (Item extends object ? ExpandObject<Item> : Item)[]
  : T extends readonly (infer Item)[]
    ? readonly (Item extends object ? ExpandObject<Item> : Item)[]
    : T extends object
      ? ExpandObject<T>
      : T

export type ErrorOf<T extends Effect.Effect<unknown, unknown, unknown>> = [
  T,
] extends [Effect.Effect<unknown, infer E, unknown>]
  ? E
  : never
