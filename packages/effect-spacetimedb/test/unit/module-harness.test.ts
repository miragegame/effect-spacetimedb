import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import {
  StdbHostCallError,
  StdbUniqueAlreadyExistsError,
} from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { Identity, Timestamp } from "spacetimedb"

const { describe, expect, it } = EffectVitest

class ReducerRollbackProbe extends Schema.TaggedErrorClass<ReducerRollbackProbe>()(
  "ReducerRollbackProbe",
  {},
) {}

const record = Stdb.table("record", {
  columns: {
    id: Stdb.u64().primaryKey().autoInc(),
    code: Stdb.string(),
    tenant: Stdb.string(),
    sequence: Stdb.u64(),
  },
  indexes: [
    Stdb.index("byCode", ["code"]),
    Stdb.index("byTenantSequence", ["tenant", "sequence", "id"]),
  ],
  constraints: [Stdb.unique({ name: "recordCode", columns: ["code"] })],
})
const nativeRangeRecord = Stdb.table("nativeRangeRecord", {
  columns: {
    id: Stdb.u64().primaryKey().autoInc(),
    owner: Stdb.identity(),
    happenedAt: Stdb.timestamp(),
  },
  indexes: [
    Stdb.index("byOwner", ["owner"]),
    Stdb.index("byHappenedAt", ["happenedAt"]),
  ],
})
const structuredRangeRecord = Stdb.table("structuredRangeRecord", {
  columns: {
    id: Stdb.u64().primaryKey().autoInc(),
    coordinates: Stdb.struct({ x: Stdb.u64(), y: Stdb.u64() }),
  },
  indexes: [Stdb.index("byCoordinates", ["coordinates"])],
})
const harnessEvent = Stdb.table("harnessEvent", {
  event: true,
  columns: {
    id: Stdb.u64().primaryKey().autoInc(),
    kind: Stdb.literal("emitted"),
  },
})
const Mutations = Stdb.StdbGroup.make("Mutations", {
  errors: Stdb.errors(ReducerRollbackProbe),
}).add(
  Stdb.StdbFn.reducer("insertThenFail", {}),
  Stdb.StdbFn.reducer("emitEvent", {}),
)
const HarnessModuleBuilder = Stdb.StdbModule.make("test_harness")
  .addTables(record, nativeRangeRecord, structuredRangeRecord, harnessEvent)
  .add(Mutations)
const HarnessModule = HarnessModuleBuilder.spec
const MutationsLive = Stdb.StdbBuilder.group(
  HarnessModuleBuilder,
  "Mutations",
  {
    insertThenFail: Effect.fn(function* () {
      const db = yield* HarnessModuleBuilder.Db
      yield* db.record.insert({
        id: 0n,
        code: "rollback",
        tenant: "alpha",
        sequence: 1n,
      })
      return yield* ReducerRollbackProbe.make({})
    }),
    emitEvent: Effect.fn(function* () {
      const db = yield* HarnessModuleBuilder.Db
      yield* db.harnessEvent.insert({ id: 0n, kind: "emitted" })
    }),
  },
)

describe("test module harness", () => {
  it.effect(
    "runs the real Effect db wrapper over indexed in-memory state",
    () =>
      Effect.gen(function* () {
        const harness = StdbTesting.makeTestModuleHarness(HarnessModule)
        const first = yield* harness.effectDb.record.insert({
          id: 0n,
          code: "a",
          tenant: "alpha",
          sequence: 1n,
        })
        const second = yield* harness.effectDb.record.insert({
          id: 0n,
          code: "b",
          tenant: "alpha",
          sequence: 2n,
        })

        expect(first.id).toBe(1n)
        expect(second.id).toBe(2n)
        expect(yield* harness.effectDb.record.count()).toBe(2n)
        expect(yield* harness.effectDb.record.id.find(2n)).toEqual(second)
        expect(
          yield* harness.effectDb.record.byTenantSequence.filterToArray([
            "alpha",
            {
              from: { tag: "included", value: 1n },
              to: { tag: "excluded", value: 2n },
            },
          ]),
        ).toEqual([first])

        const duplicate = yield* Effect.flip(
          harness.effectDb.record.insert({
            id: 0n,
            code: "b",
            tenant: "alpha",
            sequence: 2n,
          }),
        )
        expect(duplicate).toBeInstanceOf(StdbUniqueAlreadyExistsError)
      }),
  )

  it.effect("compares timestamp and identity range bounds structurally", () =>
    Effect.gen(function* () {
      const harness = StdbTesting.makeTestModuleHarness(HarnessModule)
      const first = yield* harness.effectDb.nativeRangeRecord.insert({
        id: 0n,
        owner: new Identity(10n),
        happenedAt: new Timestamp(1_000n),
      })
      const second = yield* harness.effectDb.nativeRangeRecord.insert({
        id: 0n,
        owner: new Identity(20n),
        happenedAt: new Timestamp(2_000n),
      })
      const third = yield* harness.effectDb.nativeRangeRecord.insert({
        id: 0n,
        owner: new Identity(30n),
        happenedAt: new Timestamp(3_000n),
      })

      expect(
        yield* harness.effectDb.nativeRangeRecord.byOwner.filterToArray({
          from: { tag: "included", value: new Identity(10n) },
          to: { tag: "excluded", value: new Identity(30n) },
        }),
      ).toEqual([first, second])
      expect(
        yield* harness.effectDb.nativeRangeRecord.byHappenedAt.filterToArray({
          from: { tag: "excluded", value: new Timestamp(1_000n) },
          to: { tag: "included", value: new Timestamp(3_000n) },
        }),
      ).toEqual([second, third])
    }),
  )

  it.effect("rejects equal range bounds for non-orderable values", () =>
    Effect.gen(function* () {
      const harness = StdbTesting.makeTestModuleHarness(HarnessModule)
      const coordinates = { x: 1n, y: 2n }
      yield* harness.effectDb.structuredRangeRecord.insert({
        id: 0n,
        coordinates,
      })

      const failure =
        yield* harness.effectDb.structuredRangeRecord.byCoordinates
          .filterToArray({
            from: { tag: "included", value: coordinates },
            to: { tag: "included", value: coordinates },
          } as never)
          .pipe(Effect.flip)

      expect(failure).toBeInstanceOf(StdbHostCallError)
      if (failure instanceof StdbHostCallError) {
        expect(failure.cause).toBeInstanceOf(TypeError)
        expect(String(failure.cause)).toContain(
          "cannot order struct range values",
        )
      }
    }),
  )

  it.effect("returns btree scans in index order", () =>
    Effect.gen(function* () {
      const harness = StdbTesting.makeTestModuleHarness(HarnessModule)
      yield* Effect.forEach(
        [3n, 1n, 2n],
        (sequence) =>
          harness.effectDb.record.insert({
            id: 0n,
            code: `code-${sequence.toString()}`,
            tenant: "alpha",
            sequence,
          }),
        { discard: true },
      )

      const rows =
        yield* harness.effectDb.record.byTenantSequence.filterToArray([
          "alpha",
          {
            from: { tag: "included", value: 1n },
            to: { tag: "included", value: 3n },
          },
        ])
      expect(rows.map((row) => row.sequence)).toEqual([1n, 2n, 3n])
    }),
  )

  it("snapshots iterators before mutating the table", () => {
    const harness = StdbTesting.makeTestModuleHarness(HarnessModule)
    for (const sequence of [1n, 2n, 3n, 4n]) {
      harness.db.record.insert({
        id: 0n,
        code: `code-${sequence.toString()}`,
        tenant: "alpha",
        sequence,
      })
    }

    for (const row of harness.db.record.iter()) {
      harness.db.record.delete(row)
    }
    expect(harness.db.record.count()).toBe(0n)
  })

  it("restores row identity on rollback and rejects nested transactions", () => {
    const harness = StdbTesting.makeTestModuleHarness(HarnessModule)
    const original = harness.db.record.insert({
      id: 0n,
      code: "a",
      tenant: "alpha",
      sequence: 1n,
    })
    const procedure = harness.makeProcedureCtx()

    expect(() =>
      procedure.withTx((ctx) => {
        ctx.db.record.id.update({
          id: original.id,
          code: original.code,
          tenant: "changed",
          sequence: 2n,
        })
        throw new Error("rollback")
      }),
    ).toThrow("rollback")
    expect(harness.db.record.id.find(original.id)).toBe(original)

    expect(() =>
      procedure.withTx(() => procedure.withTx(() => undefined)),
    ).toThrow(StdbTesting.NestedTestTransactionError)
    expect(harness.makeMutationCtx().db).toBe(harness.db)
    expect(harness.makeViewCtx().db).toBe(harness.db)
    expect(harness.makeAnonymousViewCtx().from.record.toSql()).toContain(
      "record",
    )
    expect(() =>
      harness
        .makeViewCtx()
        .from.record.where((row) => row.code.eq(original.code)),
    ).toThrow("does not evaluate where() predicates")
  })

  it("rolls back failed bound reducers like the native host", () => {
    const harness = StdbTesting.makeTestModuleHarness(HarnessModule)
    const callables = StdbTesting.bindCallables(HarnessModuleBuilder, [
      MutationsLive,
    ])

    expect(() =>
      callables.insertThenFail?.invoke(harness.makeMutationCtx(), {}),
    ).toThrow()
    expect(harness.db.record.count()).toBe(0n)
  })

  it("clears event rows after a successful bound transaction", () => {
    const harness = StdbTesting.makeTestModuleHarness(HarnessModule)
    const callables = StdbTesting.bindCallables(HarnessModuleBuilder, [
      MutationsLive,
    ])

    callables.emitEvent?.invoke(harness.makeMutationCtx(), {})
    expect(harness.db.harnessEvent.count()).toBe(0n)

    const inserted = harness.db.harnessEvent.insert({
      id: 0n,
      kind: "emitted",
    })
    expect(inserted.id).toBe(2n)
  })
})
