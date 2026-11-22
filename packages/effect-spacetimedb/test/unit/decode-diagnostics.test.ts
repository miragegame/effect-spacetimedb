import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Schema from "effect/Schema"
const { expect } = EffectVitest
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { ExampleErrors } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const expectDiagnostic = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  expected: string,
) =>
  Effect.gen(function* () {
    const failure = yield* effect.pipe(Effect.asVoid, Effect.flip)
    const message = String(failure)

    expect(message).toContain(expected)
    expect(message).not.toContain("Expected unknown")
  })

describe("decode diagnostics", (it) => {
  it.effect("surfaces struct decode shape messages", () =>
    Effect.gen(function* () {
      const User = StdbInternal.ContractType.struct({
        id: StdbInternal.ContractType.string(),
      })

      yield* expectDiagnostic(
        Schema.decodeUnknownEffect(User.schema)("not-an-object"),
        "Expected struct object",
      )
      yield* expectDiagnostic(
        Schema.decodeUnknownEffect(User.schema)({}),
        "Missing required struct field id",
      )
    }),
  )

  it.effect("surfaces procedure envelope decode shape messages", () =>
    Effect.gen(function* () {
      const Envelope = StdbInternal.procedureEnvelope(
        StdbInternal.ContractType.struct({
          id: StdbInternal.ContractType.string(),
        }),
        ExampleErrors,
      )

      yield* expectDiagnostic(
        Schema.decodeUnknownEffect(Envelope.schema)({
          ok: {
            id: "user-1",
          },
        }),
        "Expected procedure result envelope",
      )
    }),
  )

  it.effect("surfaces result and sum encode envelope messages", () =>
    Effect.gen(function* () {
      const ResultType = StdbInternal.ContractType.result(
        StdbInternal.ContractType.string(),
        StdbInternal.ContractType.string(),
      )
      const SumType = StdbInternal.ContractType.sum({
        pending: StdbInternal.ContractType.unit(),
        named: StdbInternal.ContractType.struct({
          name: StdbInternal.ContractType.string(),
        }),
      })

      yield* expectDiagnostic(
        Schema.encodeEffect(ResultType.schema)({
          value: "missing tag",
        } as never),
        "Expected result envelope",
      )
      yield* expectDiagnostic(
        Schema.encodeEffect(SumType.schema)("missing-envelope" as never),
        "Expected sum envelope",
      )
    }),
  )

  it.effect("preserves HTTP JSON normalization failure messages", () =>
    expectDiagnostic(
      StdbInternal.ClientValueCodec.httpJson.decodeOutput<bigint>(
        StdbInternal.ContractType.u64(),
        '"not-an-integer"',
      ),
      "Expected JSON integer",
    ),
  )
})
