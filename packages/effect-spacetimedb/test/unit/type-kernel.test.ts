import * as EffectVitest from "@effect/vitest"

import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { StdbValidationError } from "effect-spacetimedb"
import {
  ConnectionId,
  Identity,
  ScheduleAt,
  TimeDuration,
  Timestamp,
  Uuid,
} from "spacetimedb"
import {
  testEffectCallbackError,
  unwrapTestEffectCallbackError,
} from "../helpers/effect-errors"

const { expect } = EffectVitest

import * as StdbTesting from "effect-spacetimedb/testing"
import { TreeType } from "../fixtures/recursive-types"
import { transform } from "../helpers/schema-transform"
import { TestLayer } from "../helpers/test-layer"
import { builderTypeName, typeBuilder } from "../helpers/type-builder"

const describe = EffectVitest.layer(TestLayer)
const GeneratedStructName = /^EffectSpacetimeDbStruct[0-9]{40}$/
const GeneratedEnumName = /^EffectSpacetimeDbEnum[0-9]{40}$/
const GeneratedSumName = /^EffectSpacetimeDbSum[0-9]{40}$/

type RecursiveNameNode = {
  readonly children: ReadonlyArray<RecursiveNameNode>
}

const makeRecursiveNameNode = (): ReturnType<
  typeof StdbTesting.ContractType.lazy<RecursiveNameNode, unknown>
> => {
  const Node: ReturnType<
    typeof StdbTesting.ContractType.lazy<RecursiveNameNode, unknown>
  > = StdbTesting.ContractType.lazy(() =>
    StdbTesting.ContractType.struct({
      children: StdbTesting.ContractType.array(Node),
    }),
  )

  return Node
}

describe("type kernel", (it) => {
  it.effect(
    "returns opaque value-types that expose their Effect schema through .schema",
    () =>
      Effect.gen(function* () {
        const UserId = StdbTesting.ContractType.string(
          Schema.String.pipe(Schema.brand("DecoratedUserId")),
        )
        const UserStruct = Schema.Struct({
          id: UserId.schema,
        })

        const userId = yield* Schema.decodeUnknownEffect(UserId.schema)(
          "user-1",
        )

        expect(userId).toBe("user-1")
        expect(yield* Schema.encodeEffect(UserId.schema)(userId)).toBe("user-1")
        expect(
          yield* Schema.decodeUnknownEffect(UserStruct)({
            id: "user-1",
          }),
        ).toEqual({
          id: "user-1",
        })
        expect("pipe" in UserId).toBe(false)
        expect("check" in UserId).toBe(false)
        expect("brand" in UserId).toBe(false)
        expect(typeBuilder(UserId).algebraicType.tag).toBe("String")
      }),
  )

  it.effect(
    "keeps lowering intact through schemas passed into constructors",
    () =>
      Effect.gen(function* () {
        const Refined = StdbTesting.ContractType.string(
          Schema.String.pipe(
            Schema.brand("TypeKernel/Refined"),
            Schema.check(Schema.isMinLength(0), Schema.isMaxLength(255)),
          ),
        )
        const Annotated = StdbTesting.ContractType.string(
          Schema.String.pipe(
            Schema.annotate({ description: "annotated refined value-type" }),
            Schema.brand("TypeKernel/Annotated"),
          ),
        )
        const RefinedU64 = StdbTesting.ContractType.u64(
          Schema.BigInt.pipe(
            Schema.brand("TypeKernel/RefinedU64"),
            Schema.check(Schema.isLessThanOrEqualToBigInt(10n)),
          ),
        )
        const Transformed = StdbTesting.ContractType.string(
          transform(Schema.String, StdbTesting.ContractType.string().schema, {
            decode: (value) => value,
            encode: (value) => value,
          }),
        )

        expect(typeBuilder(Refined).algebraicType.tag).toBe("String")
        expect(typeBuilder(Annotated).algebraicType.tag).toBe("String")
        expect(typeBuilder(RefinedU64).algebraicType.tag).toBe("U64")
        expect(typeBuilder(Transformed).algebraicType.tag).toBe("String")

        const NumberFromString = StdbTesting.ContractType.f64(
          Schema.FiniteFromString as never,
        )
        expect(typeBuilder(NumberFromString).algebraicType.tag).toBe(
          typeBuilder(StdbTesting.ContractType.f64()).algebraicType.tag,
        )
      }),
  )

  it.effect(
    "rejects raw scalar schemas that bypass the authoring type gate",
    () =>
      Effect.gen(function* () {
        expect(() =>
          typeBuilder(
            Schema.String as unknown as StdbTesting.ContractType.AnyValueType,
          ),
        ).toThrow(/SpaceTimeDB type lowering failed/)
        expect(() =>
          typeBuilder(
            Schema.Finite as unknown as StdbTesting.ContractType.AnyValueType,
          ),
        ).toThrow(/SpaceTimeDB type lowering failed/)
        expect(() =>
          typeBuilder(
            Schema.Boolean as unknown as StdbTesting.ContractType.AnyValueType,
          ),
        ).toThrow(/SpaceTimeDB type lowering failed/)
      }),
  )

  it.effect("enforces constructor refinements at value decode boundaries", () =>
    Effect.gen(function* () {
      const Name = StdbTesting.ContractType.string(
        Schema.String.pipe(
          Schema.brand("TypeKernel/Name"),
          Schema.check(Schema.isMaxLength(100)),
        ),
      )
      const Count = StdbTesting.ContractType.u64(
        Schema.BigInt.pipe(
          Schema.brand("TypeKernel/Count"),
          Schema.check(Schema.isLessThanOrEqualToBigInt(10n)),
        ),
      )
      const DomainCount = StdbTesting.ContractType.u64(
        Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(0n)),
      )

      expect(
        yield* Schema.decodeUnknownEffect(Name.schema)("A".repeat(100)),
      ).toBe("A".repeat(100))
      expect(
        Schema.decodeUnknownResult(Name.schema)("A".repeat(101)),
      ).toSatisfy(Result.isFailure)
      expect(yield* Schema.decodeUnknownEffect(Count.schema)(10n)).toBe(10n)
      expect(Schema.decodeUnknownResult(Count.schema)(11n)).toSatisfy(
        Result.isFailure,
      )
      expect(yield* Schema.decodeUnknownEffect(DomainCount.schema)(1n)).toBe(1n)
      expect(yield* Schema.encodeEffect(DomainCount.schema)(1n)).toBe(1n)
    }),
  )

  it.effect("supports explicit custom schema lowering", () =>
    Effect.gen(function* () {
      const CountFromString = StdbTesting.ContractType.custom(
        Schema.FiniteFromString,
        {
          type: StdbTesting.ContractType.string(),
        },
      )

      expect(
        yield* Schema.decodeUnknownEffect(CountFromString.schema)("42"),
      ).toBe(42)
      expect(yield* Schema.encodeEffect(CountFromString.schema)(42)).toBe("42")
      expect(typeBuilder(CountFromString).algebraicType.tag).toBe("String")
    }),
  )

  it.effect("exposes descriptor-first metadata for authored Stdb types", () =>
    Effect.gen(function* () {
      const Params = StdbTesting.ContractType.struct({
        id: StdbTesting.ContractType.string(),
        tags: StdbTesting.ContractType.array(StdbTesting.ContractType.string()),
        maybeCount: StdbTesting.ContractType.option(
          StdbTesting.ContractType.u32(),
        ),
      })
      const MaybeCount = StdbTesting.ContractType.option(
        StdbTesting.ContractType.u32(),
      )

      const descriptor = StdbTesting.ContractTypeDescriptor.descriptor(Params)
      expect(descriptor).toEqual(
        expect.objectContaining({
          _tag: "Struct",
          kind: "struct",
        }),
      )
      expect(StdbTesting.ContractTypeDescriptor.children(Params)).toHaveLength(
        3,
      )
      expect(
        StdbTesting.ContractTypeDescriptor.descriptor(
          StdbTesting.ContractType.array(StdbTesting.ContractType.string()),
        ),
      ).toEqual(
        expect.objectContaining({
          _tag: "Array",
          kind: "array",
        }),
      )
      expect(
        yield* Schema.decodeUnknownEffect(MaybeCount.schema)({ some: 3 }),
      ).toBe(3)
      expect(yield* Schema.decodeUnknownEffect(MaybeCount.schema)(3)).toBe(3)
      expect(
        yield* Schema.decodeUnknownEffect(MaybeCount.schema)({ none: {} }),
      ).toBeUndefined()
      expect(
        yield* Schema.decodeUnknownEffect(MaybeCount.schema)({ none: [] }),
      ).toBeUndefined()
      expect(yield* Schema.encodeEffect(MaybeCount.schema)(3)).toEqual({
        some: 3,
      })
      expect(yield* Schema.encodeEffect(MaybeCount.schema)(undefined)).toEqual({
        none: {},
      })
    }),
  )

  it.effect(
    "uses deterministic content-addressed names for ordered structural types",
    () =>
      Effect.gen(function* () {
        const UserParams = StdbTesting.ContractType.struct({
          id: StdbTesting.ContractType.string(),
          count: StdbTesting.ContractType.u32(),
        })
        const SameUserParams = StdbTesting.ContractType.struct({
          id: StdbTesting.ContractType.string(),
          count: StdbTesting.ContractType.u32(),
        })
        const ReorderedUserParams = StdbTesting.ContractType.struct({
          count: StdbTesting.ContractType.u32(),
          id: StdbTesting.ContractType.string(),
        })
        const Nested = StdbTesting.ContractType.struct({
          maybeUser: StdbTesting.ContractType.option(SameUserParams),
          users: StdbTesting.ContractType.array(UserParams),
        })

        const userName = builderTypeName(typeBuilder(UserParams))
        const sameUserName = builderTypeName(typeBuilder(SameUserParams))
        const reorderedName = builderTypeName(typeBuilder(ReorderedUserParams))

        expect(userName).toMatch(GeneratedStructName)
        expect(sameUserName).toBe(userName)
        expect(typeBuilder(SameUserParams)).toBe(typeBuilder(UserParams))
        expect(reorderedName).toMatch(GeneratedStructName)
        expect(reorderedName).not.toBe(userName)
        expect(builderTypeName(typeBuilder(Nested))).toMatch(
          GeneratedStructName,
        )
        expect(
          StdbTesting.ContractType.satsTypeFingerprint(SameUserParams),
        ).toBe(StdbTesting.ContractType.satsTypeFingerprint(UserParams))
        expect(
          StdbTesting.ContractType.satsTypeFingerprint(ReorderedUserParams),
        ).not.toBe(StdbTesting.ContractType.satsTypeFingerprint(UserParams))
      }),
  )

  it.effect(
    "keeps existing composite names stable across insertion and traversal order",
    () =>
      Effect.gen(function* () {
        const First = StdbTesting.ContractType.struct({
          first: StdbTesting.ContractType.string(),
        })
        const Second = StdbTesting.ContractType.sum({
          A: StdbTesting.ContractType.string(),
          B: StdbTesting.ContractType.u32(),
        })
        const Envelope = StdbTesting.procedureEnvelope(
          StdbTesting.ContractType.option(First),
          StdbTesting.ContractError.define(
            class InsertedNameError extends Schema.TaggedErrorClass<InsertedNameError>()(
              "InsertedNameError",
              { message: Schema.String },
            ) {},
          ),
        )
        const baseNames = {
          first: builderTypeName(typeBuilder(First)),
          second: builderTypeName(typeBuilder(Second)),
          envelope: builderTypeName(typeBuilder(Envelope)),
        }

        const Inserted = StdbTesting.ContractType.struct({
          inserted: StdbTesting.ContractType.bool(),
        })
        const reorderedTraversal = [
          ["second", Second],
          ["inserted", Inserted],
          ["envelope", Envelope],
          ["first", First],
        ] as const
        const namesAfterInsertion = Object.fromEntries(
          reorderedTraversal.map(([key, value]) => [
            key,
            builderTypeName(typeBuilder(value)),
          ]),
        )

        expect(Object.keys(namesAfterInsertion)).toEqual([
          "second",
          "inserted",
          "envelope",
          "first",
        ])
        expect(namesAfterInsertion.first).toBe(baseNames.first)
        expect(namesAfterInsertion.second).toBe(baseNames.second)
        expect(namesAfterInsertion.envelope).toBe(baseNames.envelope)
        expect(namesAfterInsertion.inserted).toMatch(GeneratedStructName)
      }),
  )

  it.effect(
    "canonicalizes independently authored recursive child fingerprints",
    () =>
      Effect.gen(function* () {
        const FirstRecursive = makeRecursiveNameNode()
        const SameRecursive = makeRecursiveNameNode()
        const ParentWithIndependentChildren = StdbTesting.ContractType.struct({
          first: FirstRecursive,
          second: SameRecursive,
        })
        const ParentWithSharedChild = StdbTesting.ContractType.struct({
          first: FirstRecursive,
          second: FirstRecursive,
        })

        expect(builderTypeName(typeBuilder(FirstRecursive))).toBe(
          builderTypeName(typeBuilder(SameRecursive)),
        )
        expect(
          builderTypeName(typeBuilder(ParentWithIndependentChildren)),
        ).toBe(builderTypeName(typeBuilder(ParentWithSharedChild)))
        expect(typeBuilder(ParentWithIndependentChildren)).toBe(
          typeBuilder(ParentWithSharedChild),
        )
      }),
  )

  it.effect(
    "deduplicates ordered string enums and sums while results stay structural",
    () =>
      Effect.gen(function* () {
        const Kind = StdbTesting.ContractType.literal("joined", "left")
        const SameKind = StdbTesting.ContractType.literal("joined", "left")
        const ReorderedKind = StdbTesting.ContractType.literal("left", "joined")
        const EnumContainer = StdbTesting.ContractType.struct({
          kind: Kind,
        })
        const UnitSum = StdbTesting.ContractType.sum({
          Joined: StdbTesting.ContractType.unit(),
          Left: StdbTesting.ContractType.unit(),
        })
        const UnitEnum = StdbTesting.ContractType.enum("Joined", "Left")
        const UnitSumContainer = StdbTesting.ContractType.struct({
          kind: UnitSum,
        })
        const Action = StdbTesting.ContractType.sum({
          Create: StdbTesting.ContractType.string(),
          Delete: StdbTesting.ContractType.unit(),
        })
        const SameAction = StdbTesting.ContractType.sum({
          Create: StdbTesting.ContractType.string(),
          Delete: StdbTesting.ContractType.unit(),
        })
        const ReorderedAction = StdbTesting.ContractType.sum({
          Delete: StdbTesting.ContractType.unit(),
          Create: StdbTesting.ContractType.string(),
        })
        const ResultType = StdbTesting.ContractType.result(
          StdbTesting.ContractType.string(),
          StdbTesting.ContractType.u32(),
        )
        const Envelope = StdbTesting.procedureEnvelope(
          StdbTesting.ContractType.string(),
          StdbTesting.ContractError.define(
            class EnvelopeNameError extends Schema.TaggedErrorClass<EnvelopeNameError>()(
              "EnvelopeNameError",
              { message: Schema.String },
            ) {},
          ),
        )

        expect(builderTypeName(typeBuilder(Kind))).toMatch(GeneratedEnumName)
        expect(builderTypeName(typeBuilder(SameKind))).toBe(
          builderTypeName(typeBuilder(Kind)),
        )
        expect(typeBuilder(SameKind)).toBe(typeBuilder(Kind))
        expect(builderTypeName(typeBuilder(ReorderedKind))).not.toBe(
          builderTypeName(typeBuilder(Kind)),
        )
        expect(builderTypeName(typeBuilder(EnumContainer))).toMatch(
          GeneratedStructName,
        )
        expect(builderTypeName(typeBuilder(UnitSum))).toMatch(GeneratedSumName)
        expect(builderTypeName(typeBuilder(UnitEnum))).toBe(
          builderTypeName(typeBuilder(UnitSum)),
        )
        expect(typeBuilder(UnitEnum)).toBe(typeBuilder(UnitSum))
        expect(builderTypeName(typeBuilder(UnitSumContainer))).toMatch(
          GeneratedStructName,
        )
        expect(builderTypeName(typeBuilder(UnitSumContainer))).not.toBe(
          builderTypeName(typeBuilder(EnumContainer)),
        )
        expect(builderTypeName(typeBuilder(Action))).toMatch(GeneratedSumName)
        expect(builderTypeName(typeBuilder(SameAction))).toBe(
          builderTypeName(typeBuilder(Action)),
        )
        expect(typeBuilder(SameAction)).toBe(typeBuilder(Action))
        expect(builderTypeName(typeBuilder(ReorderedAction))).not.toBe(
          builderTypeName(typeBuilder(Action)),
        )
        expect(builderTypeName(typeBuilder(ResultType))).toBeUndefined()
        expect(typeBuilder(ResultType).algebraicType).toEqual({
          tag: "Sum",
          value: {
            variants: [
              expect.objectContaining({ name: "ok" }),
              expect.objectContaining({ name: "err" }),
            ],
          },
        })
        expect(builderTypeName(typeBuilder(Envelope))).toBeUndefined()
        expect(typeBuilder(Envelope).algebraicType).toEqual({
          tag: "Sum",
          value: {
            variants: [
              expect.objectContaining({ name: "ok" }),
              expect.objectContaining({ name: "err" }),
            ],
          },
        })
      }),
  )

  it.effect("fails loudly when distinct fingerprints collide on one name", () =>
    Effect.gen(function* () {
      const nameFor =
        StdbTesting.ContractTypeName.makeContentAddressedNameFactory(
          () => "00000000000000000000000000000000",
        )
      const first = nameFor("Struct", "first-fingerprint")

      expect(nameFor("Struct", "first-fingerprint")).toBe(first)
      expect(() => nameFor("Struct", "second-fingerprint")).toThrow(
        StdbTesting.ContractTypeName.SatsTypeNameCollisionError,
      )
    }),
  )

  it.effect(
    "supports signed and unsigned integer lowering and range checks",
    () =>
      Effect.gen(function* () {
        const i8Min = -128
        const i8Max = 127
        const u8Max = 255
        const i16Min = -32768
        const i16Max = 32767
        const u16Max = 65535
        const i32Min = -(2 ** 31)
        const i32Max = 2 ** 31 - 1
        const u32Max = 0xffffffff
        const i64Min = -9223372036854775808n
        const i64Max = 9223372036854775807n
        const u64Max = 18446744073709551615n
        const i128Min = -170141183460469231731687303715884105728n
        const i128Max = 170141183460469231731687303715884105727n
        const u128Max = 340282366920938463463374607431768211455n
        const i256Min =
          -57896044618658097711785492504343953926634992332820282019728792003956564819968n
        const i256Max =
          57896044618658097711785492504343953926634992332820282019728792003956564819967n
        const u256Max =
          115792089237316195423570985008687907853269984665640564039457584007913129639935n

        expect(
          typeBuilder(StdbTesting.ContractType.u8()).algebraicType.tag,
        ).toBe("U8")
        expect(
          typeBuilder(StdbTesting.ContractType.u16()).algebraicType.tag,
        ).toBe("U16")
        expect(
          typeBuilder(StdbTesting.ContractType.u32()).algebraicType.tag,
        ).toBe("U32")
        expect(
          typeBuilder(StdbTesting.ContractType.i8()).algebraicType.tag,
        ).toBe("I8")
        expect(
          typeBuilder(StdbTesting.ContractType.i16()).algebraicType.tag,
        ).toBe("I16")
        expect(
          typeBuilder(StdbTesting.ContractType.i32()).algebraicType.tag,
        ).toBe("I32")
        expect(
          typeBuilder(StdbTesting.ContractType.i64()).algebraicType.tag,
        ).toBe("I64")
        expect(
          typeBuilder(StdbTesting.ContractType.u64()).algebraicType.tag,
        ).toBe("U64")
        expect(
          typeBuilder(StdbTesting.ContractType.i128()).algebraicType.tag,
        ).toBe("I128")
        expect(
          typeBuilder(StdbTesting.ContractType.u128()).algebraicType.tag,
        ).toBe("U128")
        expect(
          typeBuilder(StdbTesting.ContractType.i256()).algebraicType.tag,
        ).toBe("I256")
        expect(
          typeBuilder(StdbTesting.ContractType.u256()).algebraicType.tag,
        ).toBe("U256")

        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.u8().schema,
          )(0),
        ).toBe(0)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.u8().schema,
          )(u8Max),
        ).toBe(u8Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.u16().schema,
          )(u16Max),
        ).toBe(u16Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i8().schema,
          )(i8Min),
        ).toBe(i8Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i8().schema,
          )(i8Max),
        ).toBe(i8Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i16().schema,
          )(i16Min),
        ).toBe(i16Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i16().schema,
          )(i16Max),
        ).toBe(i16Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i32().schema,
          )(i32Min),
        ).toBe(i32Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i32().schema,
          )(i32Max),
        ).toBe(i32Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.u32().schema,
          )(0),
        ).toBe(0)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.u32().schema,
          )(u32Max),
        ).toBe(u32Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i64().schema,
          )(i64Min),
        ).toBe(i64Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i64().schema,
          )(i64Max),
        ).toBe(i64Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.u64().schema,
          )(u64Max),
        ).toBe(u64Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i128().schema,
          )(i128Min),
        ).toBe(i128Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i128().schema,
          )(i128Max),
        ).toBe(i128Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.u128().schema,
          )(u128Max),
        ).toBe(u128Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i256().schema,
          )(i256Min),
        ).toBe(i256Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.i256().schema,
          )(i256Max),
        ).toBe(i256Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbTesting.ContractType.u256().schema,
          )(u256Max),
        ).toBe(u256Max)

        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u8().schema)(-1),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u8().schema)(
            u8Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i8().schema)(
            i8Min - 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i8().schema)(
            i8Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u16().schema)(-1),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u16().schema)(
            u16Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i16().schema)(
            i16Min - 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i16().schema)(
            i16Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i32().schema)(
            i32Min - 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i32().schema)(
            i32Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u32().schema)(-1),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u32().schema)(
            u32Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i64().schema)(
            i64Min - 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i64().schema)(
            i64Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u64().schema)(
            -1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u64().schema)(
            u64Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i128().schema)(
            i128Min - 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i128().schema)(
            i128Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u128().schema)(
            -1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u128().schema)(
            u128Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i256().schema)(
            i256Min - 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.i256().schema)(
            i256Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u256().schema)(
            -1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbTesting.ContractType.u256().schema)(
            u256Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)

        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.u32(Schema.Finite).schema,
          )(-1),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.u32(Schema.Finite).schema,
          )(u32Max + 1),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.i64(Schema.BigInt).schema,
          )(i64Min - 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.i64(Schema.BigInt).schema,
          )(i64Max + 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.u64(Schema.BigInt).schema,
          )(-1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.u64(Schema.BigInt).schema,
          )(u64Max + 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.i128(Schema.BigInt).schema,
          )(i128Min - 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.i128(Schema.BigInt).schema,
          )(i128Max + 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.u128(Schema.BigInt).schema,
          )(-1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.u128(Schema.BigInt).schema,
          )(u128Max + 1n),
        ).toSatisfy(Result.isFailure)

        const InvalidU32Transform = transform(Schema.Finite, Schema.Finite, {
          decode: () => 0,
          encode: () => u32Max + 1,
        })
        const InvalidDecodedU32Transform = transform(
          Schema.Finite,
          Schema.Finite,
          {
            decode: () => u32Max + 1,
            encode: () => 0,
          },
        )
        const InvalidUnsignedTransform = transform(
          Schema.BigInt,
          Schema.BigInt,
          {
            decode: () => 0n,
            encode: () => u64Max + 1n,
          },
        )
        const InvalidSignedTransform = transform(Schema.BigInt, Schema.BigInt, {
          decode: () => 0n,
          encode: () => i64Max + 1n,
        })
        const InvalidDecodedUnsignedTransform = transform(
          Schema.BigInt,
          Schema.BigInt,
          {
            decode: () => u64Max + 1n,
            encode: () => 0n,
          },
        )
        const InvalidDecodedSignedTransform = transform(
          Schema.BigInt,
          Schema.BigInt,
          {
            decode: () => i64Max + 1n,
            encode: () => 0n,
          },
        )

        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.u32(InvalidU32Transform).schema,
          )(u32Max + 1),
        ).toSatisfy(Result.isFailure)
        expect(
          yield* Effect.result(
            Schema.encodeEffect(
              StdbTesting.ContractType.u32(InvalidU32Transform).schema,
            )(0),
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.u32(InvalidDecodedU32Transform).schema,
          )(0),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.u64(InvalidUnsignedTransform).schema,
          )(u64Max + 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          yield* Effect.result(
            Schema.encodeEffect(
              StdbTesting.ContractType.u64(InvalidUnsignedTransform).schema,
            )(0n),
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.i64(InvalidSignedTransform).schema,
          )(i64Max + 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          yield* Effect.result(
            Schema.encodeEffect(
              StdbTesting.ContractType.i64(InvalidSignedTransform).schema,
            )(0n),
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.u64(InvalidDecodedUnsignedTransform)
              .schema,
          )(0n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbTesting.ContractType.i64(InvalidDecodedSignedTransform).schema,
          )(0n),
        ).toSatisfy(Result.isFailure)
      }),
  )

  it.effect(
    "keeps identifier-safe string literals verbatim while lowering them to SATS enums",
    () =>
      Effect.gen(function* () {
        const PresenceKind = StdbTesting.ContractType.literal("joined", "left")
        const ReviewKind = StdbTesting.ContractType.literal("pending_review")
        const ActionKind = StdbTesting.ContractType.literal("edit-action")
        const encoded = yield* Schema.encodeEffect(PresenceKind.schema)(
          "joined",
        )
        const reviewEncoded = yield* Schema.encodeEffect(ReviewKind.schema)(
          "pending_review",
        )
        const actionEncoded = yield* Schema.encodeEffect(ActionKind.schema)(
          "edit-action",
        )
        const decoded = yield* Schema.decodeUnknownEffect(PresenceKind.schema)({
          tag: "left",
        })
        const reviewDecoded = yield* Schema.decodeUnknownEffect(
          ReviewKind.schema,
        )({
          tag: "PendingReview",
        })
        const actionDecoded = yield* Schema.decodeUnknownEffect(
          ActionKind.schema,
        )({
          tag: "EditAction",
        })
        const builder = typeBuilder(PresenceKind)
        const reviewBuilder = typeBuilder(ReviewKind)
        const actionBuilder = typeBuilder(ActionKind)

        expect(encoded).toEqual({
          tag: "joined",
        })
        expect(reviewEncoded).toEqual({
          tag: "pending_review",
        })
        expect(actionEncoded).toEqual({
          tag: "EditAction",
        })
        expect(decoded).toBe("left")
        expect(reviewDecoded).toBe("pending_review")
        expect(actionDecoded).toBe("edit-action")
        expect(builder.algebraicType.tag).toBe("Sum")
        expect(reviewBuilder.algebraicType).toEqual({
          tag: "Sum",
          value: {
            variants: [expect.objectContaining({ name: "pending_review" })],
          },
        })
        expect(actionBuilder.algebraicType).toEqual({
          tag: "Sum",
          value: {
            variants: [expect.objectContaining({ name: "EditAction" })],
          },
        })
        expect(StdbTesting.ContractType.literalValues(PresenceKind)).toEqual([
          "joined",
          "left",
        ])
        expect(builder).toEqual(
          expect.objectContaining({
            typeName: expect.stringMatching(GeneratedEnumName),
          }),
        )
      }),
  )

  it.effect("rejects string literal tags that collide after lowering", () =>
    Effect.gen(function* () {
      const cases = [
        ["foo-bar", "foo_bar"],
        ["foo", "Foo"],
      ] as const

      yield* Effect.forEach(
        cases,
        Effect.fn(function* (values) {
          const failure = yield* Effect.flip(
            Effect.try({
              try: () => StdbTesting.ContractType.literal(...values),
              catch: testEffectCallbackError(
                "interop/effect-spacetimedb/unit/type-kernel",
              ),
            }),
          )
          const cause = unwrapTestEffectCallbackError(failure)

          expect(cause).toBeInstanceOf(StdbValidationError)
          if (cause instanceof StdbValidationError) {
            expect(cause.diagnostics).toEqual([
              expect.objectContaining({
                code: "LiteralTagCollision",
                path: ["literal"],
              }),
            ])
          }
        }),
      )
    }),
  )

  it.effect(
    "rejects string literal tags that cannot map to SpaceTimeDB identifiers",
    () =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          Effect.try({
            try: () => StdbTesting.ContractType.literal("1-start"),
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/unit/type-kernel",
            ),
          }),
        )
        const cause = unwrapTestEffectCallbackError(failure)

        expect(cause).toBeInstanceOf(StdbValidationError)
        if (cause instanceof StdbValidationError) {
          expect(cause.diagnostics).toEqual([
            expect.objectContaining({
              code: "InvalidLiteralTag",
              path: ["literal"],
            }),
          ])
        }
      }),
  )

  it.effect("rejects numeric literals that cannot lower to f64 safely", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        [
          () => StdbTesting.ContractType.literal(Infinity),
          () => StdbTesting.ContractType.literal(NaN),
          () => StdbTesting.ContractType.literal(Number.MAX_SAFE_INTEGER + 1),
        ],
        Effect.fn(function* (makeLiteral) {
          const failure = yield* Effect.flip(
            Effect.try({
              try: makeLiteral,
              catch: testEffectCallbackError(
                "interop/effect-spacetimedb/unit/type-kernel",
              ),
            }),
          )
          const cause = unwrapTestEffectCallbackError(failure)

          expect(cause).toBeInstanceOf(StdbValidationError)
          if (cause instanceof StdbValidationError) {
            expect(cause.diagnostics).toEqual([
              expect.objectContaining({
                code: "NumericLiteralPrecision",
                path: ["literal"],
              }),
            ])
          }
        }),
      )

      const InRange = StdbTesting.ContractType.literal(Number.MAX_SAFE_INTEGER)
      const Float = StdbTesting.ContractType.literal(1.5)

      expect(typeBuilder(InRange).algebraicType.tag).toBe("F64")
      expect(typeBuilder(Float).algebraicType.tag).toBe("F64")
    }),
  )

  it.effect("supports f32 and byte-array lowering", () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([0, 1, 255])
      const bytesFromArray = yield* Schema.decodeUnknownEffect(
        StdbTesting.ContractType.bytes().schema,
      )([0, 1, 255])
      const bytesFromHex = yield* Schema.decodeUnknownEffect(
        StdbTesting.ContractType.bytes().schema,
      )("0001ff")
      const encodedBytes = yield* Schema.encodeEffect(
        StdbTesting.ContractType.bytes().schema,
      )(bytes)

      expect(
        typeBuilder(StdbTesting.ContractType.f32()).algebraicType.tag,
      ).toBe("F32")
      expect(
        typeBuilder(StdbTesting.ContractType.bytes()).algebraicType.tag,
      ).toBe("Array")
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbTesting.ContractType.f32().schema,
        )(1.5),
      ).toBe(1.5)
      expect(Array.from(bytesFromArray)).toEqual([0, 1, 255])
      expect(Array.from(bytesFromHex)).toEqual([0, 1, 255])
      expect(encodedBytes).toBe(bytes)
      expect(
        Schema.decodeUnknownResult(StdbTesting.ContractType.bytes().schema)([
          256,
        ]),
      ).toSatisfy(Result.isFailure)
    }),
  )

  it.effect("includes nested paths in unsupported type lowering failures", () =>
    Effect.gen(function* () {
      const UnsupportedParams = StdbTesting.ContractType.struct({
        id: StdbTesting.ContractType.string(),
        metadata: Schema.instanceOf(
          URL,
        ) as unknown as StdbTesting.ContractType.AnyValueType,
      })

      expect(() =>
        typeBuilder(UnsupportedParams, "reducers.userGet.params"),
      ).toThrow(/reducers\.userGet\.params\.metadata/)
    }),
  )

  it.effect("supports branded and special SpacetimeDB-native value types", () =>
    Effect.gen(function* () {
      const UserId = StdbTesting.ContractType.string(
        Schema.String.pipe(Schema.brand("UserId")),
      )

      expect(yield* Schema.decodeUnknownEffect(UserId.schema)("user-1")).toBe(
        "user-1",
      )
      expect(
        (yield* Schema.decodeUnknownEffect(
          StdbTesting.ContractType.uuid().schema,
        )(Uuid.NIL)).asBigInt(),
      ).toBe(Uuid.NIL.asBigInt())
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbTesting.ContractType.identity().schema,
        )(Identity.zero()),
      ).toEqual(Identity.zero())
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbTesting.ContractType.connectionId().schema,
        )(new ConnectionId(1n)),
      ).toEqual(new ConnectionId(1n))
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbTesting.ContractType.timestamp().schema,
        )(new Timestamp(1_000n)),
      ).toEqual(new Timestamp(1_000n))
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbTesting.ContractType.timeDuration().schema,
        )(TimeDuration.fromMillis(5)),
      ).toEqual(TimeDuration.fromMillis(5))
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbTesting.ContractType.scheduleAt().schema,
        )(ScheduleAt.interval(10n)),
      ).toEqual(ScheduleAt.interval(10n))
    }),
  )

  it.effect(
    "gives named primitive schema failures and accepts structural schedule primitives",
    () =>
      Effect.gen(function* () {
        const identityFailure = Schema.decodeUnknownResult(
          StdbTesting.ContractType.identity().schema,
        )("not-an-identity")
        const structuralScheduleAt = yield* Schema.decodeUnknownEffect(
          StdbTesting.ContractType.scheduleAt().schema,
        )({
          tag: "Interval",
          value: {
            __time_duration_micros__: 5_000n,
          },
        })
        const scheduleAtFailure = Schema.decodeUnknownResult(
          StdbTesting.ContractType.scheduleAt().schema,
        )({
          _tag: "Interval",
          value: TimeDuration.fromMillis(5),
        })

        expect(Result.isFailure(identityFailure)).toBe(true)
        expect(Result.isFailure(scheduleAtFailure)).toBe(true)
        expect(structuralScheduleAt).toEqual({
          tag: "Interval",
          value: TimeDuration.fromMillis(5),
        })

        if (Result.isFailure(identityFailure)) {
          const message = String(identityFailure.failure)
          expect(message).toContain("not-an-identity")
        }

        if (Result.isFailure(scheduleAtFailure)) {
          expect(String(scheduleAtFailure.failure)).toContain("tag")
        }
      }),
  )

  it.effect(
    "supports lazy recursive structs and exact-wire result envelopes",
    () =>
      Effect.gen(function* () {
        const tree = yield* Schema.decodeUnknownEffect(TreeType.schema)({
          name: "root",
          children: [{ name: "child", children: [] }],
        })

        expect(tree).toEqual({
          name: "root",
          children: [{ name: "child", children: [] }],
        })

        const ResultType = StdbTesting.ContractType.result(
          StdbTesting.ContractType.struct({
            ok: StdbTesting.ContractType.string(),
          }),
          StdbTesting.ContractType.struct({
            error: StdbTesting.ContractType.string(),
          }),
        )

        expect(
          yield* Schema.decodeUnknownEffect(ResultType.schema)({
            tag: "err",
            value: {
              error: "boom",
            },
          }),
        ).toEqual({
          err: {
            error: "boom",
          },
        })
        expect(
          yield* Schema.encodeEffect(ResultType.schema)({ ok: { ok: "yes" } }),
        ).toEqual({
          tag: "ok",
          value: {
            ok: "yes",
          },
        })
        expect(typeBuilder(ResultType).algebraicType.tag).toBe("Sum")
        expect(
          Schema.decodeUnknownResult(ResultType.schema)({
            tag: "ok",
            value: {
              ok: "yes",
            },
            extra: true,
          }),
        ).toSatisfy(Result.isFailure)

        const SumType = StdbTesting.ContractType.sum({
          Prose: StdbTesting.ContractType.struct({
            text: StdbTesting.ContractType.string(),
          }),
          Done: StdbTesting.ContractType.unit(),
        })
        const Phase = StdbTesting.ContractType.enum("Lobby", "Running")
        const makeDescriptor = Object.getOwnPropertyDescriptor(SumType, "make")
        const phaseMakeDescriptor = Object.getOwnPropertyDescriptor(
          Phase,
          "make",
        )

        expect(SumType.make.Prose({ text: "hello" })).toEqual({
          tag: "Prose",
          value: {
            text: "hello",
          },
        })
        expect(SumType.make.Done).toEqual({ tag: "Done" })
        expect(Phase.make.Lobby).toEqual({ tag: "Lobby" })
        expect(
          SumType.name("sum_content").make.Prose({ text: "hello" }),
        ).toEqual({
          tag: "Prose",
          value: {
            text: "hello",
          },
        })
        expect(SumType.optional().make.Done).toEqual({ tag: "Done" })
        expect(Phase.name("phase").make.Lobby).toEqual({ tag: "Lobby" })
        expect(makeDescriptor?.enumerable).toBe(false)
        expect(makeDescriptor?.writable).toBe(false)
        expect(phaseMakeDescriptor?.enumerable).toBe(false)
        expect(phaseMakeDescriptor?.writable).toBe(false)
        expect(Object.keys(SumType)).not.toContain("make")
        expect(Object.getOwnPropertyDescriptor(ResultType, "make")).toBe(
          undefined,
        )
        expect(
          yield* Schema.decodeUnknownEffect(SumType.schema)({
            Prose: {
              text: "hello",
            },
          }),
        ).toEqual({
          tag: "Prose",
          value: {
            text: "hello",
          },
        })
        expect(
          yield* Schema.decodeUnknownEffect(SumType.schema)({
            tag: "Prose",
            value: {
              text: "hello",
            },
          }),
        ).toEqual({
          tag: "Prose",
          value: {
            text: "hello",
          },
        })
        expect(
          yield* Schema.encodeEffect(SumType.schema)({
            tag: "Prose",
            value: {
              text: "hello",
            },
          }),
        ).toEqual({
          Prose: {
            text: "hello",
          },
        })
        expect(
          yield* Schema.encodeEffect(SumType.schema)({ tag: "Done" }),
        ).toEqual({
          Done: {},
        })
        expect(
          yield* Schema.decodeUnknownEffect(SumType.schema)({
            Done: [],
          }),
        ).toEqual({
          tag: "Done",
        })
        expect(
          yield* Schema.decodeUnknownEffect(SumType.schema)({
            Done: {},
          }),
        ).toEqual({
          tag: "Done",
        })
        expect(
          yield* Schema.decodeUnknownEffect(SumType.schema)([
            "Prose",
            { text: "hi" },
          ]),
        ).toEqual({
          tag: "Prose",
          value: {
            text: "hi",
          },
        })
        const doneHttpJson = StdbTesting.ClientHttpJson.encodeHttpInput(
          yield* Schema.encodeEffect(SumType.schema)({ tag: "Done" }),
        )
        expect(doneHttpJson).toBe('{"Done":{}}')
        expect(
          yield* StdbTesting.ClientHttpJson.decodeHttpOutput(
            SumType,
            doneHttpJson,
          ),
        ).toEqual({
          tag: "Done",
        })

        const OptionArgType = StdbTesting.ContractType.option(
          StdbTesting.ContractType.string(),
        )
        const someArgHttpJson = StdbTesting.ClientHttpJson.encodeHttpInput([
          yield* Schema.encodeEffect(OptionArgType.schema)("persona-1"),
        ])
        expect(someArgHttpJson).toBe('[{"some":"persona-1"}]')
        expect(
          yield* StdbTesting.ClientHttpJson.decodeHttpOutput(
            StdbTesting.ContractType.array(OptionArgType),
            someArgHttpJson,
          ),
        ).toEqual(["persona-1"])
        expect(
          yield* Schema.encodeEffect(OptionArgType.schema)("persona-1"),
        ).toEqual({
          some: "persona-1",
        })

        const noneArgHttpJson = StdbTesting.ClientHttpJson.encodeHttpInput([
          yield* Schema.encodeEffect(OptionArgType.schema)(undefined),
        ])
        expect(noneArgHttpJson).toBe('[{"none":{}}]')
        expect(
          yield* StdbTesting.ClientHttpJson.decodeHttpOutput(
            StdbTesting.ContractType.array(OptionArgType),
            noneArgHttpJson,
          ),
        ).toEqual([undefined])
        expect(
          yield* Schema.encodeEffect(OptionArgType.schema)(undefined),
        ).toEqual({
          none: {},
        })
        const OptionSumType = StdbTesting.ContractType.sum({
          Maybe: OptionArgType,
        })
        const encodedNoneVariant = yield* Schema.encodeEffect(
          OptionSumType.schema,
        )({
          tag: "Maybe",
          value: undefined,
        })
        expect(encodedNoneVariant).toEqual({
          Maybe: {
            none: {},
          },
        })
        const decodedNoneVariant = yield* Schema.decodeUnknownEffect(
          OptionSumType.schema,
        )(encodedNoneVariant)
        expect(Object.hasOwn(decodedNoneVariant, "value")).toBe(true)
        expect(decodedNoneVariant).toEqual({
          tag: "Maybe",
          value: undefined,
        })
        const MaybeLookup = StdbTesting.ContractType.option(
          StdbTesting.ContractType.struct({
            id: StdbTesting.ContractType.string(),
            status: StdbTesting.ContractType.literal("Generating", "Completed"),
          }),
        )
        expect(
          yield* Schema.encodeEffect(MaybeLookup.schema)({
            id: "turn-1",
            status: "Generating",
          }),
        ).toEqual({
          some: {
            id: "turn-1",
            status: {
              tag: "Generating",
            },
          },
        })
        expect(
          yield* Schema.encodeEffect(MaybeLookup.schema)(undefined),
        ).toEqual({
          none: {},
        })
        const dialoguePayload = StdbTesting.ContractType.struct({
          speaker: StdbTesting.ContractType.string(),
          tone: StdbTesting.ContractType.option(
            StdbTesting.ContractType.string(),
          ),
          text: StdbTesting.ContractType.string(),
        })
        const dialogueType = StdbTesting.ContractType.sum({
          dialogue: dialoguePayload,
        })
        expect(
          yield* Schema.decodeUnknownEffect(dialoguePayload.schema)({
            speaker: "The Narrator",
            text: "The door waits.",
          }),
        ).toEqual({
          speaker: "The Narrator",
          tone: undefined,
          text: "The door waits.",
        })
        expect(
          yield* Schema.encodeEffect(dialoguePayload.schema)({
            speaker: "The Narrator",
            text: "The door waits.",
          } as never),
        ).toEqual({
          speaker: "The Narrator",
          tone: {
            none: {},
          },
          text: "The door waits.",
        })
        expect(
          yield* Schema.encodeEffect(dialogueType.schema)({
            tag: "dialogue",
            value: {
              speaker: "The Narrator",
              tone: "measured",
              text: "The door waits.",
            },
          }),
        ).toEqual({
          dialogue: {
            speaker: "The Narrator",
            tone: {
              some: "measured",
            },
            text: "The door waits.",
          },
        })
        expect(typeBuilder(SumType).algebraicType.tag).toBe("Sum")

        const UnitOkResultType = StdbTesting.ContractType.result(
          StdbTesting.ContractType.unit(),
          StdbTesting.ContractType.string(),
        )
        expect(
          yield* Schema.decodeUnknownEffect(UnitOkResultType.schema)({
            tag: "ok",
          }),
        ).toEqual({
          ok: undefined,
        })
        expect(
          yield* Schema.encodeEffect(UnitOkResultType.schema)({
            ok: undefined,
          }),
        ).toEqual({
          tag: "ok",
        })
        expect(
          Schema.decodeUnknownResult(UnitOkResultType.schema)({
            tag: "ok",
            value: "not-unit",
          }),
        ).toSatisfy(Result.isFailure)

        const UnitErrResultType = StdbTesting.ContractType.result(
          StdbTesting.ContractType.string(),
          StdbTesting.ContractType.unit(),
        )
        expect(
          yield* Schema.decodeUnknownEffect(UnitErrResultType.schema)({
            tag: "err",
          }),
        ).toEqual({
          err: undefined,
        })
        expect(
          yield* Schema.encodeEffect(UnitErrResultType.schema)({
            err: undefined,
          }),
        ).toEqual({
          tag: "err",
        })

        const Done = StdbTesting.ContractType.custom(
          transform(Schema.Void, Schema.Literal("done"), {
            decode: () => "done" as const,
            encode: () => undefined,
          }),
          { type: StdbTesting.ContractType.unit() },
        )
        const UnitLiteralSumType = StdbTesting.ContractType.sum({
          Done,
        })
        expect(UnitLiteralSumType.make.Done("done")).toEqual({
          tag: "Done",
          value: "done",
        })
        expect(
          yield* Schema.decodeUnknownEffect(UnitLiteralSumType.schema)({
            Done: [],
          }),
        ).toEqual({
          tag: "Done",
          value: "done",
        })
        expect(
          yield* Schema.encodeEffect(UnitLiteralSumType.schema)({
            tag: "Done",
            value: "done",
          }),
        ).toEqual({
          Done: {},
        })
        expect(
          StdbTesting.encodeHostValue(
            UnitLiteralSumType,
            UnitLiteralSumType.make.Done("done"),
          ),
        ).toEqual({
          tag: "Done",
        })

        const WireLiteralDone = StdbTesting.ContractType.custom(
          transform(Schema.Literal("done"), Schema.Void, {
            decode: () => undefined,
            encode: () => "done" as const,
          }),
          { type: StdbTesting.ContractType.string() },
        )
        const AuthoredUnitLiteralSumType = StdbTesting.ContractType.sum({
          Done: WireLiteralDone,
        })
        expect(AuthoredUnitLiteralSumType.make.Done).toEqual({
          tag: "Done",
        })
        const authoredUnitDecoded = yield* Schema.decodeUnknownEffect(
          AuthoredUnitLiteralSumType.schema,
        )({
          Done: "done",
        })
        expect(authoredUnitDecoded).toStrictEqual({
          tag: "Done",
        })
        expect(Object.keys(authoredUnitDecoded)).toEqual(["tag"])
        expect(
          yield* Schema.encodeEffect(AuthoredUnitLiteralSumType.schema)(
            AuthoredUnitLiteralSumType.make.Done,
          ),
        ).toEqual({
          Done: "done",
        })
        expect(
          StdbTesting.encodeHostValue(
            AuthoredUnitLiteralSumType,
            AuthoredUnitLiteralSumType.make.Done,
          ),
        ).toEqual({
          tag: "Done",
          value: "done",
        })
        const UnitLiteralOkResultType = StdbTesting.ContractType.result(
          Done,
          StdbTesting.ContractType.string(),
        )
        expect(
          yield* Schema.decodeUnknownEffect(UnitLiteralOkResultType.schema)({
            tag: "ok",
          }),
        ).toEqual({
          ok: "done",
        })
        expect(
          StdbTesting.encodeHostValue(UnitLiteralOkResultType, {
            ok: "done",
          }),
        ).toEqual({
          ok: {},
        })
        expect(() =>
          StdbTesting.encodeHostValue(UnitLiteralOkResultType, {
            ok: "not done",
          }),
        ).toThrow()
        expect(
          StdbTesting.encodeHostValue(UnitLiteralOkResultType, {
            err: "not done",
          }),
        ).toEqual({
          err: "not done",
        })
        const UnitLiteralErrResultType = StdbTesting.ContractType.result(
          StdbTesting.ContractType.string(),
          Done,
        )
        expect(
          StdbTesting.encodeHostValue(UnitLiteralErrResultType, {
            err: "done",
          }),
        ).toEqual({
          err: {},
        })
        expect(() =>
          StdbTesting.encodeHostValue(UnitLiteralErrResultType, {
            err: "not done",
          }),
        ).toThrow()
        const StringResultType = StdbTesting.ContractType.result(
          StdbTesting.ContractType.string(),
          StdbTesting.ContractType.string(),
        )
        expect(
          StdbTesting.encodeHostValue(StringResultType, { ok: "accepted" }),
        ).toEqual({
          ok: "accepted",
        })
        expect(
          StdbTesting.encodeHostValue(StringResultType, {
            tag: "err",
            value: "rejected",
          }),
        ).toEqual({
          err: "rejected",
        })
        const NestedResultType = StdbTesting.ContractType.result(
          StdbTesting.ContractType.struct({
            entries: StdbTesting.ContractType.array(
              StdbTesting.ContractType.struct({
                artifactId: StdbTesting.ContractType.string(),
                labels: StdbTesting.ContractType.array(
                  StdbTesting.ContractType.string(),
                ),
                selectedBuild: StdbTesting.ContractType.option(
                  StdbTesting.ContractType.string(),
                ),
              }),
            ),
          }),
          StdbTesting.ContractType.struct({
            code: StdbTesting.ContractType.string(),
            details: StdbTesting.ContractType.option(
              StdbTesting.ContractType.struct({
                retryable: StdbTesting.ContractType.bool(),
              }),
            ),
          }),
        )
        expect(
          StdbTesting.encodeHostValue(NestedResultType, {
            ok: {
              entries: [
                {
                  artifactId: "artifact-1",
                  labels: ["stable", "candidate"],
                  selectedBuild: "build-1",
                },
                {
                  artifactId: "artifact-2",
                  labels: [],
                },
              ],
            },
          }),
        ).toEqual({
          ok: {
            entries: [
              {
                artifactId: "artifact-1",
                labels: ["stable", "candidate"],
                selectedBuild: "build-1",
              },
              {
                artifactId: "artifact-2",
                labels: [],
              },
            ],
          },
        })
        expect(
          StdbTesting.encodeHostValue(NestedResultType, {
            tag: "err",
            value: {
              code: "retry-later",
              details: { retryable: true },
            },
          }),
        ).toEqual({
          err: {
            code: "retry-later",
            details: {
              retryable: true,
            },
          },
        })

        const Params = StdbTesting.ContractType.struct({
          id: StdbTesting.ContractType.string(),
          child: StdbTesting.ContractType.optional(
            StdbTesting.ContractType.lazy(() =>
              StdbTesting.ContractType.struct({
                label: StdbTesting.ContractType.string(),
              }),
            ),
          ),
        })

        const paramsFields = StdbTesting.ContractType.structFields(Params)

        expect(paramsFields && Object.keys(paramsFields)).toEqual([
          "id",
          "child",
        ])
        expect(
          yield* Schema.decodeUnknownEffect(Params.schema)({
            id: "root",
          }),
        ).toEqual({
          id: "root",
        })
        expect(
          // lint-ignore: self-constructed-schema-decode - recursive decode coverage needs the authored schema directly.
          yield* Schema.decodeUnknownEffect(Params.schema)({
            id: "root",
            child: {
              label: "leaf",
            },
          }),
        ).toEqual({
          id: "root",
          child: {
            label: "leaf",
          },
        })

        const paramsBuilder = typeBuilder(Params)
        expect(paramsBuilder).toBe(typeBuilder(Params))
        expect(paramsBuilder).toEqual(
          expect.objectContaining({
            typeName: expect.stringMatching(GeneratedStructName),
          }),
        )
        expect(typeBuilder(TreeType)).toBe(typeBuilder(TreeType))

        const ForestType = StdbTesting.ContractType.array(TreeType)

        expect(typeBuilder(ForestType)).toBe(typeBuilder(ForestType))
      }),
  )
})
