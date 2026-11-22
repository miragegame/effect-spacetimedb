import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { decodeHostValue } from "../../src/contract/type/host-codec.ts"
import { effectProperty } from "../helpers/effect-property"
import { TestLayer } from "../helpers/test-layer"
import { corpusArbitraries } from "../helpers/value-type-arbitrary"

const { expect } = EffectVitest

const codecPropertyParameters = { numRuns: 100, seed: 0xc0dec0de }

class HostRoundTripPropertyError extends Data.TaggedError(
  "HostRoundTripPropertyError",
)<{
  readonly cause: unknown
}> {}

EffectVitest.layer(TestLayer)("codec roundtrip properties", (it) => {
  for (const { kind, type, valueArbitrary } of corpusArbitraries) {
    it.effect(`ws+db roundtrip - ${kind}`, () =>
      effectProperty(
        valueArbitrary,
        (value) =>
          Effect.forEach(
            [
              StdbInternal.ClientValueCodec.ws,
              StdbInternal.ClientValueCodec.db,
            ],
            Effect.fn(function* (codec) {
              const encoded = yield* codec.encode(type, value)
              const decoded = yield* codec.decode(type, encoded)

              expect(decoded).toEqual(value)
            }),
            { discard: true },
          ),
        codecPropertyParameters,
      ),
    )

    it.effect(`host roundtrip - ${kind}`, () =>
      effectProperty(
        valueArbitrary,
        (value) =>
          Effect.try({
            try: () =>
              decodeHostValue(type, StdbInternal.encodeHostValue(type, value)),
            catch: (cause) => new HostRoundTripPropertyError({ cause }),
          }).pipe(
            Effect.map((decoded) => {
              expect(decoded).toEqual(value)
            }),
          ),
        codecPropertyParameters,
      ),
    )
  }
})
