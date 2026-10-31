import * as EffectVitest from "@effect/vitest"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import { canonicalValueKey } from "effect-spacetimedb/client"

/** A value object whose state is private, like a checked quantity or identifier. */
class KeyedValue implements Equal.Equal {
  readonly #value: number
  readonly admit = (value: number) => value

  constructor(value: number) {
    this.#value = value
  }

  key(): string {
    return `keyed:${this.#value.toString()}`
  }

  [Equal.symbol](that: unknown): boolean {
    return that instanceof KeyedValue && that.key() === this.key()
  }

  [Hash.symbol](): number {
    return Hash.string(this.key())
  }
}

EffectVitest.describe("canonicalValueKey", () => {
  EffectVitest.it(
    "keys a value object by its stable key rather than its public fields",
    () => {
      EffectVitest.expect(canonicalValueKey(new KeyedValue(7))).toBe(
        canonicalValueKey(new KeyedValue(7)),
      )
      EffectVitest.expect(canonicalValueKey(new KeyedValue(7))).not.toBe(
        canonicalValueKey(new KeyedValue(8)),
      )
      EffectVitest.expect(
        canonicalValueKey({ id: new KeyedValue(7) }),
      ).not.toBe(canonicalValueKey({ id: new KeyedValue(8) }))
    },
  )
})
