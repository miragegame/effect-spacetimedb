import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Timestamp } from "spacetimedb"

const { expect } = EffectVitest

import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { FullModule, UserId, UserName } from "../fixtures/full-module"
import { TreeType } from "../fixtures/recursive-types"
import { TestLayer } from "../helpers/test-layer"
import { testArrayLength } from "../helpers/array-bounds"

const describe = EffectVitest.layer(TestLayer)

const withoutUndefinedFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(withoutUndefinedFields)
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, withoutUndefinedFields(entry)]),
    )
  }

  return value
}

const expectValueEquivalent = (actual: unknown, expected: unknown): void => {
  expect(withoutUndefinedFields(actual)).toEqual(
    withoutUndefinedFields(expected),
  )
}

describe("effect-spacetimedb value representations", (it) => {
  it.effect("pins host JS shapes per descriptor kind", () =>
    Effect.gen(function* () {
      const HostName = Schema.String.pipe(Schema.brand("HostName"))
      const StringType = StdbInternal.ContractType.string(HostName)
      const StatusType = StdbInternal.ContractType.literal("joined", "left")
      const CountFromString = StdbInternal.ContractType.custom(
        Schema.FiniteFromString,
        {
          type: StdbInternal.ContractType.string(),
        },
      )
      const LazyStruct = StdbInternal.ContractType.lazy(() =>
        StdbInternal.ContractType.struct({
          label: StdbInternal.ContractType.string(),
        }),
      )
      const OptionalStruct = StdbInternal.ContractType.struct({
        id: StringType,
        nickname: StdbInternal.ContractType.optional(
          StdbInternal.ContractType.string(),
        ),
        note: StdbInternal.ContractType.option(
          StdbInternal.ContractType.string(),
        ),
      })
      const ResultType = StdbInternal.ContractType.result(
        StdbInternal.ContractType.string(),
        StdbInternal.ContractType.string(),
      )
      const SumType = StdbInternal.ContractType.sum({
        Active: StdbInternal.ContractType.string(),
        Deleted: StdbInternal.ContractType.unit(),
      })

      expect(StdbInternal.encodeHostValue(StringType, "Ada")).toBe("Ada")
      expect(StdbInternal.encodeHostValue(StatusType, "joined")).toEqual({
        tag: "joined",
      })
      expect(StdbInternal.encodeHostValue(CountFromString, 42)).toBe("42")
      expect(
        StdbInternal.encodeHostValue(
          StdbInternal.ContractType.array(StringType, testArrayLength),
          ["Ada", "Grace"],
        ),
      ).toEqual(["Ada", "Grace"])
      expect(
        StdbInternal.encodeHostValue(
          StdbInternal.ContractType.option(StringType),
          undefined,
        ),
      ).toBeUndefined()
      expect(
        StdbInternal.encodeHostValue(
          StdbInternal.ContractType.option(StringType),
          "Ada",
        ),
      ).toBe("Ada")
      expect(
        StdbInternal.encodeHostValue(LazyStruct, { label: "nested" }),
      ).toEqual({ label: "nested" })

      const absentOptional = StdbInternal.encodeHostValue(OptionalStruct, {
        id: "user-1",
      })
      expect(absentOptional).toEqual({ id: "user-1" })
      expect(Object.hasOwn(absentOptional as object, "nickname")).toBe(false)
      expect(Object.hasOwn(absentOptional as object, "note")).toBe(false)

      const presentUndefined = StdbInternal.encodeHostValue(OptionalStruct, {
        id: "user-1",
        nickname: undefined,
        note: undefined,
      })
      expect(presentUndefined).toEqual({
        id: "user-1",
        nickname: undefined,
        note: undefined,
      })

      expect(
        StdbInternal.encodeHostValue(ResultType, { ok: "accepted" }),
      ).toEqual({
        ok: "accepted",
      })
      expect(
        StdbInternal.encodeHostValue(ResultType, {
          tag: "ok",
          value: "accepted",
        }),
      ).toEqual({
        ok: "accepted",
      })
      expect(
        StdbInternal.encodeHostValue(ResultType, {
          tag: "err",
          value: "rejected",
        }),
      ).toEqual({
        err: "rejected",
      })
      expect(
        StdbInternal.encodeHostValue(SumType, SumType.make.Active("on")),
      ).toEqual({
        tag: "Active",
        value: "on",
      })
      expect(
        StdbInternal.encodeHostValue(SumType, SumType.make.Deleted),
      ).toEqual({
        tag: "Deleted",
      })
    }),
  )

  it.effect(
    "round-trips host JS forms through the DB codec where that representation is accepted",
    () =>
      Effect.gen(function* () {
        const HostName = StdbInternal.ContractType.string(UserName)
        const RequiredStruct = StdbInternal.ContractType.struct({
          id: StdbInternal.ContractType.string(UserId),
          count: StdbInternal.ContractType.u32(),
        })
        const OptionalStruct = StdbInternal.ContractType.struct({
          id: StdbInternal.ContractType.string(UserId),
          nickname: StdbInternal.ContractType.optional(HostName),
        })
        const SumType = StdbInternal.ContractType.sum({
          Active: HostName,
          Deleted: StdbInternal.ContractType.unit(),
        })
        const TimestampType = StdbInternal.ContractType.timestamp()
        const fullModuleUser = FullModule.tables.user.row
        const adaName = Schema.decodeUnknownSync(UserName)("Ada")
        const graceName = Schema.decodeUnknownSync(UserName)("Grace")

        const corpus: ReadonlyArray<{
          readonly name: string
          readonly type: StdbInternal.ContractType.AnyValueType
          readonly value: unknown
          readonly expected?: unknown
        }> = [
          {
            name: "branded primitive",
            type: HostName,
            value: adaName,
          },
          {
            name: "required struct",
            type: RequiredStruct,
            value: { id: "user-1", count: 3 },
          },
          {
            name: "optional struct field absent",
            type: OptionalStruct,
            value: { id: "user-1" },
          },
          {
            name: "optional struct field present",
            type: OptionalStruct,
            value: { id: "user-1", nickname: adaName },
          },
          {
            name: "optional struct field present undefined",
            type: OptionalStruct,
            value: { id: "user-1", nickname: undefined },
          },
          {
            name: "sum",
            type: SumType,
            value: SumType.make.Active(adaName),
          },
          {
            name: "unit sum",
            type: SumType,
            value: SumType.make.Deleted,
          },
          {
            name: "some option",
            type: StdbInternal.ContractType.option(HostName),
            value: adaName,
          },
          {
            name: "none option",
            type: StdbInternal.ContractType.option(HostName),
            value: undefined,
          },
          {
            name: "array",
            type: StdbInternal.ContractType.array(HostName, testArrayLength),
            value: [adaName, graceName],
          },
          {
            name: "lazy recursive",
            type: TreeType,
            value: {
              name: "root",
              children: [{ name: "leaf", children: [] }],
            },
          },
          {
            name: "native timestamp",
            type: TimestampType,
            value: new Timestamp(123n),
          },
          {
            name: "real FullModule table row",
            type: fullModuleUser,
            value: {
              id: "user-1",
              name: "Ada",
            },
          },
        ]

        yield* Effect.forEach(
          corpus,
          Effect.fn(function* (entry) {
            const host = StdbInternal.encodeHostValue(entry.type, entry.value)
            const decoded = StdbInternal.ContractType.dbCodec(
              entry.type,
            ).decodeUnknownSync(host)

            expectValueEquivalent(
              decoded,
              Object.hasOwn(entry, "expected") ? entry.expected : entry.value,
            )
          }),
        )
      }),
  )

  it.effect("decodes Result host envelopes through the DB codec", () =>
    Effect.gen(function* () {
      const ResultType = StdbInternal.ContractType.result(
        StdbInternal.ContractType.string(),
        StdbInternal.ContractType.string(),
      )
      const hostOk = StdbInternal.encodeHostValue(ResultType, {
        ok: "accepted",
      })

      expect(hostOk).toEqual({ ok: "accepted" })
      expect(
        StdbInternal.ContractType.dbCodec(ResultType).decodeUnknownSync(hostOk),
      ).toEqual({ ok: "accepted" })
    }),
  )

  it.effect(
    "characterizes HTTP input preparation for structs and exact option envelopes",
    () =>
      Effect.gen(function* () {
        const Params = StdbInternal.ContractType.struct({
          targetCharacterId: StdbInternal.ContractType.string(),
          reason: StdbInternal.ContractType.option(
            StdbInternal.ContractType.struct({
              displayName: StdbInternal.ContractType.literal("ReadyState"),
            }),
          ),
        })
        const OptionString = StdbInternal.ContractType.option(
          StdbInternal.ContractType.string(),
        )

        expect(
          StdbInternal.ClientHttpJson.prepareHttpInputValue(Params, {
            targetCharacterId: "character-1",
            reason: {
              some: {
                displayName: { tag: "ReadyState" },
                ignoredNested: true,
              },
            },
            ignoredTopLevel: true,
          }),
        ).toEqual({
          target_character_id: "character-1",
          reason: {
            some: {
              display_name: {
                ReadyState: {},
              },
            },
          },
        })
        expect(
          StdbInternal.ClientHttpJson.prepareHttpInputValue(OptionString, {
            some: "kept",
            extra: true,
          }),
        ).toEqual({
          some: "kept",
          extra: true,
        })
        expect(
          StdbInternal.ClientHttpJson.prepareHttpInputValue(OptionString, {
            none: {},
          }),
        ).toEqual({ none: {} })
      }),
  )

  it.effect("characterizes HTTP output normalization edge rules", () =>
    Effect.gen(function* () {
      const OptionU64 = StdbInternal.ContractType.option(
        StdbInternal.ContractType.u64(),
      )
      const ResultType = StdbInternal.ContractType.result(
        StdbInternal.ContractType.u64(),
        StdbInternal.ContractType.string(),
      )
      const SumType = StdbInternal.ContractType.sum({
        Active: StdbInternal.ContractType.u64(),
        Deleted: StdbInternal.ContractType.unit(),
      })
      const Row = StdbInternal.ContractType.struct({
        createdAt: StdbInternal.ContractType.u64(),
      })

      expect(
        yield* StdbInternal.ClientHttpJson.decodeHttpOutput(
          OptionU64,
          "18446744073709551615",
        ),
      ).toBe(18446744073709551615n)
      expect(
        yield* StdbInternal.ClientHttpJson.decodeHttpOutput(
          Row,
          '{"created_at":18446744073709551615}',
        ),
      ).toEqual({
        createdAt: 18446744073709551615n,
      })
      expect(
        yield* StdbInternal.ClientHttpJson.decodeHttpOutput(
          Row,
          '{"createdAt":18446744073709551615}',
        ),
      ).toEqual({
        createdAt: 18446744073709551615n,
      })

      const malformedStruct = yield* Effect.exit(
        StdbInternal.ClientHttpJson.decodeHttpOutput(Row, "123"),
      )
      const resultWithExtra = yield* Effect.exit(
        StdbInternal.ClientHttpJson.decodeHttpOutput(
          ResultType,
          '{"tag":"ok","value":1,"extra":true}',
        ),
      )
      const sumWithExtra = yield* Effect.exit(
        StdbInternal.ClientHttpJson.decodeHttpOutput(
          SumType,
          '{"tag":"Active","value":1,"extra":true}',
        ),
      )

      expect(Exit.isFailure(malformedStruct)).toBe(true)
      expect(Exit.isFailure(resultWithExtra)).toBe(true)
      expect(Exit.isFailure(sumWithExtra)).toBe(true)
    }),
  )

  it.effect("rejects malformed JSON number tokens before value decoding", () =>
    Effect.gen(function* () {
      const F64 = StdbInternal.ContractType.f64()
      const ArrayF64 = StdbInternal.ContractType.array(F64, testArrayLength)
      const StructF64 = StdbInternal.ContractType.struct({
        x: F64,
      })

      const bareNumber = yield* Effect.exit(
        StdbInternal.ClientHttpJson.decodeHttpOutput(F64, "-"),
      )
      const arrayNumber = yield* Effect.exit(
        StdbInternal.ClientHttpJson.decodeHttpOutput(ArrayF64, "[-]"),
      )
      const structNumber = yield* Effect.exit(
        StdbInternal.ClientHttpJson.decodeHttpOutput(StructF64, '{"x":-}'),
      )

      expect(Exit.isFailure(bareNumber)).toBe(true)
      expect(Exit.isFailure(arrayNumber)).toBe(true)
      expect(Exit.isFailure(structNumber)).toBe(true)
    }),
  )

  // The native value constructors reject anything that is not a bigint, an
  // integer number or a non-blank numeric string, and they signal it by
  // throwing. Every one of those inputs is reachable from a hostile or merely
  // broken HTTP body, so the boundary owes the caller a typed decode failure
  // rather than a defect.
  it.effect("fails typed on malformed native values in an HTTP body", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly type: StdbInternal.ContractType.AnyValueType
        readonly body: string
      }> = [
        {
          type: StdbInternal.ContractType.identity(),
          body: '{"__identity__":""}',
        },
        {
          type: StdbInternal.ContractType.identity(),
          body: '{"__identity__":"not-hex"}',
        },
        {
          type: StdbInternal.ContractType.identity(),
          body: '{"__identity__":true}',
        },
        {
          type: StdbInternal.ContractType.identity(),
          body: '{"__identity__":[42]}',
        },
        {
          type: StdbInternal.ContractType.identity(),
          body: '{"__identity__":null}',
        },
        {
          type: StdbInternal.ContractType.connectionId(),
          body: '{"__connection_id__":""}',
        },
        {
          type: StdbInternal.ContractType.connectionId(),
          body: '{"__connection_id__":true}',
        },
        {
          type: StdbInternal.ContractType.uuid(),
          body: '{"__uuid__":"not-a-uuid"}',
        },
        { type: StdbInternal.ContractType.uuid(), body: '{"__uuid__":[42]}' },
        {
          type: StdbInternal.ContractType.timestamp(),
          body: '{"__timestamp_micros_since_unix_epoch__":true}',
        },
        {
          type: StdbInternal.ContractType.timestamp(),
          body: '{"__timestamp_micros_since_unix_epoch__":""}',
        },
        {
          type: StdbInternal.ContractType.timeDuration(),
          body: '{"__time_duration_micros__":[42]}',
        },
        {
          type: StdbInternal.ContractType.timeDuration(),
          body: '{"__time_duration_micros__":null}',
        },
      ]

      yield* Effect.forEach(
        cases,
        Effect.fn(function* ({ type, body }) {
          const exit = yield* Effect.exit(
            StdbInternal.ClientHttpJson.decodeHttpOutput(type, body),
          )

          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(Cause.hasDies(exit.cause)).toBe(false)
            expect(
              Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
            ).toBeInstanceOf(StdbInternal.StdbDecodeError)
          }
        }),
        { concurrency: 1 },
      )
    }),
  )
})
