import * as FastCheck from "fast-check"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  ConnectionId,
  Identity,
  ScheduleAt,
  TimeDuration,
  Timestamp,
  Uuid,
} from "spacetimedb"
import {
  I8Max,
  I8Min,
  I16Max,
  I16Min,
  I32Max,
  I32Min,
  I64Max,
  I64Min,
  I128Max,
  I128Min,
  I256Max,
  I256Min,
  U8Max,
  U16Max,
  U32Max,
  U64Max,
  U128Max,
  U256Max,
} from "../../src/contract/type/core.ts"
import { type Tree } from "../fixtures/recursive-types"
import {
  type CodecCorpusSample,
  codecCorpus,
  codecCorpusEntries,
} from "./codec-corpus"

type CorpusArbitrary = {
  readonly kind: StdbTesting.ContractType.TypeKind
  readonly type: StdbTesting.ContractType.AnyValueType
  readonly valueArbitrary: FastCheck.Arbitrary<unknown>
}

const boundedString = FastCheck.string({ maxLength: 32 })

// Effect rc.113 (#7254) deleted `Schema.toArbitrary`, and rc.117's replacement
// `effect/unstable/arbitrary/Arbitrary` is an Effect-native generator with no
// fast-check bridge: it cannot produce the `FastCheck.Arbitrary` every consumer
// of this module needs now that the property suites run on the standalone
// `fast-check` package. The kinds that used to be derived from
// `sample.type.schema` are generated directly below, each against the very
// bounds that value type's schema checks against, imported from the one place
// that defines them, so the generated domain is the same one the codecs accept.
const i8Number = FastCheck.integer({ min: I8Min, max: I8Max })
const i16Number = FastCheck.integer({ min: I16Min, max: I16Max })
const i32Number = FastCheck.integer({ min: I32Min, max: I32Max })
const u8Number = FastCheck.integer({ min: 0, max: U8Max })
const u16Number = FastCheck.integer({ min: 0, max: U16Max })
const u32Number = FastCheck.integer({ min: 0, max: U32Max })

const i64BigInt = FastCheck.bigInt({ min: I64Min, max: I64Max })
const i128BigInt = FastCheck.bigInt({ min: I128Min, max: I128Max })
const i256BigInt = FastCheck.bigInt({ min: I256Min, max: I256Max })
const u64BigInt = FastCheck.bigInt({ min: 0n, max: U64Max })
const u128BigInt = FastCheck.bigInt({ min: 0n, max: U128Max })
const u256BigInt = FastCheck.bigInt({ min: 0n, max: U256Max })

const literalArbitrary = (
  sample: CodecCorpusSample,
): FastCheck.Arbitrary<unknown> => {
  const values = StdbTesting.ContractType.literalValues(sample.type)
  if (values === undefined) {
    throw new Error("Expected corpus literal values")
  }

  return FastCheck.constantFrom(...values)
}

const treeArbitrary = (depth: number): FastCheck.Arbitrary<Tree> =>
  FastCheck.record({
    name: boundedString,
    children:
      depth >= 3
        ? FastCheck.constant([])
        : FastCheck.array(treeArbitrary(depth + 1), { maxLength: 2 }),
  })

const simpleResultArbitrary = FastCheck.oneof(
  FastCheck.record({
    ok: boundedString,
  }),
  FastCheck.record({
    err: boundedString,
  }),
)

const simpleSumArbitrary = FastCheck.oneof(
  FastCheck.record({
    label: boundedString,
  }).map((value) => codecCorpus.sum.type.make.named(value)),
  FastCheck.constant(codecCorpus.sum.type.make.unitCase),
)

const arbitraryByKind = {
  // The corpus array is `T.array(T.u16())`, so its elements carry the u16 bound.
  array: () => FastCheck.array(u16Number),
  bigint: () => FastCheck.bigInt(),
  bool: () => FastCheck.boolean(),
  bytes: () => FastCheck.uint8Array(),
  connectionId: () => u128BigInt.map((n) => new ConnectionId(n)),
  // The corpus custom type lowers `Schema.String` onto a SATS string, so its
  // decoded value is a plain unbounded string.
  custom: () => FastCheck.string(),
  f32: () =>
    FastCheck.oneof(
      FastCheck.float(),
      FastCheck.constantFrom(
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -0,
      ),
    ),
  f64: () =>
    FastCheck.oneof(
      FastCheck.double(),
      FastCheck.constantFrom(
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -0,
      ),
    ),
  identity: () => u256BigInt.map((n) => new Identity(n)),
  i8: () => i8Number,
  i16: () => i16Number,
  i32: () => i32Number,
  i64: () => i64BigInt,
  i128: () => i128BigInt,
  i256: () => i256BigInt,
  lazy: () => treeArbitrary(0),
  literal: literalArbitrary,
  option: () => FastCheck.oneof(FastCheck.constant(undefined), boundedString),
  result: () => simpleResultArbitrary,
  scheduleAt: () =>
    FastCheck.oneof(
      i64BigInt.map((n) => ScheduleAt.interval(n)),
      i64BigInt.map((n) => ScheduleAt.time(n)),
    ),
  string: () => FastCheck.string(),
  struct: () =>
    FastCheck.record({
      id: boundedString,
      count: u32Number,
    }),
  sum: () => simpleSumArbitrary,
  timeDuration: () => i64BigInt.map((n) => new TimeDuration(n)),
  timestamp: () => i64BigInt.map((n) => new Timestamp(n)),
  u8: () => u8Number,
  u16: () => u16Number,
  u32: () => u32Number,
  u64: () => u64BigInt,
  u128: () => u128BigInt,
  u256: () => u256BigInt,
  unit: (sample) => FastCheck.constant(sample.value),
  uuid: () => u128BigInt.map((n) => new Uuid(n)),
} satisfies Record<
  StdbTesting.ContractType.TypeKind,
  (sample: CodecCorpusSample) => FastCheck.Arbitrary<unknown>
>

export const corpusArbitraries: ReadonlyArray<CorpusArbitrary> =
  codecCorpusEntries.map(([kind, sample]) => ({
    kind,
    type: sample.type,
    valueArbitrary: arbitraryByKind[kind](sample),
  }))

export const anyCorpusSample: FastCheck.Arbitrary<{
  readonly kind: StdbTesting.ContractType.TypeKind
  readonly type: StdbTesting.ContractType.AnyValueType
  readonly value: unknown
}> = FastCheck.oneof(
  ...corpusArbitraries.map(({ kind, type, valueArbitrary }) =>
    valueArbitrary.map((value) => ({
      kind,
      type,
      value,
    })),
  ),
)
