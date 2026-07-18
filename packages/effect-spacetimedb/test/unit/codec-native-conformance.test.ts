import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/Encoding"
import * as Schema from "effect/Schema"
import * as StdbTesting from "effect-spacetimedb/testing"
import {
  ConnectionId,
  Identity,
  ScheduleAt,
  TimeDuration,
  Timestamp,
  Uuid,
} from "spacetimedb"
import { TreeType } from "../fixtures/recursive-types"
import { nativeBytes, nativeRoundTrip } from "../helpers/native-serializer"
import { TestLayer } from "../helpers/test-layer"
import { corpusArbitraries } from "../helpers/value-type-arbitrary"

const { expect } = EffectVitest

const nativePropertyOptions = {
  fastCheck: { numRuns: 100, seed: 0xb5a7c0de },
} as const

const T = StdbTesting.ContractType

const I64Min = -(1n << 63n)
const I64Max = (1n << 63n) - 1n
const I128Min = -(1n << 127n)
const I128Max = (1n << 127n) - 1n
const I256Min = -(1n << 255n)
const I256Max = (1n << 255n) - 1n
const U64Max = (1n << 64n) - 1n
const U128Max = (1n << 128n) - 1n
const U256Max = (1n << 256n) - 1n

const StructGolden = T.struct({
  id: T.string(),
  count: T.u32(),
})

const SumGolden = T.sum({
  named: T.struct({
    label: T.string(),
  }),
  unitCase: T.unit(),
})
const ResultGolden = T.result(T.string(), T.string())

type GoldenCase = {
  readonly name: string
  readonly type: StdbTesting.ContractType.AnyValueType
  readonly value: unknown
  readonly hex: string
}

// Re-derived from spacetimedb@2.6.1's patched native serializer. The generated-value
// native properties above fuzz consistency through the pinned serializer; this
// table pins intentional wire-format anchors.
//
// To regenerate after an intentional serializer bump, temporarily print:
// `bytesToHex(nativeBytes(type, yield* ClientValueCodec.db.encode(type, value)))`
// for each case below and update the expected hex strings in the same commit.
const goldenCases: ReadonlyArray<GoldenCase> = [
  { name: "bool false", type: T.bool(), value: false, hex: "00" },
  { name: "bool true", type: T.bool(), value: true, hex: "01" },
  { name: "string empty", type: T.string(), value: "", hex: "00000000" },
  {
    name: "string unicode",
    type: T.string(),
    value: "Codec ✓",
    hex: "09000000436f64656320e29c93",
  },
  {
    name: "bytes empty",
    type: T.bytes(),
    value: new Uint8Array([]),
    hex: "00000000",
  },
  {
    name: "bytes 00 01 ff",
    type: T.bytes(),
    value: new Uint8Array([0, 1, 255]),
    hex: "030000000001ff",
  },
  {
    name: "array u16",
    type: T.array(T.u16()),
    value: [1, 2, 65535],
    hex: "0300000001000200ffff",
  },
  {
    name: "bigint string",
    type: T.bigint(),
    value: 9007199254740993n,
    hex: "1000000039303037313939323534373430393933",
  },
  {
    name: "custom string",
    type: T.custom(Schema.String, { type: T.string() }),
    value: "custom-value",
    hex: "0c000000637573746f6d2d76616c7565",
  },
  {
    name: "literal joined",
    type: T.literal("joined", "left"),
    value: "joined",
    hex: "00",
  },
  {
    name: "option some",
    type: T.option(T.string()),
    value: "present",
    hex: "000700000070726573656e74",
  },
  {
    name: "option none",
    type: T.option(T.string()),
    value: undefined,
    hex: "01",
  },
  {
    name: "result ok",
    type: ResultGolden,
    value: { ok: "accepted" },
    hex: "00080000006163636570746564",
  },
  {
    name: "result err",
    type: ResultGolden,
    value: { err: "rejected" },
    hex: "010800000072656a6563746564",
  },
  { name: "f32 1.5", type: T.f32(), value: 1.5, hex: "0000c03f" },
  { name: "f64 1.25", type: T.f64(), value: 1.25, hex: "000000000000f43f" },
  { name: "i8 min", type: T.i8(), value: -128, hex: "80" },
  { name: "i8 -1", type: T.i8(), value: -1, hex: "ff" },
  { name: "i8 0", type: T.i8(), value: 0, hex: "00" },
  { name: "i8 1", type: T.i8(), value: 1, hex: "01" },
  { name: "i8 max", type: T.i8(), value: 127, hex: "7f" },
  { name: "i16 min", type: T.i16(), value: -32768, hex: "0080" },
  { name: "i16 -1", type: T.i16(), value: -1, hex: "ffff" },
  { name: "i16 0", type: T.i16(), value: 0, hex: "0000" },
  { name: "i16 1", type: T.i16(), value: 1, hex: "0100" },
  { name: "i16 max", type: T.i16(), value: 32767, hex: "ff7f" },
  { name: "i32 min", type: T.i32(), value: -(2 ** 31), hex: "00000080" },
  { name: "i32 -1", type: T.i32(), value: -1, hex: "ffffffff" },
  { name: "i32 0", type: T.i32(), value: 0, hex: "00000000" },
  { name: "i32 1", type: T.i32(), value: 1, hex: "01000000" },
  { name: "i32 max", type: T.i32(), value: 2 ** 31 - 1, hex: "ffffff7f" },
  {
    name: "i64 min",
    type: T.i64(),
    value: I64Min,
    hex: "0000000000000080",
  },
  { name: "i64 -1", type: T.i64(), value: -1n, hex: "ffffffffffffffff" },
  { name: "i64 0", type: T.i64(), value: 0n, hex: "0000000000000000" },
  { name: "i64 1", type: T.i64(), value: 1n, hex: "0100000000000000" },
  {
    name: "i64 max",
    type: T.i64(),
    value: I64Max,
    hex: "ffffffffffffff7f",
  },
  {
    name: "i128 min",
    type: T.i128(),
    value: I128Min,
    hex: "00000000000000000000000000000080",
  },
  {
    name: "i128 -1",
    type: T.i128(),
    value: -1n,
    hex: "ffffffffffffffffffffffffffffffff",
  },
  {
    name: "i128 0",
    type: T.i128(),
    value: 0n,
    hex: "00000000000000000000000000000000",
  },
  {
    name: "i128 1",
    type: T.i128(),
    value: 1n,
    hex: "01000000000000000000000000000000",
  },
  {
    name: "i128 max",
    type: T.i128(),
    value: I128Max,
    hex: "ffffffffffffffffffffffffffffff7f",
  },
  {
    name: "i256 min",
    type: T.i256(),
    value: I256Min,
    hex: "0000000000000000000000000000000000000000000000000000000000000080",
  },
  {
    name: "i256 -1",
    type: T.i256(),
    value: -1n,
    hex: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  },
  {
    name: "i256 0",
    type: T.i256(),
    value: 0n,
    hex: "0000000000000000000000000000000000000000000000000000000000000000",
  },
  {
    name: "i256 1",
    type: T.i256(),
    value: 1n,
    hex: "0100000000000000000000000000000000000000000000000000000000000000",
  },
  {
    name: "i256 max",
    type: T.i256(),
    value: I256Max,
    hex: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  },
  { name: "u8 0", type: T.u8(), value: 0, hex: "00" },
  { name: "u8 1", type: T.u8(), value: 1, hex: "01" },
  { name: "u8 max", type: T.u8(), value: 255, hex: "ff" },
  { name: "u16 0", type: T.u16(), value: 0, hex: "0000" },
  { name: "u16 1", type: T.u16(), value: 1, hex: "0100" },
  { name: "u16 max", type: T.u16(), value: 65535, hex: "ffff" },
  { name: "u32 0", type: T.u32(), value: 0, hex: "00000000" },
  { name: "u32 1", type: T.u32(), value: 1, hex: "01000000" },
  { name: "u32 max", type: T.u32(), value: 0xffffffff, hex: "ffffffff" },
  { name: "u64 0", type: T.u64(), value: 0n, hex: "0000000000000000" },
  { name: "u64 1", type: T.u64(), value: 1n, hex: "0100000000000000" },
  {
    name: "u64 max",
    type: T.u64(),
    value: U64Max,
    hex: "ffffffffffffffff",
  },
  {
    name: "u128 0",
    type: T.u128(),
    value: 0n,
    hex: "00000000000000000000000000000000",
  },
  {
    name: "u128 1",
    type: T.u128(),
    value: 1n,
    hex: "01000000000000000000000000000000",
  },
  {
    name: "u128 max",
    type: T.u128(),
    value: U128Max,
    hex: "ffffffffffffffffffffffffffffffff",
  },
  {
    name: "u256 0",
    type: T.u256(),
    value: 0n,
    hex: "0000000000000000000000000000000000000000000000000000000000000000",
  },
  {
    name: "u256 1",
    type: T.u256(),
    value: 1n,
    hex: "0100000000000000000000000000000000000000000000000000000000000000",
  },
  {
    name: "u256 max",
    type: T.u256(),
    value: U256Max,
    hex: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  },
  {
    name: "identity zero",
    type: T.identity(),
    value: Identity.zero(),
    hex: "0000000000000000000000000000000000000000000000000000000000000000",
  },
  {
    name: "connectionId 17",
    type: T.connectionId(),
    value: new ConnectionId(17n),
    hex: "11000000000000000000000000000000",
  },
  {
    name: "timestamp 123",
    type: T.timestamp(),
    value: new Timestamp(123n),
    hex: "7b00000000000000",
  },
  {
    name: "timeDuration 5ms",
    type: T.timeDuration(),
    value: TimeDuration.fromMillis(5),
    hex: "8813000000000000",
  },
  {
    name: "scheduleAt interval",
    type: T.scheduleAt(),
    value: ScheduleAt.interval(10n),
    hex: "000a00000000000000",
  },
  {
    name: "scheduleAt time",
    type: T.scheduleAt(),
    value: ScheduleAt.time(123n),
    hex: "017b00000000000000",
  },
  {
    name: "uuid 18",
    type: T.uuid(),
    value: new Uuid(18n),
    hex: "12000000000000000000000000000000",
  },
  {
    name: "struct row",
    type: StructGolden,
    value: { id: "row-1", count: 42 },
    hex: "05000000726f772d312a000000",
  },
  {
    name: "sum named",
    type: SumGolden,
    value: SumGolden.make.named({ label: "value" }),
    hex: "000500000076616c7565",
  },
  {
    name: "sum unit",
    type: SumGolden,
    value: SumGolden.make.unitCase,
    hex: "01",
  },
  {
    name: "lazy tree",
    type: TreeType,
    value: {
      name: "root",
      children: [{ name: "child", children: [] }],
    },
    hex: "04000000726f6f7401000000050000006368696c6400000000",
  },
]

const bytesToHex = (bytes: Uint8Array): string => Encoding.encodeHex(bytes)

const nativeDbHex = (
  type: StdbTesting.ContractType.AnyValueType,
  value: unknown,
) =>
  StdbTesting.ClientValueCodec.db
    .encode(type, value)
    .pipe(Effect.map((encoded) => bytesToHex(nativeBytes(type, encoded))))

const nativeDifferentialEntries = corpusArbitraries.filter(
  // The native serializer deserializes a top-level unit as `{}`, while the DB
  // codec's authored domain value is `undefined`; container unit values are
  // still covered by result/sum/struct shapes.
  ({ kind }) => kind !== "unit",
)

EffectVitest.layer(TestLayer)("codec native conformance", (it) => {
  for (const { kind, type, valueArbitrary } of nativeDifferentialEntries) {
    it.effect.prop(
      `db native differential - ${kind}`,
      [valueArbitrary],
      ([value]) =>
        Effect.gen(function* () {
          const encoded = yield* StdbTesting.ClientValueCodec.db.encode(
            type,
            value,
          )
          const native = nativeRoundTrip(type, encoded)
          const decoded = yield* StdbTesting.ClientValueCodec.db.decode(
            type,
            native,
          )

          expect(decoded).toEqual(value)
        }),
      nativePropertyOptions,
    )
  }

  it.effect("matches frozen native DB BSATN golden bytes", () =>
    Effect.forEach(
      goldenCases,
      Effect.fn(function* ({ name, type, value, hex }) {
        expect(yield* nativeDbHex(type, value), name).toBe(hex)
      }),
      { discard: true },
    ),
  )
})
