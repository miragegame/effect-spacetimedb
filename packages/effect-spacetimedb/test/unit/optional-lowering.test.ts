import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as SpacetimeDB from "spacetimedb"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"
import { builderTypeName, typeBuilder } from "../helpers/type-builder"

const describe = EffectVitest.layer(TestLayer)

const OptionalStruct = Stdb.struct({
  x: Stdb.optional(Stdb.string()),
  y: Stdb.string(),
})

const OptionStruct = Stdb.struct({
  x: Stdb.option(Stdb.string()),
  y: Stdb.string(),
})

const RequiredStruct = Stdb.struct({
  x: Stdb.string(),
  y: Stdb.string(),
})

describe("uniform optional lowering", (it) => {
  it.effect(
    "gives optional struct fields the same content-addressed SATS as Stdb.option",
    () =>
      Effect.gen(function* () {
        const optionalName = builderTypeName(typeBuilder(OptionalStruct))
        const optionName = builderTypeName(typeBuilder(OptionStruct))
        const requiredName = builderTypeName(typeBuilder(RequiredStruct))

        expect(optionalName).toBeDefined()
        expect(optionalName).toBe(optionName)
        expect(optionalName).not.toBe(requiredName)
      }),
  )

  it.effect(
    "lowers optional table columns identically in row struct positions",
    () =>
      Effect.gen(function* () {
        const userTable = Stdb.table("optionalLoweringUser", {
          columns: {
            id: Stdb.string().primaryKey(),
            nickname: Stdb.string().optional(),
          },
        })

        const equivalentRowStruct = Stdb.struct({
          id: Stdb.string(),
          nickname: Stdb.option(Stdb.string()),
        })

        expect(
          StdbTesting.ContractType.satsTypeFingerprint(userTable.row),
        ).toBe(
          StdbTesting.ContractType.satsTypeFingerprint(equivalentRowStruct),
        )
      }),
  )

  it.effect("lowers optional fields nested under lazy and array types", () =>
    Effect.gen(function* () {
      const LazyOptional = Stdb.lazy(() => OptionalStruct)
      const LazyOption = Stdb.lazy(() => OptionStruct)

      expect(builderTypeName(typeBuilder(LazyOptional))).toBe(
        builderTypeName(typeBuilder(LazyOption)),
      )

      const ArrayHostOptional = Stdb.struct({
        items: Stdb.array(OptionalStruct),
      })
      const ArrayHostOption = Stdb.struct({
        items: Stdb.array(OptionStruct),
      })

      expect(builderTypeName(typeBuilder(ArrayHostOptional))).toBe(
        builderTypeName(typeBuilder(ArrayHostOption)),
      )
    }),
  )

  it.effect(
    "round-trips optional fields through the struct codec as options",
    () =>
      Effect.gen(function* () {
        const encodeStruct = Schema.encodeEffect(OptionalStruct.schema)
        const decodeStruct = Schema.decodeUnknownEffect(OptionalStruct.schema)

        const encodedAbsent = yield* encodeStruct({ y: "a" })
        expect(encodedAbsent).toEqual({ x: { none: {} }, y: "a" })

        const encodedPresent = yield* encodeStruct({ x: "v", y: "a" })
        expect(encodedPresent).toEqual({ x: { some: "v" }, y: "a" })

        // Wire bytes are identical to an Stdb.option field by construction.
        expect(
          yield* Schema.encodeEffect(OptionStruct.schema)({
            x: undefined,
            y: "a",
          }),
        ).toEqual(encodedAbsent)

        expect(yield* decodeStruct(encodedAbsent)).toEqual({
          x: undefined,
          y: "a",
        })
        expect(yield* decodeStruct(encodedPresent)).toEqual({ x: "v", y: "a" })
        // Host rows surface option columns as bare values / undefined — both decode.
        expect(yield* decodeStruct({ x: undefined, y: "a" })).toEqual({
          x: undefined,
          y: "a",
        })
        expect(yield* decodeStruct({ x: "v", y: "a" })).toEqual({
          x: "v",
          y: "a",
        })
        expect(yield* decodeStruct({ y: "a" })).toEqual({ y: "a" })
      }),
  )

  it.effect(
    "round-trips optional fields through the native BSATN serializer",
    () =>
      Effect.gen(function* () {
        const algebraic = Reflect.get(
          typeBuilder(OptionalStruct),
          "algebraicType",
        ) as SpacetimeDB.AlgebraicType

        const roundTrip = (value: unknown) => {
          const writer = new SpacetimeDB.BinaryWriter(16)
          SpacetimeDB.AlgebraicType.makeSerializer(algebraic)(writer, value)
          return SpacetimeDB.AlgebraicType.makeDeserializer(algebraic)(
            new SpacetimeDB.BinaryReader(writer.getBuffer()),
          )
        }

        expect(roundTrip({ x: undefined, y: "a" })).toEqual({
          x: undefined,
          y: "a",
        })
        expect(roundTrip({ x: "v", y: "a" })).toEqual({ x: "v", y: "a" })
      }),
  )

  it.effect(
    "decodes HTTP-JSON option payloads for optional fields in both wire forms",
    () =>
      Effect.gen(function* () {
        const decode = (body: string) =>
          StdbTesting.ClientHttpJson.decodeHttpOutput<{
            readonly x?: string | undefined
            readonly y: string
          }>(OptionalStruct, body)

        // Indexed-variant array form (bare SATS-JSON, e.g. /call results).
        expect(yield* decode('{"x":[0,"v"],"y":"a"}')).toEqual({
          x: "v",
          y: "a",
        })
        expect(yield* decode('{"x":[1,{}],"y":"a"}')).toEqual({ y: "a" })

        // Named record form (typed SATS-JSON surfaces).
        expect(yield* decode('{"x":{"some":"v"},"y":"a"}')).toEqual({
          x: "v",
          y: "a",
        })
        expect(yield* decode('{"x":{"none":{}},"y":"a"}')).toEqual({ y: "a" })
      }),
  )

  it.effect(
    "decodes table.row procedure returns with optional columns over HTTP-JSON",
    () =>
      Effect.gen(function* () {
        const userTable = Stdb.table("optionalLoweringHttpUser", {
          columns: {
            id: Stdb.string().primaryKey(),
            nickname: Stdb.string().optional(),
          },
        })

        const decoded = yield* StdbTesting.ClientHttpJson.decodeHttpOutput<{
          readonly id: string
          readonly nickname?: string | undefined
        }>(userTable.row, '{"id":"u1","nickname":[1,{}]}')

        expect(decoded).toEqual({ id: "u1" })

        const present = yield* StdbTesting.ClientHttpJson.decodeHttpOutput<{
          readonly id: string
          readonly nickname?: string | undefined
        }>(userTable.row, '{"id":"u1","nickname":[0,"nick"]}')

        expect(present).toEqual({ id: "u1", nickname: "nick" })
      }),
  )
})
