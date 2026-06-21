// lint-ignore: stdb-string-columns-require-domain - tag-casing goldens intentionally exercise raw string constructors.
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"

const describeLayer = EffectVitest.layer(TestLayer)

describeLayer("transport tag-casing goldens", (it) => {
  it.effect("keeps literal enum casing exact across transports", () =>
    Effect.gen(function* () {
      const Literal = StdbTesting.ContractType.literal("joined", "left")

      expect(
        yield* StdbTesting.ClientTransportCodec.ws.encode(Literal, "joined"),
      ).toEqual({
        tag: "Joined",
      })
      expect(
        yield* StdbTesting.ClientTransportCodec.db.encode(Literal, "joined"),
      ).toEqual({
        tag: "joined",
      })
      expect(
        yield* StdbTesting.ClientTransportCodec.http.encode(Literal, "joined"),
      ).toEqual({
        tag: "joined",
      })
    }),
  )

  it.effect("keeps sum tag casing exact across transports", () =>
    Effect.gen(function* () {
      const Sum = StdbTesting.ContractType.sum({
        prose: StdbTesting.ContractType.struct({
          text: StdbTesting.ContractType.string(),
        }),
        untilRemoved: StdbTesting.ContractType.unit(),
      })

      expect(
        yield* StdbTesting.ClientTransportCodec.ws.encode(
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
        yield* StdbTesting.ClientTransportCodec.db.encode(
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
        yield* StdbTesting.ClientTransportCodec.http.encode(
          Sum,
          Sum.make.prose({ text: "hello" }),
        ),
      ).toEqual({
        prose: {
          text: "hello",
        },
      })
      expect(
        yield* StdbTesting.ClientTransportCodec.ws.encode(
          Sum,
          Sum.make.untilRemoved,
        ),
      ).toEqual({
        tag: "UntilRemoved",
      })
      expect(
        yield* StdbTesting.ClientTransportCodec.db.encode(
          Sum,
          Sum.make.untilRemoved,
        ),
      ).toEqual({
        tag: "untilRemoved",
      })
      expect(
        yield* StdbTesting.ClientTransportCodec.http.encode(
          Sum,
          Sum.make.untilRemoved,
        ),
      ).toEqual({
        untilRemoved: {},
      })
    }),
  )
})
