import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
const { expect } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import { ExampleErrors, UserMissing } from "../fixtures/full-module"
import { transform } from "../helpers/schema-transform"
import { TestLayer } from "../helpers/test-layer"
import { FullModule } from "../fixtures/full-module"

const describe = EffectVitest.layer(TestLayer)

describe("callable protocol", (it) => {
  it.effect(
    "keeps the shared procedure result envelope exact across server and client",
    () =>
      Effect.gen(function* () {
        const encodedError = yield* StdbTesting.ContractError.encodeString(
          ExampleErrors,
          UserMissing.make({ userId: "user-1" as never }),
        )
        const Envelope = StdbTesting.procedureEnvelope(
          StdbTesting.ContractType.struct({
            id: StdbTesting.ContractType.string(),
          }),
          ExampleErrors,
        )

        const decodeEnvelope = Schema.decodeUnknownSync(Envelope.schema)

        expect(
          decodeEnvelope({
            tag: "ok",
            value: {
              id: "user-1",
            },
          }),
        ).toEqual({
          tag: "ok",
          value: {
            id: "user-1",
          },
        })

        expect(
          decodeEnvelope({
            tag: "err",
            value: encodedError,
          }),
        ).toEqual({
          tag: "err",
          value: encodedError,
        })
        const missing = decodeEnvelope({
          tag: "err",
          value: encodedError,
        })
        expect(missing.tag).toBe("err")
        if (missing.tag !== "err") {
          return
        }
        expect(missing.value).toBe(encodedError)

        expect(() =>
          decodeEnvelope({
            ok: {
              id: "user-1",
            },
          }),
        ).toThrow()

        const EmptyEnvelope = StdbTesting.procedureEnvelope(
          StdbTesting.ContractType.struct({}),
          ExampleErrors,
        )
        const encodeEmptyEnvelope = Schema.encodeSync(EmptyEnvelope.schema)
        const decodeEmptyEnvelope = Schema.decodeUnknownSync(
          EmptyEnvelope.schema,
        )

        expect(encodeEmptyEnvelope({ tag: "ok", value: {} })).toEqual({
          tag: "ok",
          value: {},
        })
        expect(
          decodeEmptyEnvelope({
            tag: "ok",
            value: {},
          }),
        ).toEqual({
          tag: "ok",
          value: {},
        })
      }),
  )

  it.effect(
    "uses shared codecs for nested procedure result envelope values",
    () =>
      Effect.gen(function* () {
        const dialoguePayload = StdbTesting.ContractType.struct({
          speaker: StdbTesting.ContractType.string(),
          tone: StdbTesting.ContractType.option(
            StdbTesting.ContractType.string(),
          ),
          text: StdbTesting.ContractType.string(),
        })
        const TurnEventContent = StdbTesting.ContractType.sum({
          dialogue: dialoguePayload,
        })
        const Envelope = StdbTesting.procedureEnvelope(
          StdbTesting.ContractType.array(
            StdbTesting.ContractType.struct({
              content: TurnEventContent,
            }),
          ),
          ExampleErrors,
        )
        const sdkShaped = {
          tag: "ok",
          value: [
            {
              content: {
                tag: "dialogue",
                value: {
                  speaker: "The Narrator",
                  text: "The door waits.",
                },
              },
            },
          ],
        }

        expect(
          yield* Schema.encodeEffect(Envelope.schema)({
            tag: "ok",
            value: [
              {
                content: {
                  tag: "dialogue",
                  value: {
                    speaker: "The Narrator",
                    text: "The door waits.",
                  },
                },
              },
            ],
          } as never),
        ).toEqual({
          tag: "ok",
          value: [
            {
              content: {
                dialogue: {
                  speaker: "The Narrator",
                  tone: {
                    none: {},
                  },
                  text: "The door waits.",
                },
              },
            },
          ],
        })
        expect(
          yield* Schema.decodeUnknownEffect(Envelope.schema)(sdkShaped),
        ).toEqual({
          tag: "ok",
          value: [
            {
              content: {
                tag: "dialogue",
                value: {
                  speaker: "The Narrator",
                  tone: undefined,
                  text: "The door waits.",
                },
              },
            },
          ],
        })

        const MaybeEnvelope = StdbTesting.procedureEnvelope(
          StdbTesting.ContractType.option(StdbTesting.ContractType.string()),
          ExampleErrors,
        )
        const encodedNone = yield* Schema.encodeEffect(MaybeEnvelope.schema)({
          tag: "ok",
          value: undefined,
        })
        expect(encodedNone).toEqual({
          tag: "ok",
          value: {
            none: {},
          },
        })
        const decodedNone = yield* Schema.decodeUnknownEffect(
          MaybeEnvelope.schema,
        )(encodedNone)
        expect(Object.hasOwn(decodedNone, "value")).toBe(true)
        expect(decodedNone).toEqual({
          tag: "ok",
          value: undefined,
        })
      }),
  )

  it.effect("round-trips procedure result values that lower to unit wire", () =>
    Effect.gen(function* () {
      const Done = StdbTesting.ContractType.custom(
        transform(Schema.Void, Schema.Literal("done"), {
          decode: () => "done" as const,
          encode: () => undefined,
        }),
        { type: StdbTesting.ContractType.unit() },
      )
      const Envelope = StdbTesting.procedureEnvelope(Done, ExampleErrors)

      const encoded = yield* Schema.encodeEffect(Envelope.schema)({
        tag: "ok",
        value: "done",
      })
      expect(encoded).toEqual({
        tag: "ok",
      })

      const decoded = yield* Schema.decodeUnknownEffect(Envelope.schema)(
        encoded,
      )
      expect(decoded).toEqual({
        tag: "ok",
        value: "done",
      })

      const invalid = yield* Effect.exit(
        Schema.encodeEffect(Envelope.schema)({
          tag: "ok",
          value: "not done",
        } as never),
      )
      expect(Exit.isFailure(invalid)).toBe(true)
    }),
  )

  it.effect("caches procedure response envelopes per spec", () =>
    Effect.gen(function* () {
      const first = StdbTesting.procedureResponseType(
        FullModule.procedures.userGet,
      )
      const second = StdbTesting.procedureResponseType(
        FullModule.procedures.userGet,
      )
      const descriptorBacked = StdbTesting.procedureResponseType(
        StdbTesting.procedureCallable("userGet", FullModule.procedures.userGet),
      )

      expect(first).toBe(second)
      expect(descriptorBacked).toBe(first)
      expect(
        StdbTesting.procedureResponseType(FullModule.procedures.reminderFire),
      ).toBe(FullModule.procedures.reminderFire.returns)
    }),
  )

  it.effect("creates shared callable descriptors for callables", () =>
    Effect.gen(function* () {
      const reducer = StdbTesting.reducerCallable(
        "userUpsert",
        FullModule.reducers.userUpsert,
      )
      const procedure = StdbTesting.procedureCallable(
        "userGet",
        FullModule.procedures.userGet,
      )
      const httpHandler = StdbTesting.httpHandlerCallable(
        "rotateToken",
        FullModule.httpHandlers.rotateToken,
      )

      expect(reducer).toEqual(
        expect.objectContaining({
          kind: "reducer",
          name: "userUpsert",
          params: FullModule.reducers.userUpsert.params,
        }),
      )
      expect(procedure).toEqual(
        expect.objectContaining({
          kind: "procedure",
          name: "userGet",
          params: FullModule.procedures.userGet.params,
          returns: FullModule.procedures.userGet.returns,
        }),
      )
      expect(httpHandler).toEqual(
        expect.objectContaining({
          kind: "httpHandler",
          name: "rotateToken",
          method: "post",
          path: "/server-tokens/rotate",
          spec: FullModule.httpHandlers.rotateToken,
        }),
      )
    }),
  )
})
