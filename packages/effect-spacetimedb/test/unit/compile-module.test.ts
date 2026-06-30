import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import { compileModule } from "effect-spacetimedb/server-compiler"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { registerCompiledModule } from "../helpers/spacetimedb-server"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

type CapturedBuilder = {
  readonly kind?: string
  readonly item?: CapturedBuilder
  readonly row?: Record<string, CapturedBuilder>
  readonly fields?: Record<string, CapturedBuilder>
  readonly columnName?: string
  readonly defaultValue?: unknown
  readonly typeName?: string
  readonly isOptional?: boolean
  readonly columnMetadata?: {
    readonly isPrimaryKey?: boolean
    readonly isAutoIncrement?: boolean
  }
}

type CapturedExport = {
  readonly params?: Record<string, CapturedBuilder>
}

type CapturedModuleDef = {
  readonly tables: ReadonlyArray<{
    readonly sourceName: string
    readonly row: CapturedBuilder
  }>
  readonly reducers: ReadonlyArray<{
    readonly sourceName: string
    readonly params: Record<string, CapturedBuilder>
  }>
  readonly procedures: ReadonlyArray<{
    readonly sourceName: string
    readonly params: Record<string, CapturedBuilder>
    readonly returnType: CapturedBuilder
  }>
  readonly httpHandlers: ReadonlyArray<{ readonly sourceName: string }>
  readonly httpRoutes: ReadonlyArray<{
    readonly handlerFunction: string
    readonly method: string
    readonly path: string
  }>
  readonly views: ReadonlyArray<{
    readonly sourceName: string
    readonly exportName: string
    readonly public: boolean
  }>
  readonly explicitNames: {
    readonly entries: ReadonlyArray<{
      readonly tag: "Index" | "Table"
      readonly value: {
        readonly sourceName: string
        readonly canonicalName: string
      }
    }>
  }
}

const exportParams = (value: unknown): Record<string, CapturedBuilder> => {
  const params = (value as CapturedExport).params
  if (params === undefined) {
    throw new Error("Expected compiled export params")
  }
  return params
}

const viewDefinitions = (
  schema: unknown,
): ReadonlyArray<{
  readonly sourceName: string
  readonly exportName: string
  readonly public: boolean
}> =>
  (
    schema as {
      readonly moduleDef: {
        readonly views: ReadonlyArray<{
          readonly sourceName: string
          readonly exportName: string
          readonly public: boolean
        }>
      }
    }
  ).moduleDef.views

const moduleDef = (schema: unknown): CapturedModuleDef =>
  (
    schema as {
      readonly moduleDef: CapturedModuleDef
    }
  ).moduleDef

const normalizeBuilderMap = (
  values: Record<string, CapturedBuilder>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      normalizeBuilder(value),
    ]),
  )

const normalizeBuilder = (
  builder: CapturedBuilder,
): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {}

  if (builder.kind !== undefined) {
    normalized.kind = builder.kind
  }
  if (builder.columnName !== undefined) {
    normalized.columnName = builder.columnName
  }
  if (builder.defaultValue !== undefined) {
    normalized.defaultValue = builder.defaultValue
  }
  if (builder.typeName !== undefined) {
    normalized.typeName = builder.typeName
  }
  if (builder.isOptional !== undefined) {
    normalized.isOptional = builder.isOptional
  }
  if (builder.columnMetadata !== undefined) {
    const metadata: Record<string, boolean> = {}
    if (builder.columnMetadata.isPrimaryKey !== undefined) {
      metadata.isPrimaryKey = builder.columnMetadata.isPrimaryKey
    }
    if (builder.columnMetadata.isAutoIncrement !== undefined) {
      metadata.isAutoIncrement = builder.columnMetadata.isAutoIncrement
    }
    normalized.columnMetadata = metadata
  }
  if (builder.item !== undefined) {
    normalized.item = normalizeBuilder(builder.item)
  }
  if (builder.fields !== undefined) {
    normalized.fields = normalizeBuilderMap(builder.fields)
  }
  if (builder.row !== undefined) {
    normalized.row = normalizeBuilderMap(builder.row)
  }

  return normalized
}

const normalizeModuleDef = (schema: unknown) => {
  const definition = moduleDef(schema)

  return {
    tables: definition.tables.map((table) => ({
      sourceName: table.sourceName,
      row: normalizeBuilder(table.row),
    })),
    reducers: definition.reducers.map((reducer) => ({
      sourceName: reducer.sourceName,
      params: normalizeBuilderMap(reducer.params),
    })),
    procedures: definition.procedures.map((procedure) => ({
      sourceName: procedure.sourceName,
      params: normalizeBuilderMap(procedure.params),
      returnType: normalizeBuilder(procedure.returnType),
    })),
    httpHandlers: definition.httpHandlers,
    httpRoutes: definition.httpRoutes,
    views: definition.views,
    explicitNames: definition.explicitNames,
  }
}

describe("compiled module exports", (it) => {
  it.effect(
    "materializes optional callable params with option wire builders",
    () =>
      Effect.gen(function* () {
        const ParamModule = Stdb.StdbModule.make(
          "param_materialization",
          {},
        ).add(
          Stdb.StdbGroup.make("Actions").add(
            Stdb.StdbFn.reducer("optionalParamSet", {
              params: Stdb.struct({
                nickname: Stdb.optional(Stdb.string()),
                status: Stdb.option(Stdb.string()),
              }),
            }),
          ),
        ).spec
        const server = StdbTesting.makeServer({
          module: ParamModule,
          runtime: TestSyncRunner,
        })
        const compiled = compileModule({
          server,
          handlers: server.handlers({
            reducers: {
              optionalParamSet: Effect.fn(function* (_args) {}),
            },
          }),
        })
        const params = exportParams(compiled.exports.optional_param_set)

        expect(params.nickname?.kind).toBe("option")
        expect(params.nickname?.item?.kind).toBe("string")
        expect(params.status?.kind).toBe("option")
        expect(params.status?.item?.kind).toBe("string")
      }),
  )

  it.effect(
    "keeps scheduled callable params on the scheduled row override",
    () =>
      Effect.gen(function* () {
        const schedule = Stdb.scheduledTable("materializedSchedule", {
          columns: {
            id: Stdb.u64(),
            note: Stdb.string().optional(),
          },
        })
        const ScheduledModule = Stdb.StdbModule.make("scheduled_params", {})
          .addTables(schedule)
          .add(
            Stdb.StdbGroup.make("Actions").add(
              Stdb.StdbFn.scheduledProcedure("materializedScheduleFire", {
                table: schedule,
              }),
            ),
          ).spec
        const server = StdbTesting.makeServer({
          module: ScheduledModule,
          runtime: TestSyncRunner,
        })
        const compiled = compileModule({
          server,
          handlers: server.handlers({
            procedures: {
              materializedScheduleFire: Effect.fn(function* (_args) {}),
            },
          }),
        })
        const params = exportParams(compiled.exports.materialized_schedule_fire)

        expect(Object.keys(params)).toEqual(["data"])
        expect(params.data?.row).toBeDefined()
      }),
  )

  it.effect(
    "rejects duplicate compiled export keys as a compiler backstop",
    () =>
      Effect.gen(function* () {
        const BaseModule = Stdb.StdbModule.make("compiled_collision", {}).add(
          Stdb.StdbGroup.make("Actions")
            .add(
              Stdb.StdbFn.reducer("alpha", {
                params: Stdb.struct({}),
              }),
            )
            .add(
              Stdb.StdbFn.anonymousView("beta", {
                returns: Stdb.array(Stdb.struct({ id: Stdb.string() })),
              }),
            ),
        ).spec
        const CollisionModule = {
          ...BaseModule,
          wireNames: {
            ...BaseModule.wireNames,
            functions: {
              ...BaseModule.wireNames.functions,
              alpha: "shared_export",
            },
            views: {
              ...BaseModule.wireNames.views,
              beta: "shared_export",
            },
          },
        }
        const server = StdbTesting.makeServer({
          module: BaseModule,
          runtime: TestSyncRunner,
        })
        const handlers = server.handlers({
          reducers: {
            alpha: Effect.fn(function* (_args) {}),
          },
          views: {
            beta: Effect.fn(function* () {
              return []
            }),
          },
        })

        ;(server as unknown as { module: typeof CollisionModule }).module =
          CollisionModule
        expect(() => compileModule({ server, handlers })).toThrow(
          "Duplicate compiled export shared_export",
        )
      }),
  )

  it.effect("uses view wire names for compiled native names and exports", () =>
    Effect.gen(function* () {
      const ViewModule = Stdb.StdbModule.make("compiled_views", {}).add(
        Stdb.StdbGroup.make("Views").add(
          Stdb.StdbFn.anonymousView("activePlayers", {
            returns: Stdb.array(Stdb.struct({ id: Stdb.string() })),
          }),
        ),
      ).spec
      const server = StdbTesting.makeServer({
        module: ViewModule,
        runtime: TestSyncRunner,
      })
      const compiled = compileModule({
        server,
        handlers: server.handlers({
          views: {
            activePlayers: Effect.fn(function* () {
              return []
            }),
          },
        }),
      })

      expect(Object.keys(compiled.exports)).toEqual(["active_players"])
      expect(compiled.exports.activePlayers).toBeUndefined()

      registerCompiledModule(compiled.schema, compiled.exportGroup())
      expect(viewDefinitions(compiled.schema)).toEqual([
        {
          sourceName: "active_players",
          exportName: "active_players",
          public: true,
        },
      ])
    }),
  )

  it.effect("keeps authored view names when case conversion is disabled", () =>
    Effect.gen(function* () {
      const ViewModule = Stdb.StdbModule.make("compiled_views_none", {
        settings: {
          caseConversionPolicy: "none",
        },
      }).add(
        Stdb.StdbGroup.make("Views").add(
          Stdb.StdbFn.anonymousView("activePlayers", {
            returns: Stdb.array(Stdb.struct({ id: Stdb.string() })),
          }),
        ),
      ).spec
      const server = StdbTesting.makeServer({
        module: ViewModule,
        runtime: TestSyncRunner,
      })
      const compiled = compileModule({
        server,
        handlers: server.handlers({
          views: {
            activePlayers: Effect.fn(function* () {
              return []
            }),
          },
        }),
      })

      expect(Object.keys(compiled.exports)).toEqual(["activePlayers"])

      registerCompiledModule(compiled.schema, compiled.exportGroup())
      expect(viewDefinitions(compiled.schema)).toEqual([
        {
          sourceName: "activePlayers",
          exportName: "activePlayers",
          public: true,
        },
      ])
    }),
  )

  it.effect(
    "goldens compiler-output module definitions through the default server stub",
    () =>
      Effect.gen(function* () {
        const goldenUser = Stdb.table("goldenUser", {
          public: true,
          columns: {
            id: Stdb.u64().primaryKey().autoInc(),
            displayName: Stdb.string()
              .name("display_name")
              .default("anonymous"),
            score: Stdb.u32().default(0),
            status: Stdb.literal("active", "away").default("active"),
          },
          indexes: (columns) => [
            Stdb.index("goldenUserIdIdx", [columns.id]),
            Stdb.index("goldenUserDisplayNameHashIdx", [columns.displayName], {
              algorithm: "hash",
            }),
          ],
        })
        const goldenDigest = Stdb.scheduledTable("goldenDigest", {
          public: false,
          scheduledId: Stdb.u64(),
          columns: {
            userId: Stdb.u64(),
            note: Stdb.string().default(""),
          },
        })
        const GoldenModule = Stdb.StdbModule.make("compiler_output_golden", {})
          .addTables(goldenUser, goldenDigest)
          .add(
            Stdb.StdbGroup.make("Actions")
              .add(
                Stdb.StdbFn.reducer("touchUser", {
                  params: Stdb.struct({
                    userId: Stdb.u64(),
                    nickname: Stdb.string().optional(),
                  }),
                }),
              )
              .add(
                Stdb.StdbFn.procedure("refreshUser", {
                  params: Stdb.struct({ userId: Stdb.u64() }),
                  returns: Stdb.unit(),
                }),
              )
              .add(
                Stdb.StdbFn.scheduledProcedure("sendDigest", {
                  table: goldenDigest,
                }),
              )
              .add(
                Stdb.StdbFn.anonymousView("goldenUsers", {
                  returns: Stdb.array(
                    Stdb.struct({
                      id: Stdb.u64(),
                      displayName: Stdb.string(),
                    }),
                  ),
                }),
              ),
          )
          .add(
            Stdb.StdbHttpGroup.make("Http").add(
              Stdb.StdbHttp.post("goldenPing", "/golden/ping"),
            ),
          ).spec
        const server = StdbTesting.makeServer({
          module: GoldenModule,
          runtime: TestSyncRunner,
        })
        const compiled = compileModule({
          server,
          handlers: server.handlers({
            reducers: {
              touchUser: Effect.fn(function* (_args) {}),
            },
            procedures: {
              refreshUser: Effect.fn(function* (_args) {}),
              sendDigest: Effect.fn(function* (_args) {}),
            },
            views: {
              goldenUsers: Effect.fn(function* () {
                return []
              }),
            },
            httpHandlers: {
              goldenPing: server.httpHandler(
                Effect.fn(function* (_req: Stdb.Request) {
                  return new Stdb.SyncResponse("pong")
                }),
              ),
            },
          }),
        })

        registerCompiledModule(compiled.schema, compiled.exportGroup())

        expect(normalizeModuleDef(compiled.schema)).toEqual({
          tables: [
            {
              sourceName: "goldenUser",
              row: {
                row: {
                  id: {
                    kind: "u64",
                    columnMetadata: {
                      isPrimaryKey: true,
                      isAutoIncrement: true,
                    },
                  },
                  displayName: {
                    kind: "string",
                    columnName: "display_name",
                    defaultValue: "anonymous",
                  },
                  score: {
                    kind: "u32",
                    defaultValue: 0,
                  },
                  status: {
                    kind: "enum",
                    defaultValue: {
                      tag: "active",
                    },
                    typeName:
                      "EffectSpacetimeDbEnum1062007617678196259710469321094860432234",
                    fields: {
                      "0": {},
                      "1": {},
                    },
                  },
                },
              },
            },
            {
              sourceName: "goldenDigest",
              row: {
                row: {
                  scheduledId: {
                    kind: "u64",
                    columnName: "scheduled_id",
                    columnMetadata: {
                      isPrimaryKey: true,
                      isAutoIncrement: true,
                    },
                  },
                  scheduledAt: {
                    kind: "scheduleAt",
                    columnName: "scheduled_at",
                  },
                  userId: {
                    kind: "u64",
                  },
                  note: {
                    kind: "string",
                    defaultValue: "",
                  },
                },
              },
            },
          ],
          reducers: [
            {
              sourceName: "touch_user",
              params: {
                userId: {
                  kind: "u64",
                },
                nickname: {
                  kind: "option",
                  item: {
                    kind: "string",
                  },
                },
              },
            },
          ],
          procedures: [
            {
              sourceName: "refresh_user",
              params: {
                userId: {
                  kind: "u64",
                },
              },
              returnType: {
                kind: "unit",
              },
            },
            {
              sourceName: "send_digest",
              params: {
                data: {
                  row: {
                    scheduledId: {
                      kind: "u64",
                      columnName: "scheduled_id",
                      columnMetadata: {
                        isPrimaryKey: true,
                        isAutoIncrement: true,
                      },
                    },
                    scheduledAt: {
                      kind: "scheduleAt",
                      columnName: "scheduled_at",
                    },
                    userId: {
                      kind: "u64",
                    },
                    note: {
                      kind: "string",
                      defaultValue: "",
                    },
                  },
                },
              },
              returnType: {
                kind: "unit",
              },
            },
          ],
          httpHandlers: [
            {
              sourceName: "golden_ping",
            },
          ],
          httpRoutes: [
            {
              handlerFunction: "golden_ping",
              method: "POST",
              path: "/golden/ping",
            },
          ],
          views: [
            {
              sourceName: "golden_users",
              exportName: "golden_users",
              public: true,
            },
          ],
          explicitNames: {
            entries: [
              {
                tag: "Index",
                value: {
                  sourceName: "goldenUser_id_idx_btree",
                  canonicalName: "golden_user_golden_user_id_idx",
                },
              },
              {
                tag: "Index",
                value: {
                  sourceName: "goldenUser_displayName_idx_hash",
                  canonicalName:
                    "golden_user_golden_user_display_name_hash_idx",
                },
              },
              {
                tag: "Table",
                value: {
                  sourceName: "goldenUser",
                  canonicalName: "goldenUser",
                },
              },
              {
                tag: "Table",
                value: {
                  sourceName: "goldenDigest",
                  canonicalName: "goldenDigest",
                },
              },
            ],
          },
        })
      }),
  )
})
