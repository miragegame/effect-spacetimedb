import * as Schema from "effect/Schema"
import * as FastCheck from "effect/testing/FastCheck"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  ConnectionId,
  Identity,
  ScheduleAt,
  TimeDuration,
  Timestamp,
  Uuid,
} from "spacetimedb"
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

const I64Min = -(1n << 63n)
const I64Max = (1n << 63n) - 1n
const U128Max = (1n << 128n) - 1n
const U256Max = (1n << 256n) - 1n

const boundedString = FastCheck.string({ maxLength: 32 })
const i64BigInt = FastCheck.bigInt({ min: I64Min, max: I64Max })
const u128BigInt = FastCheck.bigInt({ min: 0n, max: U128Max })
const u256BigInt = FastCheck.bigInt({ min: 0n, max: U256Max })

const schemaArbitrary = (
  sample: CodecCorpusSample,
): FastCheck.Arbitrary<unknown> => Schema.toArbitrary(sample.type.schema)

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
  array: schemaArbitrary,
  bigint: () => FastCheck.bigInt(),
  bool: schemaArbitrary,
  bytes: schemaArbitrary,
  connectionId: () => u128BigInt.map((n) => new ConnectionId(n)),
  custom: schemaArbitrary,
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
  i8: schemaArbitrary,
  i16: schemaArbitrary,
  i32: schemaArbitrary,
  i64: schemaArbitrary,
  i128: schemaArbitrary,
  i256: schemaArbitrary,
  lazy: () => treeArbitrary(0),
  literal: literalArbitrary,
  option: () => FastCheck.oneof(FastCheck.constant(undefined), boundedString),
  result: () => simpleResultArbitrary,
  scheduleAt: () =>
    FastCheck.oneof(
      i64BigInt.map((n) => ScheduleAt.interval(n)),
      i64BigInt.map((n) => ScheduleAt.time(n)),
    ),
  string: schemaArbitrary,
  struct: () =>
    FastCheck.record({
      id: boundedString,
      count: FastCheck.integer({ min: 0, max: 0xffffffff }),
    }),
  sum: () => simpleSumArbitrary,
  timeDuration: () => i64BigInt.map((n) => new TimeDuration(n)),
  timestamp: () => i64BigInt.map((n) => new Timestamp(n)),
  u8: schemaArbitrary,
  u16: schemaArbitrary,
  u32: schemaArbitrary,
  u64: schemaArbitrary,
  u128: schemaArbitrary,
  u256: schemaArbitrary,
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
