import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"
import { typeBuilder } from "../helpers/type-builder"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const Item = Stdb.struct({ name: Stdb.string(), count: Stdb.u32() })
const BoundedItems = Stdb.array(Item, { minimum: 1, maximum: 3 })
const WiderItems = Stdb.array(Item, { minimum: 0, maximum: 100 })

const item = (name: string) => ({ name, count: 1 })

const decode = (type: Stdb.AnyValueType, value: unknown) =>
  Schema.decodeUnknownEffect(type.schema)(value)

const encode = (type: Stdb.AnyValueType, value: unknown) =>
  Schema.encodeUnknownEffect(type.schema)(value)

describe("Stdb.array length bounds", (it) => {
  it.effect("decodes and encodes lengths inside the inclusive bounds", () =>
    Effect.forEach(
      [1, 2, 3],
      (length) =>
        Effect.gen(function* () {
          const value = Array.from({ length }, (_, index) => item(`i${index}`))
          expect(yield* decode(BoundedItems, value)).toEqual(value)
          expect(yield* encode(BoundedItems, value)).toEqual(value)
        }),
      { concurrency: 1 },
    ),
  )

  it.effect("rejects decoding below the minimum and above the maximum", () =>
    Effect.gen(function* () {
      const empty = yield* Effect.exit(decode(BoundedItems, []))
      const tooMany = yield* Effect.exit(
        decode(BoundedItems, [item("a"), item("b"), item("c"), item("d")]),
      )

      expect(Exit.isFailure(empty)).toBe(true)
      expect(Exit.isFailure(tooMany)).toBe(true)
    }),
  )

  it.effect("rejects encoding below the minimum and above the maximum", () =>
    Effect.gen(function* () {
      const empty = yield* Effect.exit(encode(BoundedItems, []))
      const tooMany = yield* Effect.exit(
        encode(BoundedItems, [item("a"), item("b"), item("c"), item("d")]),
      )

      expect(Exit.isFailure(empty)).toBe(true)
      expect(Exit.isFailure(tooMany)).toBe(true)
    }),
  )

  it.effect("enforces bounds through the WS, DB and HTTP codecs", () => {
    const tooMany = [item("a"), item("b"), item("c"), item("d")]
    const Holder = Stdb.struct({ items: BoundedItems })
    const WiderHolder = Stdb.struct({ items: WiderItems })
    const codecs = [
      StdbTesting.ClientValueCodec.ws,
      StdbTesting.ClientValueCodec.db,
      StdbTesting.ClientValueCodec.http,
    ]

    return Effect.forEach(
      codecs,
      (codec) =>
        Effect.gen(function* () {
          const wireEncoded = yield* codec.encode(WiderHolder, {
            items: tooMany,
          })
          const decoded = yield* Effect.exit(codec.decode(Holder, wireEncoded))
          const encoded = yield* Effect.exit(
            codec.encode(Holder, { items: tooMany }),
          )

          expect(Exit.isFailure(decoded)).toBe(true)
          expect(Exit.isFailure(encoded)).toBe(true)
          expect(
            yield* codec.decode(
              Holder,
              yield* codec.encode(Holder, { items: [item("a")] }),
            ),
          ).toEqual({ items: [item("a")] })
        }),
      { concurrency: 1 },
    )
  })

  it("reports a structured host encode error for an out-of-bounds array", () => {
    let caught: unknown
    try {
      StdbTesting.encodeHostValue(BoundedItems, [])
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(StdbTesting.StdbHostEncodeError)
    expect(caught).toMatchObject({
      reason: "ArrayLengthOutOfBounds",
      length: 0,
      bounds: { minimum: 1, maximum: 3 },
      message: "Host array length 0 is outside its declared bounds 1..3",
    })
  })

  it("lowers arrays differing only in bounds to the same SATS type", () => {
    expect(typeBuilder(BoundedItems)).toEqual(typeBuilder(WiderItems))
    // Control: the builder comparison does distinguish different item types.
    expect(
      typeBuilder(Stdb.array(Stdb.string(), { minimum: 1, maximum: 3 })),
    ).not.toEqual(typeBuilder(WiderItems))
    expect(StdbTesting.ContractType.satsTypeFingerprint(BoundedItems)).toBe(
      StdbTesting.ContractType.satsTypeFingerprint(WiderItems),
    )

    const NarrowHost = Stdb.struct({ items: BoundedItems })
    const WiderHost = Stdb.struct({ items: WiderItems })
    expect(typeBuilder(NarrowHost)).toEqual(typeBuilder(WiderHost))
  })

  it("records the bounds in the type descriptor", () => {
    expect(Stdb.describe(BoundedItems)).toMatchObject({
      _tag: "Array",
      kind: "array",
      item: Item,
      length: { minimum: 1, maximum: 3 },
    })
    expect(Stdb.describe(WiderItems)).toMatchObject({
      length: { minimum: 0, maximum: 100 },
    })
  })

  it.effect("accepts an exact length and an empty-only array", () =>
    Effect.gen(function* () {
      const Pair = Stdb.array(Stdb.string(), { minimum: 2, maximum: 2 })
      const Empty = Stdb.array(Stdb.string(), { minimum: 0, maximum: 0 })

      expect(yield* decode(Pair, ["a", "b"])).toEqual(["a", "b"])
      expect(Exit.isFailure(yield* Effect.exit(decode(Pair, ["a"])))).toBe(true)
      expect(yield* decode(Empty, [])).toEqual([])
      expect(Exit.isFailure(yield* Effect.exit(decode(Empty, ["a"])))).toBe(
        true,
      )
    }),
  )

  it("throws a TypeError for invalid bounds at construction", () => {
    const invalid = [
      { minimum: -1, maximum: 3 },
      { minimum: 0, maximum: -1 },
      { minimum: 1.5, maximum: 3 },
      { minimum: 0, maximum: 2.5 },
      { minimum: 0, maximum: Number.POSITIVE_INFINITY },
      { minimum: Number.NaN, maximum: 3 },
      { minimum: 0, maximum: Number.MAX_SAFE_INTEGER + 1 },
      { minimum: 4, maximum: 3 },
    ]

    for (const length of invalid) {
      expect(() => Stdb.array(Stdb.string(), length)).toThrow(TypeError)
    }
  })

  it.effect("keeps the bounds it was built with if the options mutate", () =>
    Effect.gen(function* () {
      const options = { minimum: 0, maximum: 1 }
      const Bounded = Stdb.array(Stdb.string(), options)
      options.maximum = 10

      expect(Stdb.describe(Bounded)).toMatchObject({
        length: { minimum: 0, maximum: 1 },
      })
      expect(
        Exit.isFailure(yield* Effect.exit(decode(Bounded, ["a", "b"]))),
      ).toBe(true)
    }),
  )
})
