import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import * as SpacetimeDB from "spacetimedb"

const { expect } = EffectVitest

import * as StdbTesting from "effect-spacetimedb/testing"
import { ExampleErrors } from "../fixtures/full-module"
import { codecCorpusEntries } from "../helpers/codec-corpus"
import { TestLayer } from "../helpers/test-layer"
import { typeBuilder } from "../helpers/type-builder"

const describe = EffectVitest.layer(TestLayer)

const nativeRoundTrip = (
  type: Parameters<
    typeof StdbTesting.ContractTypeSats.typeBuilderWithFactories
  >[0],
  value: unknown,
): unknown => {
  const algebraic = Reflect.get(typeBuilder(type), "algebraicType") as
    | SpacetimeDB.AlgebraicType
    | undefined
  if (algebraic === undefined) {
    throw new Error("Expected native algebraic type")
  }
  const writer = new SpacetimeDB.BinaryWriter(16)
  SpacetimeDB.AlgebraicType.makeSerializer(algebraic)(writer, value)
  return SpacetimeDB.AlgebraicType.makeDeserializer(algebraic)(
    new SpacetimeDB.BinaryReader(writer.getBuffer()),
  )
}

const nativeBytes = (
  type: Parameters<
    typeof StdbTesting.ContractTypeSats.typeBuilderWithFactories
  >[0],
  value: unknown,
): Uint8Array => {
  const algebraic = Reflect.get(typeBuilder(type), "algebraicType") as
    | SpacetimeDB.AlgebraicType
    | undefined
  if (algebraic === undefined) {
    throw new Error("Expected native algebraic type")
  }
  const writer = new SpacetimeDB.BinaryWriter(16)
  SpacetimeDB.AlgebraicType.makeSerializer(algebraic)(writer, value)
  return writer.getBuffer()
}

const expectNativeHostTransportRoundTrip = Effect.fn(function* <A>(
  type: Parameters<
    typeof StdbTesting.ContractTypeSats.typeBuilderWithFactories
  >[0],
  value: A,
) {
  const wsEncoded = yield* StdbTesting.ClientTransportCodec.ws.encode(
    type,
    value,
  )
  const wsNative = nativeRoundTrip(type, wsEncoded)
  expect(
    yield* StdbTesting.ClientTransportCodec.ws.decode(type, wsNative),
  ).toEqual(value)

  const dbEncoded = yield* StdbTesting.ClientTransportCodec.db.encode(
    type,
    value,
  )
  const dbNative = nativeRoundTrip(type, dbEncoded)
  expect(
    yield* StdbTesting.ClientTransportCodec.db.decode(type, dbNative),
  ).toEqual(value)
})

describe("transport codec boundary", (it) => {
  it.effect("round-trips every TypeKind through WS and DB codecs", () =>
    Effect.forEach(
      codecCorpusEntries,
      ([kind, sample]) =>
        Effect.gen(function* () {
          const wsEncoded = yield* StdbTesting.ClientTransportCodec.ws.encode(
            sample.type,
            sample.value,
          )
          const dbEncoded = yield* StdbTesting.ClientTransportCodec.db.encode(
            sample.type,
            sample.value,
          )

          expect(
            yield* StdbTesting.ClientTransportCodec.ws.decode(
              sample.type,
              wsEncoded,
            ),
            `WS codec failed for ${kind}`,
          ).toEqual(sample.value)
          expect(
            yield* StdbTesting.ClientTransportCodec.db.decode(
              sample.type,
              dbEncoded,
            ),
            `DB codec failed for ${kind}`,
          ).toEqual(sample.value)
        }),
      { discard: true },
    ),
  )

  it.effect(
    "preserves native DB BSATN bytes for every TypeKind corpus sample",
    () =>
      Effect.forEach(
        codecCorpusEntries,
        ([kind, sample]) =>
          Effect.gen(function* () {
            const dbEncoded = yield* StdbTesting.ClientTransportCodec.db.encode(
              sample.type,
              sample.value,
            )

            expect(
              Array.from(
                nativeBytes(
                  sample.type,
                  nativeRoundTrip(sample.type, dbEncoded),
                ),
              ),
              `DB native bytes changed for ${kind}`,
            ).toEqual(Array.from(nativeBytes(sample.type, dbEncoded)))
          }),
        { discard: true },
      ),
  )

  it("lowers every TypeKind corpus sample to a SATS algebraic type", () => {
    for (const [kind, sample] of codecCorpusEntries) {
      const algebraic = Reflect.get(typeBuilder(sample.type), "algebraicType")

      expect(algebraic, `missing SATS algebraic type for ${kind}`).toEqual(
        expect.objectContaining({
          tag: expect.any(String),
        }),
      )
    }
  })

  it.effect(
    "round-trips structural Result err payloads through patched bindings",
    () =>
      Effect.gen(function* () {
        const factories = SpacetimeDB.t
        const roundTrip = (type: SpacetimeDB.AlgebraicType, value: unknown) => {
          const writer = new SpacetimeDB.BinaryWriter(16)
          SpacetimeDB.AlgebraicType.makeSerializer(type)(writer, value)
          return SpacetimeDB.AlgebraicType.makeDeserializer(type)(
            new SpacetimeDB.BinaryReader(writer.getBuffer()),
          )
        }
        const StructOkResult = factories.result(
          factories.object("OkPayload", {
            id: factories.string(),
          }),
          factories.string(),
        ).algebraicType
        const UnitOkResult = factories.result(
          factories.unit(),
          factories.string(),
        ).algebraicType

        expect(roundTrip(StructOkResult, { ok: { id: "user-1" } })).toEqual({
          ok: {
            id: "user-1",
          },
        })
        expect(roundTrip(StructOkResult, { err: "declared" })).toEqual({
          err: "declared",
        })
        expect(roundTrip(UnitOkResult, { ok: {} })).toEqual({
          ok: {},
        })
      }),
  )

  it.effect("normalizes HTTP JSON using authored Stdb type metadata", () =>
    Effect.gen(function* () {
      const Row = StdbTesting.ContractType.struct({
        id: StdbTesting.ContractType.u64(),
        count: StdbTesting.ContractType.u32(),
        name: StdbTesting.ContractType.string(),
      })

      const decoded =
        yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput<{
          readonly id: bigint
          readonly count: number
          readonly name: string
        }>(Row, '{"id":18446744073709551615,"count":42,"name":"Ada"}')

      expect(decoded).toEqual({
        id: 18446744073709551615n,
        count: 42,
        name: "Ada",
      })
      expect(
        StdbTesting.ClientTransportCodec.httpJson.encodeInput([decoded.id]),
      ).toBe("[18446744073709551615]")
    }),
  )

  it.effect("routes DB values through the explicit DB codec boundary", () =>
    Effect.gen(function* () {
      const Row = StdbTesting.ContractType.struct({
        id: StdbTesting.ContractType.u64(),
      })

      const encoded = yield* StdbTesting.ClientTransportCodec.db.encode(Row, {
        id: 1n,
      })
      const decoded = yield* StdbTesting.ClientTransportCodec.db.decode(
        Row,
        encoded,
      )

      expect(decoded).toEqual({
        id: 1n,
      })
    }),
  )

  it.effect("encodes option WS params as native bare values", () =>
    Effect.gen(function* () {
      const PresenceSession = StdbTesting.ContractType.option(
        StdbTesting.ContractType.string(),
      )

      expect(
        yield* StdbTesting.ClientTransportCodec.ws.encode(
          PresenceSession,
          "session-1",
        ),
      ).toBe("session-1")
      expect(
        yield* StdbTesting.ClientTransportCodec.ws.encode(
          PresenceSession,
          undefined,
        ),
      ).toBeUndefined()
      expect(
        yield* StdbTesting.ClientTransportCodec.http.encode(
          PresenceSession,
          "session-1",
        ),
      ).toEqual({ some: "session-1" })
    }),
  )

  it.effect(
    "round-trips host transport containers through the native serializer",
    () =>
      Effect.gen(function* () {
        const OptionString = StdbTesting.ContractType.option(
          StdbTesting.ContractType.string(),
        )
        const ResultString = StdbTesting.ContractType.result(
          StdbTesting.ContractType.string(),
          StdbTesting.ContractType.string(),
        )
        const UnitResult = StdbTesting.ContractType.result(
          StdbTesting.ContractType.unit(),
          StdbTesting.ContractType.unit(),
        )
        const Status = StdbTesting.ContractType.sum({
          Complete: ResultString,
          Waiting: StdbTesting.ContractType.unit(),
        })
        const Nested = StdbTesting.ContractType.struct({
          sessions: StdbTesting.ContractType.array(OptionString),
          status: Status,
        })

        yield* expectNativeHostTransportRoundTrip(OptionString, "session-1")
        yield* expectNativeHostTransportRoundTrip(OptionString, undefined)
        yield* expectNativeHostTransportRoundTrip(ResultString, {
          ok: "accepted",
        })
        yield* expectNativeHostTransportRoundTrip(ResultString, {
          err: "rejected",
        })
        yield* expectNativeHostTransportRoundTrip(UnitResult, {
          ok: undefined,
        })
        yield* expectNativeHostTransportRoundTrip(UnitResult, {
          err: undefined,
        })
        yield* expectNativeHostTransportRoundTrip(Nested, {
          sessions: ["session-1", undefined],
          status: Status.make.Complete({ ok: "done" }),
        })
      }),
  )

  it.effect("encodes unbounded bigint values as native strings", () =>
    Effect.gen(function* () {
      const Count = StdbTesting.ContractType.bigint()

      const encoded = yield* StdbTesting.ClientTransportCodec.ws.encode(
        Count,
        9007199254740993n,
      )
      expect(encoded).toBe("9007199254740993")
      expect(typeof encoded).toBe("string")

      const native = nativeRoundTrip(Count, encoded)
      expect(native).toBe("9007199254740993")
      expect(
        yield* StdbTesting.ClientTransportCodec.ws.decode(Count, native),
      ).toBe(9007199254740993n)
    }),
  )

  it.effect(
    "decodes generated SDK unit enum payloads as authored literals",
    () =>
      Effect.gen(function* () {
        const Row = StdbTesting.ContractType.struct({
          state: StdbTesting.ContractType.literal("Active", "Ended"),
        })

        const decoded = yield* StdbTesting.ClientTransportCodec.db.decode(Row, {
          state: {
            tag: "Active",
            value: {},
          },
        })

        expect(decoded).toEqual({
          state: "Active",
        })
      }),
  )

  it.effect("rejects non-unit generated SDK enum payload values", () =>
    Effect.gen(function* () {
      const Row = StdbTesting.ContractType.struct({
        state: StdbTesting.ContractType.literal("Active", "Ended"),
      })

      const exit = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.db.decode(Row, {
          state: {
            tag: "Active",
            value: {
              unexpected: true,
            },
          },
        }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("decodes generated SDK PascalCase sum tags as authored tags", () =>
    Effect.gen(function* () {
      const Content = StdbTesting.ContractType.sum({
        prose: StdbTesting.ContractType.struct({
          text: StdbTesting.ContractType.string(),
        }),
        untilRemoved: StdbTesting.ContractType.unit(),
      })

      expect(
        yield* StdbTesting.ClientTransportCodec.db.decode(Content, {
          tag: "Prose",
          value: {
            text: "hello",
          },
        }),
      ).toEqual({
        tag: "prose",
        value: {
          text: "hello",
        },
      })
      expect(
        yield* StdbTesting.ClientTransportCodec.db.decode(Content, {
          tag: "UntilRemoved",
          value: {},
        }),
      ).toEqual({
        tag: "untilRemoved",
      })
    }),
  )

  it.effect("round-trips byte arrays through HTTP JSON", () =>
    Effect.gen(function* () {
      const Payload = StdbTesting.ContractType.struct({
        data: StdbTesting.ContractType.bytes(),
      })
      const value = {
        data: new Uint8Array([0, 1, 255]),
      }

      expect(StdbTesting.ClientTransportCodec.httpJson.encodeInput(value)).toBe(
        '{"data":[0,1,255]}',
      )
      expect(
        StdbTesting.ClientTransportCodec.httpJson.encodeInput({
          data: Buffer.from([0, 1, 255]),
        }),
      ).toBe('{"data":[0,1,255]}')

      const decodedHex =
        yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput<{
          readonly data: Uint8Array
        }>(Payload, '{"data":"0001ff"}')
      const decodedArray =
        yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput<{
          readonly data: Uint8Array
        }>(Payload, '{"data":[0,1,255]}')

      expect(Array.from(decodedHex.data)).toEqual([0, 1, 255])
      expect(Array.from(decodedArray.data)).toEqual([0, 1, 255])
    }),
  )

  it.effect("reports malformed HTTP JSON byte strings as decode failures", () =>
    Effect.gen(function* () {
      const Payload = StdbTesting.ContractType.struct({
        data: StdbTesting.ContractType.bytes(),
      })
      const malformed = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput<{
          readonly data: Uint8Array
        }>(Payload, '{"data":"not-hex"}'),
      )

      expect(Exit.isFailure(malformed)).toBe(true)
    }),
  )

  it.effect("preserves nested HTTP JSON integers inside result envelopes", () =>
    Effect.gen(function* () {
      const Result = StdbTesting.ContractType.result(
        StdbTesting.ContractType.u64(),
        StdbTesting.ContractType.string(),
      )
      const Struct = StdbTesting.ContractType.struct({
        result: Result,
      })

      const decoded =
        yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput<{
          readonly result: { readonly ok: bigint }
        }>(Struct, '{"result":{"tag":"ok","value":18446744073709551615}}')
      const enumDecoded =
        yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput<{
          readonly result: { readonly ok: bigint }
        }>(Struct, '{"result":[0,18446744073709551615]}')

      expect(decoded).toEqual({
        result: {
          ok: 18446744073709551615n,
        },
      })
      expect(enumDecoded).toEqual(decoded)
    }),
  )

  it.effect(
    "preserves HTTP JSON integer boundaries without JS number loss",
    () =>
      Effect.gen(function* () {
        const Integers = StdbTesting.ContractType.struct({
          i64: StdbTesting.ContractType.i64(),
          u64: StdbTesting.ContractType.u64(),
          i128: StdbTesting.ContractType.i128(),
          u128: StdbTesting.ContractType.u128(),
          u256: StdbTesting.ContractType.u256(),
          unbounded: StdbTesting.ContractType.bigint(),
        })

        const decoded =
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput<{
            readonly i64: bigint
            readonly u64: bigint
            readonly i128: bigint
            readonly u128: bigint
            readonly u256: bigint
            readonly unbounded: bigint
          }>(
            Integers,
            [
              "{",
              '"i64":-9223372036854775808,',
              '"u64":18446744073709551615,',
              '"i128":-170141183460469231731687303715884105728,',
              '"u128":340282366920938463463374607431768211455,',
              '"u256":115792089237316195423570985008687907853269984665640564039457584007913129639935,',
              '"unbounded":"9007199254740993"',
              "}",
            ].join(""),
          )

        expect(decoded).toEqual({
          i64: -9223372036854775808n,
          u64: 18446744073709551615n,
          i128: -170141183460469231731687303715884105728n,
          u128: 340282366920938463463374607431768211455n,
          u256: 115792089237316195423570985008687907853269984665640564039457584007913129639935n,
          unbounded: 9007199254740993n,
        })
        expect(
          StdbTesting.ClientTransportCodec.httpJson.encodeInput([decoded.u256]),
        ).toBe(
          "[115792089237316195423570985008687907853269984665640564039457584007913129639935]",
        )
      }),
  )

  it.effect(
    "rebounds canonical HTTP JSON product fields to declared keys",
    () =>
      Effect.gen(function* () {
        const Row = StdbTesting.ContractType.struct({
          createdAt: StdbTesting.ContractType.string(),
          nested: StdbTesting.ContractType.struct({
            userId: StdbTesting.ContractType.string(),
          }),
        })

        const canonical =
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput<{
            readonly createdAt: string
            readonly nested: { readonly userId: string }
          }>(Row, '{"created_at":"now","nested":{"user_id":"user-1"}}')
        const declared =
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput<{
            readonly createdAt: string
            readonly nested: { readonly userId: string }
          }>(Row, '{"createdAt":"now","nested":{"userId":"user-1"}}')

        expect(canonical).toEqual({
          createdAt: "now",
          nested: {
            userId: "user-1",
          },
        })
        expect(canonical).toEqual(declared)
        expect("created_at" in canonical).toBe(false)
        expect("user_id" in canonical.nested).toBe(false)
      }),
  )

  it.effect("rejects conflicting declared and canonical product fields", () =>
    Effect.gen(function* () {
      const Row = StdbTesting.ContractType.struct({
        createdAt: StdbTesting.ContractType.string(),
      })

      const exit = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Row,
          '{"createdAt":"declared","created_at":"canonical"}',
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect(
    "normalizes string literal SATS enum objects through metadata",
    () =>
      Effect.gen(function* () {
        const Status = StdbTesting.ContractType.literal("joined", "left")
        const ReviewStatus = StdbTesting.ContractType.literal("pending_review")

        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Status,
            '{"joined":{}}',
          ),
        ).toBe("joined")
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Status,
            "[1,[]]",
          ),
        ).toBe("left")
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Status,
            '{"tag":0}',
          ),
        ).toBe("joined")
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            ReviewStatus,
            '{"PendingReview":{}}',
          ),
        ).toBe("pending_review")
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            ReviewStatus,
            '{"tag":"PendingReview"}',
          ),
        ).toBe("pending_review")
      }),
  )

  it.effect(
    "round-trips non-camelCase string literals across DB, HTTP, and generated-client transports",
    () =>
      Effect.gen(function* () {
        const Status = StdbTesting.ContractType.literal("pending_review")
        const Action = StdbTesting.ContractType.literal("edit-action")
        const Mixed = StdbTesting.ContractType.literal(
          "pending_review",
          "edit-action",
        )

        expect(
          yield* StdbTesting.ClientTransportCodec.db.encode(
            Status,
            "pending_review",
          ),
        ).toEqual({
          tag: "pending_review",
        })
        expect(
          yield* StdbTesting.ClientTransportCodec.http.encode(
            Status,
            "pending_review",
          ),
        ).toEqual({
          tag: "pending_review",
        })
        expect(
          StdbTesting.ClientHttpJson.prepareHttpInputValue(Status, {
            tag: "pending_review",
          }),
        ).toEqual({
          pending_review: {},
        })
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Status,
            '{"pending_review":{}}',
          ),
        ).toBe("pending_review")
        expect(
          yield* StdbTesting.ClientTransportCodec.ws.encode(
            Status,
            "pending_review",
          ),
        ).toEqual({
          tag: "PendingReview",
        })
        expect(
          yield* StdbTesting.ClientTransportCodec.db.decode(Status, {
            tag: "pending_review",
          }),
        ).toBe("pending_review")
        expect(
          yield* StdbTesting.ClientTransportCodec.db.decode(Status, {
            tag: "PendingReview",
          }),
        ).toBe("pending_review")
        expect(
          yield* StdbTesting.ClientTransportCodec.http.decode(Status, {
            tag: "PendingReview",
          }),
        ).toBe("pending_review")
        expect(
          yield* StdbTesting.ClientTransportCodec.db.encode(
            Action,
            "edit-action",
          ),
        ).toEqual({
          tag: "EditAction",
        })
        expect(
          yield* StdbTesting.ClientTransportCodec.http.encode(
            Action,
            "edit-action",
          ),
        ).toEqual({
          tag: "EditAction",
        })
        expect(
          StdbTesting.ClientHttpJson.prepareHttpInputValue(
            Action,
            "edit-action",
          ),
        ).toEqual({
          EditAction: {},
        })
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Action,
            '{"EditAction":{}}',
          ),
        ).toBe("edit-action")
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Action,
            '{"edit-action":{}}',
          ),
        ).toBe("edit-action")
        expect(
          yield* StdbTesting.ClientTransportCodec.ws.encode(
            Action,
            "edit-action",
          ),
        ).toEqual({
          tag: "EditAction",
        })
        expect(
          yield* StdbTesting.ClientTransportCodec.db.decode(Action, {
            tag: "edit-action",
          }),
        ).toBe("edit-action")
        expect(
          yield* StdbTesting.ClientTransportCodec.http.decode(Action, {
            tag: "EditAction",
          }),
        ).toBe("edit-action")
        expect(
          StdbTesting.ClientHttpJson.prepareHttpInputValue(Mixed, {
            tag: "edit-action",
          }),
        ).toEqual({
          EditAction: {},
        })
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Mixed,
            "[0,{}]",
          ),
        ).toBe("pending_review")
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Mixed,
            "[1,{}]",
          ),
        ).toBe("edit-action")
      }),
  )

  it.effect("prepares string literal HTTP input as SATS enum objects", () =>
    Effect.gen(function* () {
      const Directive = StdbTesting.ContractType.struct({
        kind: StdbTesting.ContractType.literal("ResourceAdjustment"),
        reason: StdbTesting.ContractType.option(
          StdbTesting.ContractType.string(),
        ),
        targetCharacterId: StdbTesting.ContractType.string(),
      })
      const encoded = yield* StdbTesting.ContractTypeCodec.http.encode(
        Directive,
        {
          kind: "ResourceAdjustment",
          reason: undefined,
          targetCharacterId: "character-1",
        },
      )

      expect(encoded).toEqual({
        kind: {
          tag: "ResourceAdjustment",
        },
        reason: {
          none: {},
        },
        targetCharacterId: "character-1",
      })
      expect(
        StdbTesting.ClientHttpJson.prepareHttpInputValue(Directive, encoded),
      ).toEqual({
        kind: {
          ResourceAdjustment: {},
        },
        reason: {
          none: {},
        },
        target_character_id: "character-1",
      })
    }),
  )

  it.effect(
    "prepares string literal WS input for native generated client enum tags",
    () =>
      Effect.gen(function* () {
        const Params = StdbTesting.ContractType.struct({
          kind: StdbTesting.ContractType.literal("joined", "left"),
        })

        expect(
          yield* StdbTesting.ContractTypeCodec.ws.encode(Params, {
            kind: "joined",
          }),
        ).toEqual({
          kind: {
            tag: "Joined",
          },
        })
      }),
  )

  it.effect("prepares sum WS input for native generated client enum tags", () =>
    Effect.gen(function* () {
      const Params = StdbTesting.ContractType.struct({
        content: StdbTesting.ContractType.sum({
          itemEquipped: StdbTesting.ContractType.struct({
            itemId: StdbTesting.ContractType.string(),
          }),
          untilRemoved: StdbTesting.ContractType.unit(),
        }),
      })

      expect(
        yield* StdbTesting.ContractTypeCodec.ws.encode(Params, {
          content: {
            tag: "itemEquipped",
            value: {
              itemId: "item-1",
            },
          },
        }),
      ).toEqual({
        content: {
          tag: "ItemEquipped",
          value: {
            itemId: "item-1",
          },
        },
      })
      expect(
        yield* StdbTesting.ContractTypeCodec.ws.encode(Params, {
          content: {
            tag: "untilRemoved",
          },
        }),
      ).toEqual({
        content: {
          tag: "UntilRemoved",
        },
      })
      expect(
        yield* StdbTesting.ContractTypeCodec.ws.encode(Params, {
          content: {
            tag: "ItemEquipped",
            value: {
              itemId: "item-2",
            },
          },
        }),
      ).toEqual({
        content: {
          tag: "ItemEquipped",
          value: {
            itemId: "item-2",
          },
        },
      })
    }),
  )

  it.effect(
    "prepares live HTTP callable args with literal and result SATS shapes",
    () =>
      Effect.gen(function* () {
        const Params = StdbTesting.ContractType.struct({
          directive: StdbTesting.ContractType.struct({
            kind: StdbTesting.ContractType.literal("ResourceAdjustment"),
            outcome: StdbTesting.ContractType.result(
              StdbTesting.ContractType.unit(),
              StdbTesting.ContractType.string(),
            ),
          }),
        })

        expect(
          yield* StdbTesting.encodeArgsArray(Params, {
            directive: {
              kind: "ResourceAdjustment",
              outcome: { ok: undefined },
            },
          }),
        ).toEqual([
          {
            kind: {
              ResourceAdjustment: {},
            },
            outcome: {
              ok: {},
            },
          },
        ])
        expect(
          yield* StdbTesting.encodeArgsArray(Params, {
            directive: {
              kind: "ResourceAdjustment",
              outcome: { err: "rejected" },
            },
          }),
        ).toEqual([
          {
            kind: {
              ResourceAdjustment: {},
            },
            outcome: {
              err: "rejected",
            },
          },
        ])
      }),
  )

  it.effect("rejects non-finite float args before HTTP JSON encoding", () =>
    Effect.gen(function* () {
      const Params = StdbTesting.ContractType.struct({
        x: StdbTesting.ContractType.f64(),
        y: StdbTesting.ContractType.f32(),
      })

      expect(
        StdbTesting.ClientHttpJson.encodeHttpInput(
          yield* StdbTesting.encodeArgsArray(Params, {
            x: 1.5,
            y: 2.5,
          }),
        ),
      ).toBe("[1.5,2.5]")

      yield* Effect.forEach(
        [Number.NaN, Infinity, -Infinity],
        Effect.fn(function* (value) {
          const f64Failure = yield* StdbTesting.encodeArgsArray(Params, {
            x: value,
            y: 1.5,
          }).pipe(Effect.flip)
          const f32Failure = yield* StdbTesting.encodeArgsArray(Params, {
            x: 1.5,
            y: value,
          }).pipe(Effect.flip)

          expect(f64Failure).toBeInstanceOf(StdbTesting.StdbDecodeError)
          expect(f32Failure).toBeInstanceOf(StdbTesting.StdbDecodeError)
        }),
      )

      expect(() =>
        StdbTesting.ClientHttpJson.encodeHttpInput([Number.NaN]),
      ).toThrow("Cannot encode non-finite number over HTTP JSON")
    }),
  )

  it.effect("normalizes unit procedure envelopes from SATS enum objects", () =>
    Effect.gen(function* () {
      const Envelope = StdbTesting.procedureEnvelope(
        StdbTesting.ContractType.unit(),
        ExampleErrors,
      )

      expect(
        yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Envelope,
          '{"ok":{}}',
        ),
      ).toEqual({
        tag: "ok",
      })

      const pascal = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Envelope,
          '{"Ok":{}}',
        ),
      )

      expect(Exit.isFailure(pascal)).toBe(true)
    }),
  )

  it.effect(
    "normalizes nested result values inside route-shaped procedure envelopes",
    () =>
      Effect.gen(function* () {
        const Envelope = StdbTesting.procedureEnvelope(
          StdbTesting.ContractType.result(
            StdbTesting.ContractType.u64(),
            StdbTesting.ContractType.string(),
          ),
          ExampleErrors,
        )

        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Envelope,
            "[0,[0,18446744073709551615]]",
          ),
        ).toEqual({
          tag: "ok",
          value: {
            ok: 18446744073709551615n,
          },
        })
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Envelope,
            '[0,[1,"nope"]]',
          ),
        ).toEqual({
          tag: "ok",
          value: {
            err: "nope",
          },
        })
        expect(
          yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
            Envelope,
            '[1,"{\\"tag\\":\\"MissingAuth\\"}"]',
          ),
        ).toEqual({
          tag: "err",
          value: '{"tag":"MissingAuth"}',
        })
      }),
  )

  it.effect("rejects malformed SATS option tuple variants", () =>
    Effect.gen(function* () {
      const Option = StdbTesting.ContractType.option(
        StdbTesting.ContractType.u64(),
      )

      const badVariant = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Option,
          "[2,[]]",
        ),
      )
      const badNonePayload = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Option,
          "[1,123]",
        ),
      )

      expect(Exit.isFailure(badVariant)).toBe(true)
      expect(Exit.isFailure(badNonePayload)).toBe(true)
    }),
  )

  it.effect("rejects malformed SATS none objects", () =>
    Effect.gen(function* () {
      const Option = StdbTesting.ContractType.option(
        StdbTesting.ContractType.u64(),
      )

      const decoded =
        yield* StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Option,
          '{"none":{}}',
        )
      const badNonePayload = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Option,
          '{"none":123}',
        ),
      )

      expect(decoded).toBeUndefined()
      expect(Exit.isFailure(badNonePayload)).toBe(true)
    }),
  )

  it.effect("rejects malformed unit result payloads", () =>
    Effect.gen(function* () {
      const Envelope = StdbTesting.procedureEnvelope(
        StdbTesting.ContractType.unit(),
        ExampleErrors,
      )

      const badTuple = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Envelope,
          "[0,123]",
        ),
      )
      const badEnumObject = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Envelope,
          '{"ok":123}',
        ),
      )
      const badTaggedObject = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Envelope,
          '{"tag":"ok","value":123}',
        ),
      )

      expect(Exit.isFailure(badTuple)).toBe(true)
      expect(Exit.isFailure(badEnumObject)).toBe(true)
      expect(Exit.isFailure(badTaggedObject)).toBe(true)
    }),
  )

  it.effect("rejects extra fields on procedure envelope encode", () =>
    Effect.gen(function* () {
      const Envelope = StdbTesting.procedureEnvelope(
        StdbTesting.ContractType.u64(),
        ExampleErrors,
      )
      const UnitEnvelope = StdbTesting.procedureEnvelope(
        StdbTesting.ContractType.unit(),
        ExampleErrors,
      )

      const extraOk = yield* Effect.exit(
        Schema.encodeEffect(Envelope.schema)({
          tag: "ok",
          value: 1n,
          extra: true,
        } as never),
      )
      const extraErr = yield* Effect.exit(
        Schema.encodeEffect(Envelope.schema)({
          tag: "err",
          value: "declared",
          extra: true,
        } as never),
      )
      const extraUnitOk = yield* Effect.exit(
        Schema.encodeEffect(UnitEnvelope.schema)({
          tag: "ok",
          extra: true,
        } as never),
      )

      expect(Exit.isFailure(extraOk)).toBe(true)
      expect(Exit.isFailure(extraErr)).toBe(true)
      expect(Exit.isFailure(extraUnitOk)).toBe(true)
    }),
  )

  it.effect("rejects extra fields on tagged HTTP procedure envelopes", () =>
    Effect.gen(function* () {
      const Envelope = StdbTesting.procedureEnvelope(
        StdbTesting.ContractType.u64(),
        ExampleErrors,
      )
      const UnitEnvelope = StdbTesting.procedureEnvelope(
        StdbTesting.ContractType.unit(),
        ExampleErrors,
      )

      const extraOk = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Envelope,
          '{"tag":"ok","value":1,"extra":true}',
        ),
      )
      const extraErr = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Envelope,
          '{"tag":"err","value":"declared","extra":true}',
        ),
      )
      const extraUnitOk = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          UnitEnvelope,
          '{"tag":"ok","extra":true}',
        ),
      )

      expect(Exit.isFailure(extraOk)).toBe(true)
      expect(Exit.isFailure(extraErr)).toBe(true)
      expect(Exit.isFailure(extraUnitOk)).toBe(true)
    }),
  )

  it.effect("rejects missing values on non-unit tagged result envelopes", () =>
    Effect.gen(function* () {
      const Envelope = StdbTesting.procedureEnvelope(
        StdbTesting.ContractType.option(StdbTesting.ContractType.u64()),
        ExampleErrors,
      )
      const Result = StdbTesting.ContractType.result(
        StdbTesting.ContractType.option(StdbTesting.ContractType.u64()),
        StdbTesting.ContractType.string(),
      )

      const missingProcedureOk = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Envelope,
          '{"tag":"ok"}',
        ),
      )
      const missingProcedureErr = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Envelope,
          '{"tag":"err"}',
        ),
      )
      const missingResultOk = yield* Effect.exit(
        StdbTesting.ClientTransportCodec.httpJson.decodeOutput(
          Result,
          '{"tag":"ok"}',
        ),
      )

      expect(Exit.isFailure(missingProcedureOk)).toBe(true)
      expect(Exit.isFailure(missingProcedureErr)).toBe(true)
      expect(Exit.isFailure(missingResultOk)).toBe(true)
    }),
  )
})
