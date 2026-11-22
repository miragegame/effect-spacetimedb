import * as EffectVitest from "@effect/vitest"

import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { StdbValidationDefect } from "effect-spacetimedb"
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

import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { TreeType } from "../fixtures/recursive-types"
import { transform } from "../helpers/schema-transform"
import { TestLayer } from "../helpers/test-layer"
import { builderTypeName, typeBuilder } from "../helpers/type-builder"
import { testArrayLength } from "../helpers/array-bounds"

const describe = EffectVitest.layer(TestLayer)
const GeneratedStructName = /^EffectSpacetimeDbStruct[0-9]{40}$/
const GeneratedEnumName = /^EffectSpacetimeDbEnum[0-9]{40}$/
const GeneratedSumName = /^EffectSpacetimeDbSum[0-9]{40}$/

type RecursiveNameNode = {
  readonly children: ReadonlyArray<RecursiveNameNode>
}

const makeRecursiveNameNode = (): ReturnType<
  typeof StdbInternal.ContractType.lazy<RecursiveNameNode, unknown>
> => {
  const Node: ReturnType<
    typeof StdbInternal.ContractType.lazy<RecursiveNameNode, unknown>
  > = StdbInternal.ContractType.lazy(() =>
    StdbInternal.ContractType.struct({
      children: StdbInternal.ContractType.array(Node, testArrayLength),
    }),
  )

  return Node
}

describe("type kernel", (it) => {
  it.effect(
    "returns opaque value-types that expose their Effect schema through .schema",
    () =>
      Effect.gen(function* () {
        const UserId = StdbInternal.ContractType.string(
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
        const Refined = StdbInternal.ContractType.string(
          Schema.String.pipe(
            Schema.brand("TypeKernel/Refined"),
            Schema.check(Schema.isMinLength(0), Schema.isMaxLength(255)),
          ),
        )
        const Annotated = StdbInternal.ContractType.string(
          Schema.String.pipe(
            Schema.annotate({ description: "annotated refined value-type" }),
            Schema.brand("TypeKernel/Annotated"),
          ),
        )
        const RefinedU64 = StdbInternal.ContractType.u64(
          Schema.BigInt.pipe(
            Schema.brand("TypeKernel/RefinedU64"),
            Schema.check(Schema.isLessThanOrEqualToBigInt(10n)),
          ),
        )
        const Transformed = StdbInternal.ContractType.string(
          transform(Schema.String, StdbInternal.ContractType.string().schema, {
            decode: (value) => value,
            encode: (value) => value,
          }),
        )

        expect(typeBuilder(Refined).algebraicType.tag).toBe("String")
        expect(typeBuilder(Annotated).algebraicType.tag).toBe("String")
        expect(typeBuilder(RefinedU64).algebraicType.tag).toBe("U64")
        expect(typeBuilder(Transformed).algebraicType.tag).toBe("String")

        const NumberFromString = StdbInternal.ContractType.f64(
          Schema.FiniteFromString as never,
        )
        expect(typeBuilder(NumberFromString).algebraicType.tag).toBe(
          typeBuilder(StdbInternal.ContractType.f64()).algebraicType.tag,
        )
      }),
  )

  it.effect(
    "rejects raw scalar schemas that bypass the authoring type gate",
    () =>
      Effect.gen(function* () {
        expect(() =>
          typeBuilder(
            Schema.String as unknown as StdbInternal.ContractType.AnyValueType,
          ),
        ).toThrow(/SpaceTimeDB type lowering failed/)
        expect(() =>
          typeBuilder(
            Schema.Finite as unknown as StdbInternal.ContractType.AnyValueType,
          ),
        ).toThrow(/SpaceTimeDB type lowering failed/)
        expect(() =>
          typeBuilder(
            Schema.Boolean as unknown as StdbInternal.ContractType.AnyValueType,
          ),
        ).toThrow(/SpaceTimeDB type lowering failed/)
      }),
  )

  it.effect("reports nested unsupported schema lowering paths", () =>
    Effect.gen(function* () {
      const UnsupportedNested = {
        schema: Schema.Struct({
          rows: Schema.Array(Schema.Symbol),
        }),
      } as unknown as StdbInternal.ContractType.AnyValueType

      expect(() => typeBuilder(UnsupportedNested)).toThrow(
        "SpaceTimeDB type lowering failed at rows[]: unsupported Effect Schema AST Symbol.",
      )
      expect(() => typeBuilder(UnsupportedNested, "payload")).toThrow(
        "SpaceTimeDB type lowering failed at payload.rows[]: unsupported Effect Schema AST Symbol.",
      )
    }),
  )

  it.effect("enforces constructor refinements at value decode boundaries", () =>
    Effect.gen(function* () {
      const Name = StdbInternal.ContractType.string(
        Schema.String.pipe(
          Schema.brand("TypeKernel/Name"),
          Schema.check(Schema.isMaxLength(100)),
        ),
      )
      const Count = StdbInternal.ContractType.u64(
        Schema.BigInt.pipe(
          Schema.brand("TypeKernel/Count"),
          Schema.check(Schema.isLessThanOrEqualToBigInt(10n)),
        ),
      )
      const DomainCount = StdbInternal.ContractType.u64(
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
      const CountFromString = StdbInternal.ContractType.custom(
        Schema.FiniteFromString,
        {
          type: StdbInternal.ContractType.string(),
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
      const Params = StdbInternal.ContractType.struct({
        id: StdbInternal.ContractType.string(),
        tags: StdbInternal.ContractType.array(
          StdbInternal.ContractType.string(),
          testArrayLength,
        ),
        maybeCount: StdbInternal.ContractType.option(
          StdbInternal.ContractType.u32(),
        ),
      })
      const MaybeCount = StdbInternal.ContractType.option(
        StdbInternal.ContractType.u32(),
      )

      const descriptor = StdbInternal.ContractTypeDescriptor.describe(Params)
      expect(descriptor).toEqual(
        expect.objectContaining({
          _tag: "Struct",
          kind: "struct",
        }),
      )
      expect(StdbInternal.ContractTypeDescriptor.children(Params)).toHaveLength(
        3,
      )
      expect(
        StdbInternal.ContractTypeDescriptor.describe(
          StdbInternal.ContractType.array(
            StdbInternal.ContractType.string(),
            testArrayLength,
          ),
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
        const UserParams = StdbInternal.ContractType.struct({
          id: StdbInternal.ContractType.string(),
          count: StdbInternal.ContractType.u32(),
        })
        const SameUserParams = StdbInternal.ContractType.struct({
          id: StdbInternal.ContractType.string(),
          count: StdbInternal.ContractType.u32(),
        })
        const ReorderedUserParams = StdbInternal.ContractType.struct({
          count: StdbInternal.ContractType.u32(),
          id: StdbInternal.ContractType.string(),
        })
        const Nested = StdbInternal.ContractType.struct({
          maybeUser: StdbInternal.ContractType.option(SameUserParams),
          users: StdbInternal.ContractType.array(UserParams, testArrayLength),
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
          StdbInternal.ContractType.satsTypeFingerprint(SameUserParams),
        ).toBe(StdbInternal.ContractType.satsTypeFingerprint(UserParams))
        expect(
          StdbInternal.ContractType.satsTypeFingerprint(ReorderedUserParams),
        ).not.toBe(StdbInternal.ContractType.satsTypeFingerprint(UserParams))
      }),
  )

  it.effect(
    "keeps existing composite names stable across insertion and traversal order",
    () =>
      Effect.gen(function* () {
        const First = StdbInternal.ContractType.struct({
          first: StdbInternal.ContractType.string(),
        })
        const Second = StdbInternal.ContractType.sum({
          A: StdbInternal.ContractType.string(),
          B: StdbInternal.ContractType.u32(),
        })
        const Envelope = StdbInternal.procedureEnvelope(
          StdbInternal.ContractType.option(First),
          StdbInternal.ContractError.errors(
            class InsertedNameError extends Schema.TaggedError<InsertedNameError>()(
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

        const Inserted = StdbInternal.ContractType.struct({
          inserted: StdbInternal.ContractType.bool(),
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
        const RecursiveFirst = makeRecursiveNameNode()
        const SameRecursive = makeRecursiveNameNode()
        const ParentWithIndependentChildren = StdbInternal.ContractType.struct({
          first: RecursiveFirst,
          second: SameRecursive,
        })
        const ParentWithSharedChild = StdbInternal.ContractType.struct({
          first: RecursiveFirst,
          second: RecursiveFirst,
        })

        expect(builderTypeName(typeBuilder(RecursiveFirst))).toBe(
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
        const Kind = StdbInternal.ContractType.literal("joined", "left")
        const SameKind = StdbInternal.ContractType.literal("joined", "left")
        const ReorderedKind = StdbInternal.ContractType.literal(
          "left",
          "joined",
        )
        const EnumContainer = StdbInternal.ContractType.struct({
          kind: Kind,
        })
        const UnitSum = StdbInternal.ContractType.sum({
          Joined: StdbInternal.ContractType.unit(),
          Left: StdbInternal.ContractType.unit(),
        })
        const UnitEnum = StdbInternal.ContractType.enum("Joined", "Left")
        const UnitSumContainer = StdbInternal.ContractType.struct({
          kind: UnitSum,
        })
        const Action = StdbInternal.ContractType.sum({
          Create: StdbInternal.ContractType.string(),
          Delete: StdbInternal.ContractType.unit(),
        })
        const SameAction = StdbInternal.ContractType.sum({
          Create: StdbInternal.ContractType.string(),
          Delete: StdbInternal.ContractType.unit(),
        })
        const ReorderedAction = StdbInternal.ContractType.sum({
          Delete: StdbInternal.ContractType.unit(),
          Create: StdbInternal.ContractType.string(),
        })
        const ResultType = StdbInternal.ContractType.result(
          StdbInternal.ContractType.string(),
          StdbInternal.ContractType.u32(),
        )
        const Envelope = StdbInternal.procedureEnvelope(
          StdbInternal.ContractType.string(),
          StdbInternal.ContractError.errors(
            class EnvelopeNameError extends Schema.TaggedError<EnvelopeNameError>()(
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
        StdbInternal.ContractTypeName.makeContentAddressedNameFactory(
          () => "00000000000000000000000000000000",
        )
      const first = nameFor("Struct", "first-fingerprint")

      expect(nameFor("Struct", "first-fingerprint")).toBe(first)
      expect(() => nameFor("Struct", "second-fingerprint")).toThrow(
        StdbInternal.ContractTypeName.SatsTypeNameCollisionDefect,
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
          typeBuilder(StdbInternal.ContractType.u8()).algebraicType.tag,
        ).toBe("U8")
        expect(
          typeBuilder(StdbInternal.ContractType.u16()).algebraicType.tag,
        ).toBe("U16")
        expect(
          typeBuilder(StdbInternal.ContractType.u32()).algebraicType.tag,
        ).toBe("U32")
        expect(
          typeBuilder(StdbInternal.ContractType.i8()).algebraicType.tag,
        ).toBe("I8")
        expect(
          typeBuilder(StdbInternal.ContractType.i16()).algebraicType.tag,
        ).toBe("I16")
        expect(
          typeBuilder(StdbInternal.ContractType.i32()).algebraicType.tag,
        ).toBe("I32")
        expect(
          typeBuilder(StdbInternal.ContractType.i64()).algebraicType.tag,
        ).toBe("I64")
        expect(
          typeBuilder(StdbInternal.ContractType.u64()).algebraicType.tag,
        ).toBe("U64")
        expect(
          typeBuilder(StdbInternal.ContractType.i128()).algebraicType.tag,
        ).toBe("I128")
        expect(
          typeBuilder(StdbInternal.ContractType.u128()).algebraicType.tag,
        ).toBe("U128")
        expect(
          typeBuilder(StdbInternal.ContractType.i256()).algebraicType.tag,
        ).toBe("I256")
        expect(
          typeBuilder(StdbInternal.ContractType.u256()).algebraicType.tag,
        ).toBe("U256")

        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.u8().schema,
          )(0),
        ).toBe(0)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.u8().schema,
          )(u8Max),
        ).toBe(u8Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.u16().schema,
          )(u16Max),
        ).toBe(u16Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i8().schema,
          )(i8Min),
        ).toBe(i8Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i8().schema,
          )(i8Max),
        ).toBe(i8Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i16().schema,
          )(i16Min),
        ).toBe(i16Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i16().schema,
          )(i16Max),
        ).toBe(i16Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i32().schema,
          )(i32Min),
        ).toBe(i32Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i32().schema,
          )(i32Max),
        ).toBe(i32Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.u32().schema,
          )(0),
        ).toBe(0)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.u32().schema,
          )(u32Max),
        ).toBe(u32Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i64().schema,
          )(i64Min),
        ).toBe(i64Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i64().schema,
          )(i64Max),
        ).toBe(i64Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.u64().schema,
          )(u64Max),
        ).toBe(u64Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i128().schema,
          )(i128Min),
        ).toBe(i128Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i128().schema,
          )(i128Max),
        ).toBe(i128Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.u128().schema,
          )(u128Max),
        ).toBe(u128Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i256().schema,
          )(i256Min),
        ).toBe(i256Min)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.i256().schema,
          )(i256Max),
        ).toBe(i256Max)
        expect(
          yield* Schema.decodeUnknownEffect(
            StdbInternal.ContractType.u256().schema,
          )(u256Max),
        ).toBe(u256Max)

        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u8().schema)(-1),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u8().schema)(
            u8Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i8().schema)(
            i8Min - 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i8().schema)(
            i8Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u16().schema)(
            -1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u16().schema)(
            u16Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i16().schema)(
            i16Min - 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i16().schema)(
            i16Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i32().schema)(
            i32Min - 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i32().schema)(
            i32Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u32().schema)(
            -1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u32().schema)(
            u32Max + 1,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i64().schema)(
            i64Min - 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i64().schema)(
            i64Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u64().schema)(
            -1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u64().schema)(
            u64Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i128().schema)(
            i128Min - 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i128().schema)(
            i128Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u128().schema)(
            -1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u128().schema)(
            u128Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i256().schema)(
            i256Min - 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.i256().schema)(
            i256Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u256().schema)(
            -1n,
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(StdbInternal.ContractType.u256().schema)(
            u256Max + 1n,
          ),
        ).toSatisfy(Result.isFailure)

        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.u32(Schema.Finite).schema,
          )(-1),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.u32(Schema.Finite).schema,
          )(u32Max + 1),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.i64(Schema.BigInt).schema,
          )(i64Min - 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.i64(Schema.BigInt).schema,
          )(i64Max + 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.u64(Schema.BigInt).schema,
          )(-1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.u64(Schema.BigInt).schema,
          )(u64Max + 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.i128(Schema.BigInt).schema,
          )(i128Min - 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.i128(Schema.BigInt).schema,
          )(i128Max + 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.u128(Schema.BigInt).schema,
          )(-1n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.u128(Schema.BigInt).schema,
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
            StdbInternal.ContractType.u32(InvalidU32Transform).schema,
          )(u32Max + 1),
        ).toSatisfy(Result.isFailure)
        expect(
          yield* Effect.result(
            Schema.encodeEffect(
              StdbInternal.ContractType.u32(InvalidU32Transform).schema,
            )(0),
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.u32(InvalidDecodedU32Transform).schema,
          )(0),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.u64(InvalidUnsignedTransform).schema,
          )(u64Max + 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          yield* Effect.result(
            Schema.encodeEffect(
              StdbInternal.ContractType.u64(InvalidUnsignedTransform).schema,
            )(0n),
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.i64(InvalidSignedTransform).schema,
          )(i64Max + 1n),
        ).toSatisfy(Result.isFailure)
        expect(
          yield* Effect.result(
            Schema.encodeEffect(
              StdbInternal.ContractType.i64(InvalidSignedTransform).schema,
            )(0n),
          ),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.u64(InvalidDecodedUnsignedTransform)
              .schema,
          )(0n),
        ).toSatisfy(Result.isFailure)
        expect(
          Schema.decodeUnknownResult(
            StdbInternal.ContractType.i64(InvalidDecodedSignedTransform).schema,
          )(0n),
        ).toSatisfy(Result.isFailure)
      }),
  )

  it.effect(
    "keeps identifier-safe string literals verbatim while lowering them to SATS enums",
    () =>
      Effect.gen(function* () {
        const PresenceKind = StdbInternal.ContractType.literal("joined", "left")
        const ReviewKind = StdbInternal.ContractType.literal("pending_review")
        const ActionKind = StdbInternal.ContractType.literal("edit-action")
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
        expect(StdbInternal.ContractType.literalValues(PresenceKind)).toEqual([
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
              try: () => StdbInternal.ContractType.literal(...values),
              catch: testEffectCallbackError(
                "effect-spacetimedb/unit/type-kernel",
              ),
            }),
          )
          const cause = unwrapTestEffectCallbackError(failure)

          expect(cause).toBeInstanceOf(StdbValidationDefect)
          if (cause instanceof StdbValidationDefect) {
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
            try: () => StdbInternal.ContractType.literal("1-start"),
            catch: testEffectCallbackError(
              "effect-spacetimedb/unit/type-kernel",
            ),
          }),
        )
        const cause = unwrapTestEffectCallbackError(failure)

        expect(cause).toBeInstanceOf(StdbValidationDefect)
        if (cause instanceof StdbValidationDefect) {
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
          () => StdbInternal.ContractType.literal(Infinity),
          () => StdbInternal.ContractType.literal(NaN),
          () => StdbInternal.ContractType.literal(Number.MAX_SAFE_INTEGER + 1),
        ],
        Effect.fn(function* (makeLiteral) {
          const failure = yield* Effect.flip(
            Effect.try({
              try: makeLiteral,
              catch: testEffectCallbackError(
                "effect-spacetimedb/unit/type-kernel",
              ),
            }),
          )
          const cause = unwrapTestEffectCallbackError(failure)

          expect(cause).toBeInstanceOf(StdbValidationDefect)
          if (cause instanceof StdbValidationDefect) {
            expect(cause.diagnostics).toEqual([
              expect.objectContaining({
                code: "NumericLiteralPrecision",
                path: ["literal"],
              }),
            ])
          }
        }),
      )

      const InRange = StdbInternal.ContractType.literal(Number.MAX_SAFE_INTEGER)
      const Float = StdbInternal.ContractType.literal(1.5)

      expect(typeBuilder(InRange).algebraicType.tag).toBe("F64")
      expect(typeBuilder(Float).algebraicType.tag).toBe("F64")
    }),
  )

  it.effect("supports f32 and byte-array lowering", () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([0, 1, 255])
      const bytesFromArray = yield* Schema.decodeUnknownEffect(
        StdbInternal.ContractType.bytes().schema,
      )([0, 1, 255])
      const bytesFromHex = yield* Schema.decodeUnknownEffect(
        StdbInternal.ContractType.bytes().schema,
      )("0001ff")
      const encodedBytes = yield* Schema.encodeEffect(
        StdbInternal.ContractType.bytes().schema,
      )(bytes)

      expect(
        typeBuilder(StdbInternal.ContractType.f32()).algebraicType.tag,
      ).toBe("F32")
      expect(
        typeBuilder(StdbInternal.ContractType.bytes()).algebraicType.tag,
      ).toBe("Array")
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbInternal.ContractType.f32().schema,
        )(1.5),
      ).toBe(1.5)
      expect(Array.from(bytesFromArray)).toEqual([0, 1, 255])
      expect(Array.from(bytesFromHex)).toEqual([0, 1, 255])
      expect(encodedBytes).toBe(bytes)
      expect(
        Schema.decodeUnknownResult(StdbInternal.ContractType.bytes().schema)([
          256,
        ]),
      ).toSatisfy(Result.isFailure)
    }),
  )

  it.effect("includes nested paths in unsupported type lowering failures", () =>
    Effect.gen(function* () {
      const UnsupportedParams = StdbInternal.ContractType.struct({
        id: StdbInternal.ContractType.string(),
        metadata: Schema.instanceOf(
          URL,
        ) as unknown as StdbInternal.ContractType.AnyValueType,
      })

      expect(() =>
        typeBuilder(UnsupportedParams, "reducers.userGet.params"),
      ).toThrow(/reducers\.userGet\.params\.metadata/)
    }),
  )

  it.effect("supports branded and special SpacetimeDB-native value types", () =>
    Effect.gen(function* () {
      const UserId = StdbInternal.ContractType.string(
        Schema.String.pipe(Schema.brand("UserId")),
      )

      expect(yield* Schema.decodeUnknownEffect(UserId.schema)("user-1")).toBe(
        "user-1",
      )
      expect(
        (yield* Schema.decodeUnknownEffect(
          StdbInternal.ContractType.uuid().schema,
        )(Uuid.NIL)).asBigInt(),
      ).toBe(Uuid.NIL.asBigInt())
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbInternal.ContractType.identity().schema,
        )(Identity.zero()),
      ).toEqual(Identity.zero())
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbInternal.ContractType.connectionId().schema,
        )(new ConnectionId(1n)),
      ).toEqual(new ConnectionId(1n))
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbInternal.ContractType.timestamp().schema,
        )(new Timestamp(1_000n)),
      ).toEqual(new Timestamp(1_000n))
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbInternal.ContractType.timeDuration().schema,
        )(TimeDuration.fromMillis(5)),
      ).toEqual(TimeDuration.fromMillis(5))
      expect(
        yield* Schema.decodeUnknownEffect(
          StdbInternal.ContractType.scheduleAt().schema,
        )(ScheduleAt.interval(10n)),
      ).toEqual(ScheduleAt.interval(10n))
    }),
  )

  it.effect(
    "gives named primitive schema failures and accepts structural schedule primitives",
    () =>
      Effect.gen(function* () {
        const identityFailure = Schema.decodeUnknownResult(
          StdbInternal.ContractType.identity().schema,
        )("not-an-identity")
        const structuralScheduleAt = yield* Schema.decodeUnknownEffect(
          StdbInternal.ContractType.scheduleAt().schema,
        )({
          tag: "Interval",
          value: {
            __time_duration_micros__: 5_000n,
          },
        })
        const scheduleAtFailure = Schema.decodeUnknownResult(
          StdbInternal.ContractType.scheduleAt().schema,
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

        const ResultType = StdbInternal.ContractType.result(
          StdbInternal.ContractType.struct({
            ok: StdbInternal.ContractType.string(),
          }),
          StdbInternal.ContractType.struct({
            error: StdbInternal.ContractType.string(),
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

        const SumType = StdbInternal.ContractType.sum({
          Prose: StdbInternal.ContractType.struct({
            text: StdbInternal.ContractType.string(),
          }),
          Done: StdbInternal.ContractType.unit(),
        })
        const Phase = StdbInternal.ContractType.enum("Lobby", "Running")
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
          SumType.columnName("sum_content").make.Prose({ text: "hello" }),
        ).toEqual({
          tag: "Prose",
          value: {
            text: "hello",
          },
        })
        expect(SumType.optional().make.Done).toEqual({ tag: "Done" })
        expect(Phase.columnName("phase").make.Lobby).toEqual({ tag: "Lobby" })
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
        const doneHttpJson = StdbInternal.ClientHttpJson.encodeHttpInput(
          yield* Schema.encodeEffect(SumType.schema)({ tag: "Done" }),
        )
        expect(doneHttpJson).toBe('{"Done":{}}')
        expect(
          yield* StdbInternal.ClientHttpJson.decodeHttpOutput(
            SumType,
            doneHttpJson,
          ),
        ).toEqual({
          tag: "Done",
        })

        const OptionArgType = StdbInternal.ContractType.option(
          StdbInternal.ContractType.string(),
        )
        const someArgHttpJson = StdbInternal.ClientHttpJson.encodeHttpInput([
          yield* Schema.encodeEffect(OptionArgType.schema)("persona-1"),
        ])
        expect(someArgHttpJson).toBe('[{"some":"persona-1"}]')
        expect(
          yield* StdbInternal.ClientHttpJson.decodeHttpOutput(
            StdbInternal.ContractType.array(OptionArgType, testArrayLength),
            someArgHttpJson,
          ),
        ).toEqual(["persona-1"])
        expect(
          yield* Schema.encodeEffect(OptionArgType.schema)("persona-1"),
        ).toEqual({
          some: "persona-1",
        })

        const noneArgHttpJson = StdbInternal.ClientHttpJson.encodeHttpInput([
          yield* Schema.encodeEffect(OptionArgType.schema)(undefined),
        ])
        expect(noneArgHttpJson).toBe('[{"none":{}}]')
        expect(
          yield* StdbInternal.ClientHttpJson.decodeHttpOutput(
            StdbInternal.ContractType.array(OptionArgType, testArrayLength),
            noneArgHttpJson,
          ),
        ).toEqual([undefined])
        expect(
          yield* Schema.encodeEffect(OptionArgType.schema)(undefined),
        ).toEqual({
          none: {},
        })
        const OptionSumType = StdbInternal.ContractType.sum({
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
        const MaybeLookup = StdbInternal.ContractType.option(
          StdbInternal.ContractType.struct({
            id: StdbInternal.ContractType.string(),
            status: StdbInternal.ContractType.literal(
              "Generating",
              "Completed",
            ),
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
        const dialoguePayload = StdbInternal.ContractType.struct({
          speaker: StdbInternal.ContractType.string(),
          tone: StdbInternal.ContractType.option(
            StdbInternal.ContractType.string(),
          ),
          text: StdbInternal.ContractType.string(),
        })
        const dialogueType = StdbInternal.ContractType.sum({
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

        const UnitOkResultType = StdbInternal.ContractType.result(
          StdbInternal.ContractType.unit(),
          StdbInternal.ContractType.string(),
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

        const UnitErrResultType = StdbInternal.ContractType.result(
          StdbInternal.ContractType.string(),
          StdbInternal.ContractType.unit(),
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

        const Done = StdbInternal.ContractType.custom(
          transform(Schema.Void, Schema.Literal("done"), {
            decode: () => "done" as const,
            encode: () => undefined,
          }),
          { type: StdbInternal.ContractType.unit() },
        )
        const UnitLiteralSumType = StdbInternal.ContractType.sum({
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
          StdbInternal.encodeHostValue(
            UnitLiteralSumType,
            UnitLiteralSumType.make.Done("done"),
          ),
        ).toEqual({
          tag: "Done",
        })

        const WireLiteralDone = StdbInternal.ContractType.custom(
          transform(Schema.Literal("done"), Schema.Void, {
            decode: () => undefined,
            encode: () => "done" as const,
          }),
          { type: StdbInternal.ContractType.string() },
        )
        const AuthoredUnitLiteralSumType = StdbInternal.ContractType.sum({
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
          StdbInternal.encodeHostValue(
            AuthoredUnitLiteralSumType,
            AuthoredUnitLiteralSumType.make.Done,
          ),
        ).toEqual({
          tag: "Done",
          value: "done",
        })
        const UnitLiteralOkResultType = StdbInternal.ContractType.result(
          Done,
          StdbInternal.ContractType.string(),
        )
        expect(
          yield* Schema.decodeUnknownEffect(UnitLiteralOkResultType.schema)({
            tag: "ok",
          }),
        ).toEqual({
          ok: "done",
        })
        expect(
          StdbInternal.encodeHostValue(UnitLiteralOkResultType, {
            ok: "done",
          }),
        ).toEqual({
          ok: {},
        })
        expect(() =>
          StdbInternal.encodeHostValue(UnitLiteralOkResultType, {
            ok: "not done",
          }),
        ).toThrow()
        expect(
          StdbInternal.encodeHostValue(UnitLiteralOkResultType, {
            err: "not done",
          }),
        ).toEqual({
          err: "not done",
        })
        const UnitLiteralErrResultType = StdbInternal.ContractType.result(
          StdbInternal.ContractType.string(),
          Done,
        )
        expect(
          StdbInternal.encodeHostValue(UnitLiteralErrResultType, {
            err: "done",
          }),
        ).toEqual({
          err: {},
        })
        expect(() =>
          StdbInternal.encodeHostValue(UnitLiteralErrResultType, {
            err: "not done",
          }),
        ).toThrow()
        const StringResultType = StdbInternal.ContractType.result(
          StdbInternal.ContractType.string(),
          StdbInternal.ContractType.string(),
        )
        expect(
          StdbInternal.encodeHostValue(StringResultType, { ok: "accepted" }),
        ).toEqual({
          ok: "accepted",
        })
        expect(
          StdbInternal.encodeHostValue(StringResultType, {
            tag: "err",
            value: "rejected",
          }),
        ).toEqual({
          err: "rejected",
        })
        const NestedResultType = StdbInternal.ContractType.result(
          StdbInternal.ContractType.struct({
            entries: StdbInternal.ContractType.array(
              StdbInternal.ContractType.struct({
                artifactId: StdbInternal.ContractType.string(),
                labels: StdbInternal.ContractType.array(
                  StdbInternal.ContractType.string(),
                  testArrayLength,
                ),
                selectedBuild: StdbInternal.ContractType.option(
                  StdbInternal.ContractType.string(),
                ),
              }),
              testArrayLength,
            ),
          }),
          StdbInternal.ContractType.struct({
            code: StdbInternal.ContractType.string(),
            details: StdbInternal.ContractType.option(
              StdbInternal.ContractType.struct({
                retryable: StdbInternal.ContractType.bool(),
              }),
            ),
          }),
        )
        expect(
          StdbInternal.encodeHostValue(NestedResultType, {
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
          StdbInternal.encodeHostValue(NestedResultType, {
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

        const Params = StdbInternal.ContractType.struct({
          id: StdbInternal.ContractType.string(),
          child: StdbInternal.ContractType.optional(
            StdbInternal.ContractType.lazy(() =>
              StdbInternal.ContractType.struct({
                label: StdbInternal.ContractType.string(),
              }),
            ),
          ),
        })

        const paramsFields = StdbInternal.ContractType.structFields(Params)

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

        const ForestType = StdbInternal.ContractType.array(
          TreeType,
          testArrayLength,
        )

        expect(typeBuilder(ForestType)).toBe(typeBuilder(ForestType))
      }),
  )
})
