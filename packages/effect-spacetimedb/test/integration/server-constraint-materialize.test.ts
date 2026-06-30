import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import { compileModule } from "effect-spacetimedb/server-compiler"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const membership = Stdb.table("membership", {
  columns: {
    tenantId: Stdb.string(),
    email: Stdb.string(),
    note: Stdb.string(),
  },
  indexes: [
    Stdb.index({
      name: "membership_emailTenant_idx",
      columns: ["email", "tenantId"],
    }),
  ],
  constraints: [
    Stdb.unique({
      name: "membership_tenant_email_unique",
      columns: ["tenantId", "email"],
    }),
  ],
})

const CompositeUniqueModule = Stdb.StdbModule.make("composite_unique", {
  settings: {
    caseConversionPolicy: "none",
  },
}).addTables(membership).spec

const userProfile = Stdb.table("userProfile", {
  columns: {
    userId: Stdb.string(),
    displayName: Stdb.string(),
  },
  indexes: [Stdb.index({ name: "byUser", columns: ["userId"] })],
})

const ExplicitNamesModule = Stdb.StdbModule.make(
  "explicit_names",
  {},
).addTables(userProfile).spec

const scheduledNonePolicy = Stdb.scheduledTable("scheduledNonePolicy", {
  columns: {
    note: Stdb.string(),
  },
})
const scheduledNonePolicyProcedure = Stdb.StdbFn.scheduledProcedure(
  "scheduledNonePolicyFire",
  {
    table: scheduledNonePolicy,
  },
)
const scheduledNonePolicyGroup = Stdb.StdbGroup.make("ScheduledNonePolicy").add(
  scheduledNonePolicyProcedure,
)

const ScheduledNonePolicyModule: Stdb.ModuleSpec<
  { readonly scheduledNonePolicy: typeof scheduledNonePolicy },
  {},
  {},
  { readonly scheduledNonePolicyFire: typeof scheduledNonePolicyProcedure.spec }
> = Stdb.StdbModule.make("scheduled_none_policy", {
  settings: {
    caseConversionPolicy: "none",
  },
})
  .addTables(scheduledNonePolicy)
  .add(scheduledNonePolicyGroup).spec

type ExplicitNameEntry = {
  readonly tag: "Index" | "Table"
  readonly value: {
    readonly sourceName: string
    readonly canonicalName: string
  }
}

const explicitNameEntries = (
  schema: unknown,
): ReadonlyArray<ExplicitNameEntry> =>
  (
    schema as {
      readonly moduleDef: {
        readonly explicitNames: {
          readonly entries: ReadonlyArray<ExplicitNameEntry>
        }
      }
    }
  ).moduleDef.explicitNames.entries

type CompiledTableDefinition = {
  readonly sourceName: string
  readonly row: {
    readonly row: Record<string, { readonly columnName?: string }>
  }
}

const compiledTables = (
  schema: unknown,
): ReadonlyArray<CompiledTableDefinition> =>
  (
    schema as {
      readonly moduleDef: {
        readonly tables: ReadonlyArray<CompiledTableDefinition>
      }
    }
  ).moduleDef.tables

describe("server constraint materialization", (it) => {
  it.effect(
    "preserves composite unique constraints through the pure table-options materializer",
    () =>
      Effect.gen(function* () {
        const options = StdbTesting.materializeTableOptions(
          CompositeUniqueModule.tables.membership,
        )

        expect(options.constraints).toEqual([
          {
            name: "membership_tenant_email_unique",
            constraint: "unique",
            columns: ["tenantId", "email"],
          },
        ])
        expect(options.indexes).toEqual([
          {
            accessor: "membership_emailTenant_idx",
            name: "membership_membership_email_tenant_idx",
            algorithm: "btree",
            columns: ["email", "tenantId"],
          },
        ])

        const noneOptions = StdbTesting.materializeTableOptions(
          CompositeUniqueModule.tables.membership,
          CompositeUniqueModule.settings.caseConversionPolicy,
        )

        expect(noneOptions.indexes).toEqual([
          {
            accessor: "membership_emailTenant_idx",
            name: "membership_membership_emailTenant_idx",
            algorithm: "btree",
            columns: ["email", "tenantId"],
          },
        ])
      }),
  )

  it.effect(
    "emits canonical explicit index names in compiled module defs",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: ExplicitNamesModule,
          runtime: TestSyncRunner,
        })
        const compiled = compileModule({
          server,
          handlers: server.handlers({}),
        })

        expect(explicitNameEntries(compiled.schema)).toContainEqual({
          tag: "Index",
          value: {
            sourceName: "userProfile_userId_idx_btree",
            canonicalName: "user_profile_by_user",
          },
        })
      }),
  )

  it.effect("pins scheduled host column names under none case conversion", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer<typeof ScheduledNonePolicyModule>({
        module: ScheduledNonePolicyModule,
      })
      const compiled = compileModule({
        server,
        // The overloaded helper loses this annotated test module's scheduled
        // procedure key, but runtime validation still checks the same key.
        handlers: server.handlers({
          procedures: {
            scheduledNonePolicyFire: Effect.fn(function* ({
              data,
            }: {
              readonly data: Stdb.TableRow<typeof scheduledNonePolicy>
            }) {
              void data.note
              return undefined
            }),
          },
        } as never),
      })
      const [table] = compiledTables(compiled.schema)

      expect(table?.sourceName).toBe("scheduledNonePolicy")
      expect(table?.row.row.scheduledId?.columnName).toBe("scheduled_id")
      expect(table?.row.row.scheduledAt?.columnName).toBe("scheduled_at")
    }),
  )
})
