// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - interop tests intentionally exercise raw STDB schema constructors

import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import { Timestamp } from "spacetimedb"

const { expect } = EffectVitest

import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, UserId, UserName } from "../fixtures/full-module"
import { TreeType } from "../fixtures/recursive-types"
import { TestLayer } from "../helpers/test-layer"

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
      const StringType = StdbTesting.ContractType.string(HostName)
      const StatusType = StdbTesting.ContractType.literal("joined", "left")
      const CountFromString = StdbTesting.ContractType.custom(
        Schema.FiniteFromString,
        {
          type: StdbTesting.ContractType.string(),
        },
      )
      const LazyStruct = StdbTesting.ContractType.lazy(() =>
        StdbTesting.ContractType.struct({
          label: StdbTesting.ContractType.string(),
        }),
      )
      const OptionalStruct = StdbTesting.ContractType.struct({
        id: StringType,
        nickname: StdbTesting.ContractType.optional(
          StdbTesting.ContractType.string(),
        ),
        note: StdbTesting.ContractType.option(
          StdbTesting.ContractType.string(),
        ),
      })
      const ResultType = StdbTesting.ContractType.result(
        StdbTesting.ContractType.string(),
        StdbTesting.ContractType.string(),
      )
      const SumType = StdbTesting.ContractType.sum({
        Active: StdbTesting.ContractType.string(),
        Deleted: StdbTesting.ContractType.unit(),
      })

      expect(StdbTesting.encodeHostValue(StringType, "Ada")).toBe("Ada")
      expect(StdbTesting.encodeHostValue(StatusType, "joined")).toEqual({
        tag: "joined",
      })
      expect(StdbTesting.encodeHostValue(CountFromString, 42)).toBe("42")
      expect(
        StdbTesting.encodeHostValue(
          StdbTesting.ContractType.array(StringType),
          ["Ada", "Grace"],
        ),
      ).toEqual(["Ada", "Grace"])
      expect(
        StdbTesting.encodeHostValue(
          StdbTesting.ContractType.option(StringType),
          undefined,
        ),
      ).toBeUndefined()
      expect(
        StdbTesting.encodeHostValue(
          StdbTesting.ContractType.option(StringType),
          "Ada",
        ),
      ).toBe("Ada")
      expect(
        StdbTesting.encodeHostValue(LazyStruct, { label: "nested" }),
      ).toEqual({ label: "nested" })

      const absentOptional = StdbTesting.encodeHostValue(OptionalStruct, {
        id: "user-1",
      })
      expect(absentOptional).toEqual({ id: "user-1" })
      expect(Object.hasOwn(absentOptional as object, "nickname")).toBe(false)
      expect(Object.hasOwn(absentOptional as object, "note")).toBe(false)

      const presentUndefined = StdbTesting.encodeHostValue(OptionalStruct, {
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
        StdbTesting.encodeHostValue(ResultType, { ok: "accepted" }),
      ).toEqual({
        ok: "accepted",
      })
      expect(
        StdbTesting.encodeHostValue(ResultType, {
          tag: "ok",
          value: "accepted",
        }),
      ).toEqual({
        ok: "accepted",
      })
      expect(
        StdbTesting.encodeHostValue(ResultType, {
          tag: "err",
          value: "rejected",
        }),
      ).toEqual({
        err: "rejected",
      })
      expect(
        StdbTesting.encodeHostValue(SumType, SumType.make.Active("on")),
      ).toEqual({
        tag: "Active",
        value: "on",
      })
      expect(
        StdbTesting.encodeHostValue(SumType, SumType.make.Deleted),
      ).toEqual({
        tag: "Deleted",
      })
    }),
  )

  it.effect(
    "round-trips host JS forms through the DB codec where that representation is accepted",
    () =>
      Effect.gen(function* () {
        const HostName = StdbTesting.ContractType.string(UserName)
        const RequiredStruct = StdbTesting.ContractType.struct({
          id: StdbTesting.ContractType.string(UserId),
          count: StdbTesting.ContractType.u32(),
        })
        const OptionalStruct = StdbTesting.ContractType.struct({
          id: StdbTesting.ContractType.string(UserId),
          nickname: StdbTesting.ContractType.optional(HostName),
        })
        const SumType = StdbTesting.ContractType.sum({
          Active: HostName,
          Deleted: StdbTesting.ContractType.unit(),
        })
        const TimestampType = StdbTesting.ContractType.timestamp()
        const fullModuleUser = FullModule.tables.user.row
        const adaName = Schema.decodeUnknownSync(UserName)("Ada")
        const graceName = Schema.decodeUnknownSync(UserName)("Grace")

        const corpus: ReadonlyArray<{
          readonly name: string
          readonly type: StdbTesting.ContractType.AnyValueType
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
            type: StdbTesting.ContractType.option(HostName),
            value: adaName,
          },
          {
            name: "none option",
            type: StdbTesting.ContractType.option(HostName),
            value: undefined,
          },
          {
            name: "array",
            type: StdbTesting.ContractType.array(HostName),
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
            const host = StdbTesting.encodeHostValue(entry.type, entry.value)
            const decoded = StdbTesting.ContractType.dbCodec(
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
      const ResultType = StdbTesting.ContractType.result(
        StdbTesting.ContractType.string(),
        StdbTesting.ContractType.string(),
      )
      const hostOk = StdbTesting.encodeHostValue(ResultType, {
        ok: "accepted",
      })

      expect(hostOk).toEqual({ ok: "accepted" })
      expect(
        StdbTesting.ContractType.dbCodec(ResultType).decodeUnknownSync(hostOk),
      ).toEqual({ ok: "accepted" })
    }),
  )

  it.effect(
    "characterizes HTTP input preparation for structs and exact option envelopes",
    () =>
      Effect.gen(function* () {
        const Params = StdbTesting.ContractType.struct({
          targetCharacterId: StdbTesting.ContractType.string(),
          reason: StdbTesting.ContractType.option(
            StdbTesting.ContractType.struct({
              displayName: StdbTesting.ContractType.literal("ReadyState"),
            }),
          ),
        })
        const OptionString = StdbTesting.ContractType.option(
          StdbTesting.ContractType.string(),
        )

        expect(
          StdbTesting.ClientHttpJson.prepareHttpInputValue(Params, {
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
          StdbTesting.ClientHttpJson.prepareHttpInputValue(OptionString, {
            some: "kept",
            extra: true,
          }),
        ).toEqual({
          some: "kept",
          extra: true,
        })
        expect(
          StdbTesting.ClientHttpJson.prepareHttpInputValue(OptionString, {
            none: {},
          }),
        ).toEqual({ none: {} })
      }),
  )

  it.effect("characterizes HTTP output normalization edge rules", () =>
    Effect.gen(function* () {
      const OptionU64 = StdbTesting.ContractType.option(
        StdbTesting.ContractType.u64(),
      )
      const ResultType = StdbTesting.ContractType.result(
        StdbTesting.ContractType.u64(),
        StdbTesting.ContractType.string(),
      )
      const SumType = StdbTesting.ContractType.sum({
        Active: StdbTesting.ContractType.u64(),
        Deleted: StdbTesting.ContractType.unit(),
      })
      const Row = StdbTesting.ContractType.struct({
        createdAt: StdbTesting.ContractType.u64(),
      })

      expect(
        yield* StdbTesting.ClientHttpJson.decodeHttpOutput(
          OptionU64,
          "18446744073709551615",
        ),
      ).toBe(18446744073709551615n)
      expect(
        yield* StdbTesting.ClientHttpJson.decodeHttpOutput(
          Row,
          '{"created_at":18446744073709551615}',
        ),
      ).toEqual({
        createdAt: 18446744073709551615n,
      })
      expect(
        yield* StdbTesting.ClientHttpJson.decodeHttpOutput(
          Row,
          '{"createdAt":18446744073709551615}',
        ),
      ).toEqual({
        createdAt: 18446744073709551615n,
      })

      const malformedStruct = yield* Effect.exit(
        StdbTesting.ClientHttpJson.decodeHttpOutput(Row, "123"),
      )
      const resultWithExtra = yield* Effect.exit(
        StdbTesting.ClientHttpJson.decodeHttpOutput(
          ResultType,
          '{"tag":"ok","value":1,"extra":true}',
        ),
      )
      const sumWithExtra = yield* Effect.exit(
        StdbTesting.ClientHttpJson.decodeHttpOutput(
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
      const F64 = StdbTesting.ContractType.f64()
      const ArrayF64 = StdbTesting.ContractType.array(F64)
      const StructF64 = StdbTesting.ContractType.struct({
        x: F64,
      })

      const bareNumber = yield* Effect.exit(
        StdbTesting.ClientHttpJson.decodeHttpOutput(F64, "-"),
      )
      const arrayNumber = yield* Effect.exit(
        StdbTesting.ClientHttpJson.decodeHttpOutput(ArrayF64, "[-]"),
      )
      const structNumber = yield* Effect.exit(
        StdbTesting.ClientHttpJson.decodeHttpOutput(StructF64, '{"x":-}'),
      )

      expect(Exit.isFailure(bareNumber)).toBe(true)
      expect(Exit.isFailure(arrayNumber)).toBe(true)
      expect(Exit.isFailure(structNumber)).toBe(true)
    }),
  )
})
