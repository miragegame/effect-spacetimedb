import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { TestLayer } from "../helpers/test-layer"

const describeLayer = EffectVitest.layer(TestLayer)

describeLayer("transport tag-casing goldens", (it) => {
  it.effect("keeps literal enum casing exact across transports", () =>
    Effect.gen(function* () {
      const Literal = StdbInternal.ContractType.literal("joined", "left")

      expect(
        yield* StdbInternal.ClientValueCodec.ws.encode(Literal, "joined"),
      ).toEqual({
        tag: "Joined",
      })
      expect(
        yield* StdbInternal.ClientValueCodec.db.encode(Literal, "joined"),
      ).toEqual({
        tag: "joined",
      })
      expect(
        yield* StdbInternal.ClientValueCodec.http.encode(Literal, "joined"),
      ).toEqual({
        tag: "joined",
      })
    }),
  )

  it.effect("keeps sum tag casing exact across transports", () =>
    Effect.gen(function* () {
      const Sum = StdbInternal.ContractType.sum({
        prose: StdbInternal.ContractType.struct({
          text: StdbInternal.ContractType.string(),
        }),
        untilRemoved: StdbInternal.ContractType.unit(),
      })

      expect(
        yield* StdbInternal.ClientValueCodec.ws.encode(
          Sum,
          Sum.make.prose({ text: "hello" }),
        ),
      ).toEqual({
        tag: "Prose",
        value: {
          text: "hello",
        },
      })
      expect(
        yield* StdbInternal.ClientValueCodec.db.encode(
          Sum,
          Sum.make.prose({ text: "hello" }),
        ),
      ).toEqual({
        tag: "prose",
        value: {
          text: "hello",
        },
      })
      expect(
        yield* StdbInternal.ClientValueCodec.http.encode(
          Sum,
          Sum.make.prose({ text: "hello" }),
        ),
      ).toEqual({
        prose: {
          text: "hello",
        },
      })
      expect(
        yield* StdbInternal.ClientValueCodec.ws.encode(
          Sum,
          Sum.make.untilRemoved,
        ),
      ).toEqual({
        tag: "UntilRemoved",
      })
      expect(
        yield* StdbInternal.ClientValueCodec.db.encode(
          Sum,
          Sum.make.untilRemoved,
        ),
      ).toEqual({
        tag: "untilRemoved",
      })
      expect(
        yield* StdbInternal.ClientValueCodec.http.encode(
          Sum,
          Sum.make.untilRemoved,
        ),
      ).toEqual({
        untilRemoved: {},
      })
    }),
  )
})
