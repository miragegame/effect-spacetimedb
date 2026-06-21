// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - interop codec corpus intentionally exercises raw primitive constructors.
import * as Schema from "effect/Schema"
import {
  ConnectionId,
  Identity,
  ScheduleAt,
  TimeDuration,
  Timestamp,
  Uuid,
} from "spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TreeType } from "../fixtures/recursive-types"

export type CodecCorpusSample = {
  readonly type: StdbTesting.ContractType.AnyValueType
  readonly value: unknown
}

const T = StdbTesting.ContractType

const SimpleResult = T.result(T.string(), T.string())
const SimpleSum = T.sum({
  named: T.struct({
    label: T.string(),
  }),
  unitCase: T.unit(),
})

export const codecCorpus = {
  array: {
    type: T.array(T.u16()),
    value: [1, 2, 65535],
  },
  bigint: {
    type: T.bigint(),
    value: 9007199254740993n,
  },
  bool: {
    type: T.bool(),
    value: true,
  },
  bytes: {
    type: T.bytes(),
    value: new Uint8Array([0, 1, 255]),
  },
  connectionId: {
    type: T.connectionId(),
    value: new ConnectionId(17n),
  },
  custom: {
    type: T.custom(Schema.String, { type: T.string() }),
    value: "custom-value",
  },
  f32: {
    type: T.f32(),
    value: 1.5,
  },
  f64: {
    type: T.f64(),
    value: 1.25,
  },
  identity: {
    type: T.identity(),
    value: Identity.zero(),
  },
  i8: {
    type: T.i8(),
    value: -12,
  },
  i16: {
    type: T.i16(),
    value: -1234,
  },
  i32: {
    type: T.i32(),
    value: -123456,
  },
  i64: {
    type: T.i64(),
    value: -1234567890123n,
  },
  i128: {
    type: T.i128(),
    value: -12345678901234567890n,
  },
  i256: {
    type: T.i256(),
    value: -123456789012345678901234567890n,
  },
  lazy: {
    type: TreeType,
    value: {
      name: "root",
      children: [
        {
          name: "child",
          children: [],
        },
      ],
    },
  },
  literal: {
    type: T.literal("joined", "left"),
    value: "joined",
  },
  option: {
    type: T.option(T.string()),
    value: "present",
  },
  result: {
    type: SimpleResult,
    value: {
      ok: "accepted",
    },
  },
  scheduleAt: {
    type: T.scheduleAt(),
    value: ScheduleAt.interval(10n),
  },
  string: {
    type: T.string(),
    value: "Ada",
  },
  struct: {
    type: T.struct({
      id: T.string(),
      count: T.u32(),
    }),
    value: {
      id: "row-1",
      count: 42,
    },
  },
  sum: {
    type: SimpleSum,
    value: SimpleSum.make.named({
      label: "value",
    }),
  },
  timeDuration: {
    type: T.timeDuration(),
    value: TimeDuration.fromMillis(5),
  },
  timestamp: {
    type: T.timestamp(),
    value: new Timestamp(123n),
  },
  u8: {
    type: T.u8(),
    value: 255,
  },
  u16: {
    type: T.u16(),
    value: 65535,
  },
  u32: {
    type: T.u32(),
    value: 4294967295,
  },
  u64: {
    type: T.u64(),
    value: 18446744073709551615n,
  },
  u128: {
    type: T.u128(),
    value: 340282366920938463463374607431768211455n,
  },
  u256: {
    type: T.u256(),
    value:
      115792089237316195423570985008687907853269984665640564039457584007913129639935n,
  },
  unit: {
    type: T.unit(),
    value: undefined,
  },
  uuid: {
    type: T.uuid(),
    value: new Uuid(18n),
  },
} satisfies Record<StdbTesting.ContractType.TypeKind, CodecCorpusSample>

export const codecCorpusEntries = Object.entries(codecCorpus) as ReadonlyArray<
  readonly [StdbTesting.ContractType.TypeKind, CodecCorpusSample]
>
