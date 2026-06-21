// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - interop tests intentionally exercise raw STDB schema constructors
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Schema from "effect/Schema"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

describe("field and table contracts", (it) => {
  it.effect("validates field metadata invariants", () =>
    Effect.gen(function* () {
      expect(() => Stdb.string().primaryKey().optional()).toThrow(
        "optional and a primary key",
      )

      expect(() => Stdb.u64().autoInc()).toThrow(
        "autoInc fields must also be primary keys",
      )

      expect(() => Stdb.u64().primaryKey().default(0n)).toThrow(
        "default cannot be combined with primaryKey",
      )

      expect(() => Stdb.string().name("")).toThrow(
        "database name cannot be empty",
      )

      expect(() => Stdb.string().name(" ")).toThrow(
        "database name cannot be blank",
      )
    }),
  )

  it.effect("rejects defaults and native names for non-column builders", () =>
    Effect.gen(function* () {
      const Nested = Stdb.struct({
        value: Stdb.u32(),
      })

      expect(() =>
        Nested.default({ value: 1 }).name("nested_value"),
      ).not.toThrow()
      expect(() => Stdb.unit().default(undefined)).toThrow(
        "default is not supported",
      )
      expect(() => Stdb.option(Stdb.string()).default(undefined)).not.toThrow()
      expect(() =>
        Stdb.string().optional().default("optional").name("optional_name"),
      ).not.toThrow()
    }),
  )

  it.effect("preserves default values and native column names", () =>
    Effect.gen(function* () {
      const userTable = Stdb.table("user", {
        columns: {
          id: Stdb.string().primaryKey(),
          displayName: Stdb.string().name("display_name").default("anonymous"),
          score: Stdb.u32().default(0),
        },
      })

      expect(StdbTesting.fieldOptions(userTable.columns.displayName).name).toBe(
        "display_name",
      )
      expect(
        StdbTesting.fieldOptions(userTable.columns.displayName).hasDefault,
      ).toBe(true)
      expect(
        StdbTesting.fieldOptions(userTable.columns.displayName).defaultValue,
      ).toBe("anonymous")
      expect(
        StdbTesting.fieldOptions(userTable.columns.score).defaultValue,
      ).toBe(0)
    }),
  )

  it.effect("rejects defaulted unique constraint columns", () =>
    Effect.gen(function* () {
      expect(() =>
        Stdb.table("defaulted_unique", {
          columns: {
            email: Stdb.string().default(""),
          },
          constraints: [
            Stdb.unique({ name: "email_unique", columns: ["email"] }),
          ],
        }),
      ).toThrow("default cannot be combined with unique constraints")
    }),
  )

  it.effect("preserves scheduled table, index, and constraint metadata", () =>
    Effect.gen(function* () {
      const reminderTable = Stdb.scheduledTable("reminder", {
        public: false,
        columns: {
          note: Stdb.string(),
        },
        indexes: (columns) => [
          Stdb.index("reminderIdIdx", [columns.scheduledId]),
        ],
        constraints: (columns) => [
          Stdb.unique("reminderIdUnique", [columns.scheduledId]),
        ],
      })

      expect(reminderTable.scheduled).toBe(true)
      expect(reminderTable.indexes).toHaveLength(1)
      expect(reminderTable.constraints).toHaveLength(1)
      expect(
        StdbTesting.fieldOptions(reminderTable.columns.scheduledId).autoInc,
      ).toBe(true)
      expect(
        StdbTesting.fieldOptions(reminderTable.columns.scheduledId).name,
      ).toBe("scheduled_id")
      expect(
        StdbTesting.fieldOptions(reminderTable.columns.scheduledAt).name,
      ).toBe("scheduled_at")
      expect(reminderTable.columns.scheduledAt).toBeDefined()
    }),
  )

  it.effect("rejects scheduled table native column name collisions", () =>
    Effect.gen(function* () {
      expect(() =>
        Stdb.scheduledTable("reserved_native_id", {
          columns: {
            note: Stdb.string().name("scheduled_id"),
          },
        }),
      ).toThrow("reserved native column name scheduled_id")

      expect(() =>
        Stdb.scheduledTable("reserved_native_at", {
          columns: {
            note: Stdb.string().name("scheduled_at"),
          },
        }),
      ).toThrow("reserved native column name scheduled_at")
    }),
  )

  it.effect("derives indexes and unique constraints from field chaining", () =>
    Effect.gen(function* () {
      const accountTable = Stdb.table("account", {
        columns: {
          id: Stdb.string().primaryKey(),
          email: Stdb.string().unique(),
          displayName: Stdb.string().index("btree"),
        },
      })

      expect(accountTable.constraints).toEqual([
        {
          kind: "unique",
          name: "email_unique",
          columns: ["email"],
        },
      ])
      expect(accountTable.indexes).toEqual([
        {
          name: "displayName",
          algorithm: "btree",
          columns: ["displayName"],
        },
        {
          name: "email",
          algorithm: "btree",
          columns: ["email"],
        },
      ])
    }),
  )

  it.effect("materializes hash and direct index algorithms", () =>
    Effect.gen(function* () {
      const algorithmTable = Stdb.table("algorithmFields", {
        columns: {
          id: Stdb.string().primaryKey(),
          emailHash: Stdb.string().index("hash"),
          scoreDirect: Stdb.u32().index("direct"),
          tenant: Stdb.string(),
        },
        indexes: [Stdb.index("tenantHash", ["tenant"], { algorithm: "hash" })],
      })

      expect(
        StdbTesting.fieldOptions(algorithmTable.columns.emailHash).index,
      ).toBe("hash")
      expect(
        StdbTesting.fieldOptions(algorithmTable.columns.scoreDirect).index,
      ).toBe("direct")
      expect(algorithmTable.indexes).toEqual([
        {
          name: "emailHash",
          algorithm: "hash",
          columns: ["emailHash"],
        },
        {
          name: "scoreDirect",
          algorithm: "direct",
          columns: ["scoreDirect"],
        },
        {
          name: "tenantHash",
          algorithm: "hash",
          columns: ["tenant"],
        },
      ])
      expect(
        StdbTesting.materializeTableOptions(algorithmTable).indexes,
      ).toEqual([
        {
          accessor: "emailHash",
          name: "algorithm_fields_email_hash",
          algorithm: "hash",
          columns: ["emailHash"],
        },
        {
          accessor: "scoreDirect",
          name: "algorithm_fields_score_direct",
          algorithm: "direct",
          column: "scoreDirect",
        },
        {
          accessor: "tenantHash",
          name: "algorithm_fields_tenant_hash",
          algorithm: "hash",
          columns: ["tenant"],
        },
      ])
    }),
  )

  it.effect(
    "rejects standalone materialization of multi-column direct indexes",
    () =>
      Effect.gen(function* () {
        const invalidDirectTable = Stdb.table("invalidDirect", {
          columns: {
            tenant: Stdb.string(),
            score: Stdb.u32(),
          },
          indexes: [
            Stdb.index("tenantScoreDirect", ["tenant", "score"], {
              algorithm: "direct",
            }),
          ],
        })

        expect(() =>
          StdbTesting.materializeTableOptions(invalidDirectTable),
        ).toThrow(
          "Table invalidDirect direct index tenantScoreDirect must target exactly one column",
        )
      }),
  )

  it.effect("preserves optional struct fields through derived columns", () =>
    Effect.gen(function* () {
      const userTable = Stdb.table("derived_user", {
        columns: {
          id: Stdb.string().primaryKey(),
          note: Stdb.string().optional(),
        },
      })

      expect(StdbTesting.fieldOptions(userTable.columns.note).optional).toBe(
        true,
      )
      expect(() =>
        Schema.decodeUnknownSync(userTable.row.schema)({
          id: "user-1",
        }),
      ).not.toThrow()
    }),
  )

  it.effect("keys module tables from positional table names", () =>
    Effect.gen(function* () {
      const user = Stdb.table("user", {
        public: true,
        columns: {
          id: Stdb.string().primaryKey(),
        },
      })
      const audit = Stdb.table("audit", {
        columns: {
          id: Stdb.u64().primaryKey(),
        },
      })
      const module = Stdb.StdbModule.make("table_builder_cutover", {})
        .addTables(user)
        .addTables(audit)

      expect(Object.keys(module.spec.tables)).toEqual(["user", "audit"])
      expect(module.spec.tables.user.name).toBe("user")
      expect(module.spec.tables.audit.name).toBe("audit")
    }),
  )

  it.effect("adds a single table through addTables", () =>
    Effect.gen(function* () {
      const user = Stdb.table("singleUser", {
        columns: {
          id: Stdb.string().primaryKey(),
        },
      })
      const module = Stdb.StdbModule.make("single_table_builder", {}).addTables(
        user,
      )

      expect(Object.keys(module.spec.tables)).toEqual(["singleUser"])
      expect(module.spec.tables.singleUser.name).toBe("singleUser")
    }),
  )

  it.effect("rejects duplicate table names within one addTables call", () =>
    Effect.gen(function* () {
      const first = Stdb.table("same_call_duplicate", {
        columns: {
          id: Stdb.string().primaryKey(),
        },
      })
      const second = Stdb.table("same_call_duplicate", {
        columns: {
          id: Stdb.string().primaryKey(),
        },
      })

      expect(() =>
        Stdb.StdbModule.make("duplicate_tables_same_call", {}).addTables(
          first,
          second,
        ),
      ).toThrow("duplicate table same_call_duplicate")
    }),
  )

  it.effect("rejects duplicate table names across addTables calls", () =>
    Effect.gen(function* () {
      const first = Stdb.table("duplicate_user", {
        columns: {
          id: Stdb.string().primaryKey(),
        },
      })
      const second = Stdb.table("duplicate_user", {
        columns: {
          id: Stdb.string().primaryKey(),
        },
      })

      expect(() =>
        Stdb.StdbModule.make("duplicate_tables", {})
          .addTables(first)
          .addTables(second),
      ).toThrow("duplicate table key duplicate_user")
    }),
  )

  it.effect(
    "rejects impossible table metadata combinations at module definition time",
    () =>
      Effect.gen(function* () {
        const impossible = {
          ...Stdb.scheduledTable("impossible", {
            public: true,
            columns: {},
          }),
          event: true,
        } as unknown as Stdb.AnyScheduledTableSpec

        expect(
          () =>
            Stdb.StdbModule.make("invalid", {})
              .addTables(impossible)
              .add(
                Stdb.StdbGroup.make("Invalid").add(
                  Stdb.StdbFn.scheduledProcedure("noop", {
                    table: impossible,
                  }),
                ),
              ).spec,
        ).toThrow("cannot be both an event table and a scheduled table")
      }),
  )

  it.effect(
    "reports available table names for unregistered schedule targets",
    () =>
      Effect.gen(function* () {
        const reminder = Stdb.scheduledTable("reminder", {
          columns: {
            note: Stdb.string(),
          },
        })
        const unregistered = Stdb.scheduledTable("unregisteredReminder", {
          columns: {
            note: Stdb.string(),
          },
        })

        expect(() =>
          Stdb.project(
            Stdb.StdbModule.make("invalid_schedule_target", {})
              .addTables(reminder)
              .add(
                Stdb.StdbGroup.make("InvalidSchedule").add(
                  Stdb.StdbFn.scheduledReducer("reminderFire", {
                    table: unregistered,
                  }),
                ),
              ).spec,
          ),
        ).toThrow("expected one of reminder")
      }),
  )

  it.effect(
    "rejects scheduleAt columns on plain tables at module definition time",
    () =>
      Effect.gen(function* () {
        const plainScheduleAt = Stdb.table("plainScheduleAt", {
          columns: {
            id: Stdb.u64().primaryKey(),
            scheduledAt: Stdb.scheduleAt(),
          },
        })

        expect(
          () =>
            Stdb.StdbModule.make("invalid", {}).addTables(plainScheduleAt).spec,
        ).toThrow("use Stdb.scheduledTable")
      }),
  )
})
