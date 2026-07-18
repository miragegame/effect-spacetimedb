import * as EffectVitest from "@effect/vitest"
import * as Schema from "effect/Schema"
import * as FastCheck from "effect/testing/FastCheck"
import * as StdbTesting from "effect-spacetimedb/testing"
import { codecCorpus } from "../helpers/codec-corpus"

const { describe, expect, it } = EffectVitest

const T = StdbTesting.ContractType
const TypeName = StdbTesting.ContractTypeName

const fingerprintPropertyOptions = {
  fastCheck: { numRuns: 300, seed: 0xf16e123 },
} as const

type Tree = {
  readonly name: string
  readonly children: ReadonlyArray<Tree>
}

type TypeFactoryEntry = {
  readonly kind: StdbTesting.ContractType.TypeKind
  readonly original: StdbTesting.ContractType.AnyValueType
  readonly rebuild: () => StdbTesting.ContractType.AnyValueType
}

const makeTreeType = (): StdbTesting.ContractType.AnyValueType => {
  const TreeAgain: ReturnType<typeof T.lazy<Tree, unknown>> = T.lazy(() =>
    T.struct({
      name: T.string(),
      children: T.array(TreeAgain),
    }),
  )

  return TreeAgain
}

const makeSimpleSum = () =>
  T.sum({
    named: T.struct({
      label: T.string(),
    }),
    unitCase: T.unit(),
  })

const typeFactories: ReadonlyArray<TypeFactoryEntry> = [
  {
    kind: "array",
    original: codecCorpus.array.type,
    rebuild: () => T.array(T.u16()),
  },
  {
    kind: "bigint",
    original: codecCorpus.bigint.type,
    rebuild: () => T.bigint(),
  },
  { kind: "bool", original: codecCorpus.bool.type, rebuild: () => T.bool() },
  { kind: "bytes", original: codecCorpus.bytes.type, rebuild: () => T.bytes() },
  {
    kind: "connectionId",
    original: codecCorpus.connectionId.type,
    rebuild: () => T.connectionId(),
  },
  {
    kind: "custom",
    original: codecCorpus.custom.type,
    rebuild: () => T.custom(Schema.String, { type: T.string() }),
  },
  { kind: "f32", original: codecCorpus.f32.type, rebuild: () => T.f32() },
  { kind: "f64", original: codecCorpus.f64.type, rebuild: () => T.f64() },
  {
    kind: "identity",
    original: codecCorpus.identity.type,
    rebuild: () => T.identity(),
  },
  { kind: "i8", original: codecCorpus.i8.type, rebuild: () => T.i8() },
  { kind: "i16", original: codecCorpus.i16.type, rebuild: () => T.i16() },
  { kind: "i32", original: codecCorpus.i32.type, rebuild: () => T.i32() },
  { kind: "i64", original: codecCorpus.i64.type, rebuild: () => T.i64() },
  { kind: "i128", original: codecCorpus.i128.type, rebuild: () => T.i128() },
  { kind: "i256", original: codecCorpus.i256.type, rebuild: () => T.i256() },
  { kind: "lazy", original: codecCorpus.lazy.type, rebuild: makeTreeType },
  {
    kind: "literal",
    original: codecCorpus.literal.type,
    rebuild: () => T.literal("joined", "left"),
  },
  {
    kind: "option",
    original: codecCorpus.option.type,
    rebuild: () => T.option(T.string()),
  },
  {
    kind: "result",
    original: codecCorpus.result.type,
    rebuild: () => T.result(T.string(), T.string()),
  },
  {
    kind: "scheduleAt",
    original: codecCorpus.scheduleAt.type,
    rebuild: () => T.scheduleAt(),
  },
  {
    kind: "string",
    original: codecCorpus.string.type,
    rebuild: () => T.string(),
  },
  {
    kind: "struct",
    original: codecCorpus.struct.type,
    rebuild: () =>
      T.struct({
        id: T.string(),
        count: T.u32(),
      }),
  },
  { kind: "sum", original: codecCorpus.sum.type, rebuild: makeSimpleSum },
  {
    kind: "timeDuration",
    original: codecCorpus.timeDuration.type,
    rebuild: () => T.timeDuration(),
  },
  {
    kind: "timestamp",
    original: codecCorpus.timestamp.type,
    rebuild: () => T.timestamp(),
  },
  { kind: "u8", original: codecCorpus.u8.type, rebuild: () => T.u8() },
  { kind: "u16", original: codecCorpus.u16.type, rebuild: () => T.u16() },
  { kind: "u32", original: codecCorpus.u32.type, rebuild: () => T.u32() },
  { kind: "u64", original: codecCorpus.u64.type, rebuild: () => T.u64() },
  { kind: "u128", original: codecCorpus.u128.type, rebuild: () => T.u128() },
  { kind: "u256", original: codecCorpus.u256.type, rebuild: () => T.u256() },
  { kind: "unit", original: codecCorpus.unit.type, rebuild: () => T.unit() },
  { kind: "uuid", original: codecCorpus.uuid.type, rebuild: () => T.uuid() },
]

const fingerprintOf = (type: StdbTesting.ContractType.AnyValueType): string =>
  T.satsTypeFingerprint(type)

const pairKey = (
  left: StdbTesting.ContractType.TypeKind,
  right: StdbTesting.ContractType.TypeKind,
): string => [left, right].sort().join("/")

const allowedCorpusAliases = new Set([
  "bigint/custom",
  "bigint/string",
  "custom/string",
])

const nameKinds = ["Struct", "Enum", "Sum"] as const

const primitiveFingerprintCases: ReadonlyArray<
  readonly [string, StdbTesting.ContractType.AnyValueType, string]
> = [
  ["bigint", T.bigint(), "t9:primitives6:String"],
  ["bool", T.bool(), "t9:primitives4:Bool"],
  ["bytes", T.bytes(), "t5:arrays17:t9:primitives2:U8"],
  ["connectionId", T.connectionId(), "t9:primitives12:ConnectionId"],
  ["f32", T.f32(), "t9:primitives3:F32"],
  ["f64", T.f64(), "t9:primitives3:F64"],
  ["identity", T.identity(), "t9:primitives8:Identity"],
  ["i8", T.i8(), "t9:primitives2:I8"],
  ["i16", T.i16(), "t9:primitives3:I16"],
  ["i32", T.i32(), "t9:primitives3:I32"],
  ["i64", T.i64(), "t9:primitives3:I64"],
  ["i128", T.i128(), "t9:primitives4:I128"],
  ["i256", T.i256(), "t9:primitives4:I256"],
  ["scheduleAt", T.scheduleAt(), "t9:primitives10:ScheduleAt"],
  ["string", T.string(), "t9:primitives6:String"],
  ["timeDuration", T.timeDuration(), "t9:primitives12:TimeDuration"],
  ["timestamp", T.timestamp(), "t9:primitives9:Timestamp"],
  ["u8", T.u8(), "t9:primitives2:U8"],
  ["u16", T.u16(), "t9:primitives3:U16"],
  ["u32", T.u32(), "t9:primitives3:U32"],
  ["u64", T.u64(), "t9:primitives3:U64"],
  ["u128", T.u128(), "t9:primitives4:U128"],
  ["u256", T.u256(), "t9:primitives4:U256"],
  ["unit", T.unit(), "t9:primitives4:Unit"],
  ["uuid", T.uuid(), "t9:primitives4:Uuid"],
]

describe("type fingerprint laws", () => {
  it("pins primitive kind SATS fingerprints", () => {
    for (const [kind, type, expected] of primitiveFingerprintCases) {
      expect(fingerprintOf(type), kind).toBe(expected)
    }
  })

  it("pins composite SATS fingerprint structure", () => {
    expect(fingerprintOf(T.option(T.u32()))).toBe(
      "t6:options18:t9:primitives3:U32",
    )
    expect(fingerprintOf(T.result(T.unit(), T.string()))).toBe(
      "t3:suma2[a2[s2:oks19:t9:primitives4:Unit]a2[s3:errs21:t9:primitives6:String]]",
    )
    expect(fingerprintOf(T.sum({ A: T.unit(), B: T.u8() }))).toBe(
      "t3:suma2[a2[s1:As19:t9:primitives4:Unit]a2[s1:Bs17:t9:primitives2:U8]]",
    )
    expect(
      fingerprintOf(
        T.struct({
          id: T.string(),
          count: T.u32(),
        }),
      ),
    ).toBe(
      "t7:producta2[a2[s2:ids21:t9:primitives6:String]a2[s5:counts18:t9:primitives3:U32]]",
    )
    expect(fingerprintOf(makeTreeType())).toBe(
      "t7:producta2[a2[s4:names21:t9:primitives6:String]a2[s8:childrens29:t5:arrays17:t9:recursives2:r0]]",
    )
  })

  it("is deterministic for rebuilt corpus types", () => {
    for (const { kind, original, rebuild } of typeFactories) {
      expect(fingerprintOf(rebuild()), kind).toBe(fingerprintOf(original))
      expect(fingerprintOf(original), kind).toBe(fingerprintOf(original))
    }
  })

  it("distinguishes structurally distinct corpus types while allowing known aliases", () => {
    const fingerprints = typeFactories.map(({ kind, original }) => ({
      kind,
      fingerprint: fingerprintOf(original),
    }))

    for (let leftIndex = 0; leftIndex < fingerprints.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < fingerprints.length;
        rightIndex += 1
      ) {
        const left = fingerprints[leftIndex]!
        const right = fingerprints[rightIndex]!
        const key = pairKey(left.kind, right.kind)

        if (allowedCorpusAliases.has(key)) {
          expect(left.fingerprint, key).toBe(right.fingerprint)
        } else {
          expect(left.fingerprint, key).not.toBe(right.fingerprint)
        }
      }
    }

    expect(fingerprintOf(T.array(T.u8()))).toBe(fingerprintOf(T.bytes()))
  })

  it.prop(
    "formats stable digest and decimal suffix outputs",
    [FastCheck.string({ maxLength: 128 })],
    ([fingerprint]) => {
      const digest = TypeName.stableStructuralDigest(fingerprint)

      expect(digest).toMatch(/^[0-9a-f]{32}$/)
      expect(TypeName.decimalDigestSuffix(digest)).toMatch(/^[0-9]{40}$/)
    },
    fingerprintPropertyOptions,
  )

  it("raises on content-addressed name digest collisions only for distinct fingerprints", () => {
    const stringFingerprint = fingerprintOf(T.string())
    const u8Fingerprint = fingerprintOf(T.u8())

    expect(stringFingerprint).not.toBe(u8Fingerprint)

    expect(() => {
      const factory = TypeName.makeContentAddressedNameFactory(() =>
        "0".repeat(32),
      )
      factory("Struct", stringFingerprint)
      factory("Struct", u8Fingerprint)
    }).toThrow(TypeName.SatsTypeNameCollisionError)

    expect(() => {
      const factory = TypeName.makeContentAddressedNameFactory()
      factory("Struct", stringFingerprint)
      factory("Struct", u8Fingerprint)
    }).not.toThrow()
  })

  it.prop(
    "contentAddressedName is deterministic for kind and fingerprint",
    [
      FastCheck.constantFrom(...nameKinds),
      FastCheck.constantFrom(
        ...typeFactories.map(({ original }) => fingerprintOf(original)),
      ),
    ],
    ([kind, fingerprint]) => {
      expect(TypeName.contentAddressedName(kind, fingerprint)).toBe(
        TypeName.contentAddressedName(kind, fingerprint),
      )
    },
    fingerprintPropertyOptions,
  )
})
