
import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import {
  TestEffectCallbackError,
  testEffectCallbackError,
} from "../helpers/effect-errors"

const { expect } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)
const emptyWireNames: Stdb.AnyModuleSpec["wireNames"] = {
  tables: {},
  views: {},
  functions: {},
}
const withWireNames = (
  module: object,
  wireNames: Stdb.AnyModuleSpec["wireNames"] = emptyWireNames,
): Stdb.AnyModuleSpec =>
  ({
    ...module,
    wireNames,
  }) as Stdb.AnyModuleSpec

const unsafeLiteralDescriptor = (
  values: readonly [string, ...string[]],
): Stdb.AnyValueType =>
  StdbTesting.ContractType.attachStdbType(
    Schema.String,
    (factories) => factories.string(),
    { kind: "literal", values },
  ) as unknown as Stdb.AnyValueType

describe("module validation diagnostics", (it) => {
  it.effect("aggregates typed diagnostics without throwing", () =>
    Effect.gen(function* () {
      const User = Stdb.table("relation", {
        columns: {
          id: Stdb.string().primaryKey(),
        },
        indexes: [
          Stdb.index({
            name: "missing_index",
            columns: ["missing"],
          }),
        ],
        constraints: [
          Stdb.unique({
            name: "unbacked_unique",
            columns: ["id", "missing"],
          }),
        ],
      })
      const InvalidModule = {
        kind: "module" as const,
        name: "diagnostics",
        settings: {},
        tables: {
          user: User,
        },
        views: {
          relation: Stdb.StdbFn.anonymousView("relation", {
            returns: Stdb.array(
              Stdb.struct({
                id: Stdb.string(),
              }),
            ),
          }).spec,
        },
        reducers: {},
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      const diagnostics = Stdb.validate(withWireNames(InvalidModule))

      expect(diagnostics.map((entry) => entry.code)).toEqual(
        expect.arrayContaining([
          "DuplicateRelationName",
          "MissingSelectedColumn",
          "UniqueConstraintMissingBackingIndex",
        ]),
      )
      expect(
        diagnostics.every((entry) =>
          Predicate.isTagged(entry, "StdbDiagnostic"),
        ),
      ).toBe(true)
    }),
  )

  it.effect("reports raw schema values as explicit fallback diagnostics", () =>
    Effect.gen(function* () {
      const InvalidModule = {
        kind: "module" as const,
        name: "unsupported_type",
        settings: {},
        tables: {
          user: Stdb.table("user", {
            columns: {
              id: Stdb.string().primaryKey(),
            },
          }),
        },
        views: {},
        reducers: {
          raw_schema_reducer: {
            kind: "reducer" as const,
            public: true,
            params: Stdb.struct({
              id: Stdb.string(),
              raw: Schema.instanceOf(URL) as unknown as Stdb.AnyValueType,
            }),
          },
        },
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(InvalidModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "UnsupportedTypeDescriptor",
            path: ["reducers", "raw_schema_reducer", "params", "raw"],
          }),
        ]),
      )
    }),
  )

  it.effect("rejects string literal generated-client tag collisions", () =>
    Effect.gen(function* () {
      const InvalidModule = {
        kind: "module" as const,
        name: "literal_collisions",
        settings: {},
        tables: {},
        views: {},
        reducers: {
          colliding_literals: {
            kind: "reducer" as const,
            public: true,
            params: Stdb.struct({
              generatedCollision: unsafeLiteralDescriptor([
                "foo-bar",
                "foo_bar",
              ]),
              crossFormCollision: unsafeLiteralDescriptor(["foo", "Foo"]),
            }),
          },
        },
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(InvalidModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "LiteralTagCollision",
            path: [
              "reducers",
              "colliding_literals",
              "params",
              "generatedCollision",
            ],
          }),
          expect.objectContaining({
            code: "LiteralTagCollision",
            path: [
              "reducers",
              "colliding_literals",
              "params",
              "crossFormCollision",
            ],
          }),
        ]),
      )
    }),
  )

  it.effect("rejects string literal schema tags that remain invalid", () =>
    Effect.gen(function* () {
      const InvalidModule = {
        kind: "module" as const,
        name: "invalid_literal_tag",
        settings: {},
        tables: {},
        views: {},
        reducers: {
          invalid_literal_tag: {
            kind: "reducer" as const,
            public: true,
            params: Stdb.struct({
              status: unsafeLiteralDescriptor(["1-start"]),
            }),
          },
        },
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(InvalidModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "InvalidLiteralTag",
            path: ["reducers", "invalid_literal_tag", "params", "status"],
          }),
        ]),
      )
    }),
  )

  it.effect("rejects multi-column direct indexes", () =>
    Effect.gen(function* () {
      const InvalidDirectIndexTable = Stdb.table("directIndexed", {
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
      const InvalidModule = {
        kind: "module" as const,
        name: "invalid_direct_index",
        settings: {},
        tables: {
          directIndexed: InvalidDirectIndexTable,
        },
        views: {},
        reducers: {},
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(InvalidModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "DirectIndexMultiColumn",
            path: ["tables", "directIndexed", "indexes", 0],
            message:
              "Direct index tenantScoreDirect on table directIndexed must reference exactly one column",
          }),
        ]),
      )
      expect(
        () =>
          Stdb.StdbModule.make("invalid_direct_index_builder", {}).addTables(
            InvalidDirectIndexTable,
          ).spec,
      ).toThrow(
        "Direct index tenantScoreDirect on table directIndexed must reference exactly one column",
      )
    }),
  )

  it.effect(
    "allows single-column direct and multi-column ordered/hash indexes",
    () =>
      Effect.gen(function* () {
        const ValidAlgorithmIndexTable = Stdb.table("validAlgorithmIndexes", {
          columns: {
            tenant: Stdb.string(),
            email: Stdb.string(),
            score: Stdb.u32(),
          },
          indexes: [
            Stdb.index("scoreDirect", ["score"], {
              algorithm: "direct",
            }),
            Stdb.index("tenantEmailHash", ["tenant", "email"], {
              algorithm: "hash",
            }),
            Stdb.index("tenantEmailBtree", ["tenant", "email"], {
              algorithm: "btree",
            }),
          ],
        })
        const ValidModule = {
          kind: "module" as const,
          name: "valid_algorithm_indexes",
          settings: {},
          tables: {
            validAlgorithmIndexes: ValidAlgorithmIndexTable,
          },
          views: {},
          reducers: {},
          procedures: {},
          httpHandlers: {},
          httpGroups: {},
          lifecycle: {},
        }

        expect(Stdb.validate(withWireNames(ValidModule))).toEqual([])
      }),
  )

  it.effect("rejects duplicate view names across groups", () =>
    Effect.gen(function* () {
      const DuplicateViewsModule = Stdb.StdbModule.make(
        "duplicate_view_names",
        {},
      ).add(
        Stdb.StdbGroup.make("FirstViews").add(
          Stdb.StdbFn.anonymousView("duplicate_view", {
            returns: Stdb.array(Stdb.struct({ id: Stdb.string() })),
          }),
        ),
        Stdb.StdbGroup.make("SecondViews").add(
          Stdb.StdbFn.anonymousView("duplicate_view", {
            returns: Stdb.array(Stdb.struct({ id: Stdb.string() })),
          }),
        ),
      )

      const failure = yield* Effect.try({
        try: () => DuplicateViewsModule.spec,
        catch: (cause) =>
          cause instanceof Stdb.StdbValidationError
            ? cause
            : new TestEffectCallbackError({
                operation: "interop/effect-spacetimedb/unit/module-validation",
                cause,
              }),
      }).pipe(
        Effect.catchTag("TestEffectCallbackError", (error) =>
          Effect.die(error),
        ),
        Effect.flip,
      )

      expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
      expect(failure.diagnostics).toEqual([
        expect.objectContaining({
          code: "DuplicateRelationName",
          path: ["views.duplicate_view", "duplicate_view"],
        }),
      ])
    }),
  )

  it.effect(
    "rejects duplicate names across the compiled export namespace",
    () =>
      Effect.gen(function* () {
        const reducerSpec = {
          kind: "reducer" as const,
          public: true,
          params: Stdb.struct({}),
        }
        const viewSpec = Stdb.StdbFn.anonymousView("sharedName", {
          returns: Stdb.array(Stdb.struct({ id: Stdb.string() })),
        }).spec
        const lifecycleSpec = Stdb.StdbFn.init().spec

        const ReducerViewModule = {
          kind: "module" as const,
          name: "duplicate_reducer_view_exports",
          settings: {},
          tables: {},
          views: {
            sharedName: viewSpec,
          },
          reducers: {
            sharedName: reducerSpec,
          },
          procedures: {},
          httpHandlers: {},
          httpGroups: {},
          lifecycle: {},
        }
        const ReducerLifecycleModule = {
          kind: "module" as const,
          name: "duplicate_reducer_lifecycle_exports",
          settings: {},
          tables: {},
          views: {},
          reducers: {
            init: reducerSpec,
          },
          procedures: {},
          httpHandlers: {},
          httpGroups: {},
          lifecycle: {
            init: lifecycleSpec,
          },
        }

        expect(Stdb.validate(withWireNames(ReducerViewModule))).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "DuplicateCallableName",
              path: ["exports"],
              message: expect.stringContaining("Duplicate export name"),
            }),
          ]),
        )
        expect(Stdb.validate(withWireNames(ReducerLifecycleModule))).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "DuplicateCallableName",
              path: ["exports"],
              message: expect.stringContaining("Duplicate export name"),
            }),
          ]),
        )
      }),
  )

  it.effect(
    "allows authored export names when compiled wire names do not collide",
    () =>
      Effect.gen(function* () {
        const WireSeparatedModule = {
          kind: "module" as const,
          name: "wire_separated_exports",
          settings: {},
          tables: {},
          views: {
            clientConnected: Stdb.StdbFn.anonymousView("clientConnected", {
              returns: Stdb.array(Stdb.struct({ id: Stdb.string() })),
            }).spec,
          },
          reducers: {},
          procedures: {},
          httpHandlers: {},
          httpGroups: {},
          lifecycle: {
            clientConnected: Stdb.StdbFn.clientConnected().spec,
          },
        }

        expect(
          Stdb.validate(
            withWireNames(WireSeparatedModule, {
              tables: {},
              views: {
                clientConnected: "client_connected",
              },
              functions: {},
            }),
          ),
        ).toEqual([])
      }),
  )

  it.effect("validates scheduled table targets before projection", () =>
    Effect.gen(function* () {
      const scheduledJobs = Stdb.scheduledTable("scheduledJobs", {
        columns: {
          note: Stdb.string(),
        },
      })
      const unregisteredJobs = Stdb.scheduledTable("unregisteredJobs", {
        columns: {
          note: Stdb.string(),
        },
      })
      const InvalidModule = {
        kind: "module" as const,
        name: "invalid_schedule",
        settings: {},
        tables: {
          scheduledJobs,
        },
        views: {},
        reducers: {
          runJobs: Stdb.StdbFn.scheduledReducer("runJobs", {
            table: unregisteredJobs,
          }).spec,
        },
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(InvalidModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "InvalidScheduleTarget",
            path: ["reducers", "runJobs", "scheduled", "table"],
          }),
        ]),
      )

      const DuplicateTargetModule = {
        ...InvalidModule,
        reducers: {
          first: Stdb.StdbFn.scheduledReducer("first", {
            table: scheduledJobs,
          }).spec,
          second: Stdb.StdbFn.scheduledReducer("second", {
            table: scheduledJobs,
          }).spec,
        },
      }
      expect(Stdb.validate(withWireNames(DuplicateTargetModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "DuplicateScheduleTarget",
            path: ["reducers", "second", "scheduled", "table"],
          }),
        ]),
      )

      const eventScheduledJobs = {
        ...scheduledJobs,
        event: true,
      } as unknown as Stdb.AnyScheduledTableSpec
      const EventScheduledModule = {
        ...InvalidModule,
        tables: {
          scheduledJobs: eventScheduledJobs,
        },
        reducers: {
          runJobs: Stdb.StdbFn.scheduledReducer("runJobs", {
            table: eventScheduledJobs,
          }).spec,
        },
      }
      expect(Stdb.validate(withWireNames(EventScheduledModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "EventScheduledTable",
            path: ["tables", "scheduledJobs"],
          }),
        ]),
      )

      const invalidScheduledIdJobs = {
        ...scheduledJobs,
        columns: {
          ...scheduledJobs.columns,
          scheduledId: Stdb.u64().primaryKey(),
        },
      } as unknown as Stdb.AnyScheduledTableSpec
      const InvalidScheduledIdModule = {
        ...InvalidModule,
        tables: {
          scheduledJobs: invalidScheduledIdJobs,
        },
        reducers: {
          runJobs: Stdb.StdbFn.scheduledReducer("runJobs", {
            table: invalidScheduledIdJobs,
          }).spec,
        },
      }
      expect(Stdb.validate(withWireNames(InvalidScheduledIdModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "ScheduledTableInvalidScheduledIdColumn",
            path: ["tables", "scheduledJobs", "columns", "scheduledId"],
          }),
        ]),
      )
    }),
  )

  it.effect("validates lifecycle declaration names and matching hooks", () =>
    Effect.gen(function* () {
      const UnknownLifecycleModule = {
        kind: "module" as const,
        name: "unknown_lifecycle",
        settings: {},
        tables: {},
        views: {},
        reducers: {},
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {
          onConnect: Stdb.StdbFn.init().spec,
        } as unknown as Stdb.LifecycleSpecs,
      }
      const MismatchedLifecycleModule = {
        ...UnknownLifecycleModule,
        name: "mismatched_lifecycle",
        lifecycle: {
          clientDisconnected: Stdb.StdbFn.init().spec,
        } as unknown as Stdb.LifecycleSpecs,
      }

      expect(Stdb.validate(withWireNames(UnknownLifecycleModule))).toEqual([
        expect.objectContaining({
          code: "UnknownEndpoint",
          path: ["lifecycle", "onConnect"],
          message: "Unknown lifecycle hook onConnect",
          severity: "error",
        }),
      ])
      expect(Stdb.validate(withWireNames(MismatchedLifecycleModule))).toEqual([
        expect.objectContaining({
          code: "UnknownEndpoint",
          path: ["lifecycle", "clientDisconnected", "hook"],
          message:
            "Lifecycle hook clientDisconnected must be declared with matching spec hook clientDisconnected",
          severity: "error",
        }),
      ])
    }),
  )

  it.effect(
    "diagnoses mismatched scheduled table host columns and params",
    () =>
      Effect.gen(function* () {
        const scheduledJobs = Stdb.scheduledTable("scheduledJobs", {
          columns: {
            note: Stdb.string(),
          },
        })
        const baseModule = {
          kind: "module" as const,
          name: "schedule_presence",
          settings: {},
          views: {},
          reducers: {
            runSchedule: Stdb.StdbFn.scheduledReducer("runSchedule", {
              table: scheduledJobs,
            }).spec,
          },
          procedures: {},
          httpHandlers: {},
          httpGroups: {},
          lifecycle: {},
        }
        const wrappedScheduleAt = Stdb.custom(Stdb.scheduleAt().schema, {
          type: Stdb.scheduleAt(),
        })

        const ScheduleColumnOnlyModule = {
          ...baseModule,
          tables: {
            scheduledJobs: Stdb.table("scheduledJobs", {
              columns: {
                id: Stdb.u64().primaryKey(),
                scheduledAt: Stdb.scheduleAt(),
              },
            }),
          },
        }

        expect(Stdb.validate(withWireNames(ScheduleColumnOnlyModule))).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "ScheduleAtColumnOnTable",
              path: ["tables", "scheduledJobs", "columns"],
            }),
          ]),
        )

        const scheduledTargetOnly = {
          ...Stdb.table("scheduledJobs", {
            columns: {
              id: Stdb.u64().primaryKey(),
            },
          }),
          scheduled: true,
        } as Stdb.AnyScheduledTableSpec
        const ScheduledTargetOnlyModule = {
          ...baseModule,
          tables: {
            scheduledJobs: scheduledTargetOnly,
          },
          reducers: {
            runSchedule: Stdb.StdbFn.scheduledReducer("runSchedule", {
              table: scheduledTargetOnly,
            }).spec,
          },
        }

        expect(Stdb.validate(withWireNames(ScheduledTargetOnlyModule))).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "ScheduledTableMissingScheduleAtColumn",
              path: ["tables", "scheduledJobs", "columns"],
            }),
            expect.objectContaining({
              code: "ScheduledTableMissingScheduledIdColumn",
              path: ["tables", "scheduledJobs", "columns", "scheduledId"],
            }),
          ]),
        )

        const PairedScheduledModule = {
          ...baseModule,
          tables: {
            scheduledJobs,
          },
        }

        expect(Stdb.validate(withWireNames(PairedScheduledModule))).toEqual([])

        const customScheduledJobs = {
          ...Stdb.table("scheduledJobs", {
            columns: {
              scheduledId: Stdb.u64().primaryKey().autoInc(),
              scheduledAt: wrappedScheduleAt,
            },
          }),
          scheduled: true,
        } as Stdb.AnyScheduledTableSpec
        const PairedCustomScheduledModule = {
          ...baseModule,
          tables: {
            scheduledJobs: customScheduledJobs,
          },
          reducers: {
            runSchedule: Stdb.StdbFn.scheduledReducer("runSchedule", {
              table: customScheduledJobs,
            }).spec,
          },
        }

        expect(
          Stdb.validate(withWireNames(PairedCustomScheduledModule)),
        ).toEqual([])

        const ParamsDriftModule = {
          ...PairedScheduledModule,
          reducers: {
            runSchedule: {
              ...PairedScheduledModule.reducers.runSchedule,
              params: Stdb.struct({
                data: Stdb.struct({}),
              }),
            },
          },
        }

        expect(Stdb.validate(withWireNames(ParamsDriftModule))).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "InvalidScheduledTargetParams",
              path: ["reducers", "runSchedule", "params"],
            }),
          ]),
        )
      }),
  )

  it.effect("reports duplicate declared error tags with errors paths", () =>
    Effect.gen(function* () {
      const SharedDeclaredOne = (() => {
        class SharedDeclared extends Schema.TaggedErrorClass<SharedDeclared>()(
          "SharedDeclared",
          {},
        ) {}

        return SharedDeclared
      })()
      const SharedDeclaredTwo = (() => {
        class SharedDeclared extends Schema.TaggedErrorClass<SharedDeclared>()(
          "SharedDeclared",
          {},
        ) {}

        return SharedDeclared
      })()

      const InvalidModule = {
        kind: "module" as const,
        name: "duplicate_declaredErrors",
        settings: {},
        tables: {},
        views: {},
        reducers: {
          first: Stdb.StdbFn.reducer("first", {
            params: Stdb.struct({}),
            errors: Stdb.errors(SharedDeclaredOne),
          }).spec,
        },
        procedures: {
          second: Stdb.StdbFn.procedure("second", {
            params: Stdb.struct({}),
            returns: Stdb.unit(),
            errors: Stdb.errors(SharedDeclaredTwo),
          }).spec,
        },
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(InvalidModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "DuplicateDeclaredErrorTag",
            path: ["procedures", "second", "errors", "SharedDeclared"],
          }),
        ]),
      )
    }),
  )

  it.effect("validates unsupported descriptors nested under lazy types", () =>
    Effect.gen(function* () {
      const InvalidModule = {
        kind: "module" as const,
        name: "lazy_unsupported_type",
        settings: {},
        tables: {},
        views: {},
        reducers: {
          lazy_reducer: Stdb.StdbFn.reducer("lazy_reducer", {
            params: Stdb.struct({
              nested: Stdb.lazy(() =>
                Stdb.struct({
                  raw: Schema.instanceOf(URL) as unknown as Stdb.AnyValueType,
                }),
              ),
            }),
          }).spec,
        },
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(InvalidModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "UnsupportedTypeDescriptor",
            path: [
              "reducers",
              "lazy_reducer",
              "params",
              "nested",
              "lazy",
              "raw",
            ],
          }),
        ]),
      )
    }),
  )

  it.effect("warns when HTTP group ids are awkward client keys", () =>
    Effect.gen(function* () {
      const WarningModule = Stdb.StdbModule.make(
        "http_group_client_key_warning",
        {},
      ).add(
        Stdb.StdbHttpGroup.make("web-hooks").add(
          Stdb.StdbHttp.post("rotate", "/rotate", {
            request: Schema.Struct({ id: Schema.String }),
            response: Schema.Struct({ ok: Schema.Boolean }),
          }),
        ),
      ).spec

      expect(Stdb.validate(withWireNames(WarningModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "InvalidHttpGroupClientKey",
            path: ["httpGroups", "rotate"],
            severity: "warning",
          }),
        ]),
      )

      const exit = yield* Effect.exit(
        Effect.try({
          try: () => Stdb.assertValid(withWireNames(WarningModule)),
          catch: testEffectCallbackError(
            "interop/effect-spacetimedb/unit/module-validation",
          ),
        }),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.effect("requires declared HTTP route errors to carry statuses", () =>
    Effect.gen(function* () {
      class StatuslessRouteError extends Schema.TaggedErrorClass<StatuslessRouteError>()(
        "StatuslessRouteError",
        {},
      ) {}
      const StatuslessErrors = Stdb.errors(StatuslessRouteError)
      const InvalidModule = {
        kind: "module" as const,
        name: "http_missing_error_status",
        settings: {},
        tables: {},
        views: {},
        reducers: {},
        procedures: {},
        httpHandlers: {
          statuslessRoute: {
            kind: "httpHandler" as const,
            method: "post" as const,
            path: "/statusless",
            request: Schema.Void,
            response: Schema.Void,
            errors: StatuslessErrors,
          },
        },
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(InvalidModule))).toEqual([
        expect.objectContaining({
          code: "HttpRouteMissingErrorStatus",
          path: ["httpHandlers", "statuslessRoute", "errors"],
          message: expect.stringContaining("StatuslessRouteError"),
        }),
      ])
    }),
  )

  it.effect("allows statusless declared errors outside typed HTTP routes", () =>
    Effect.gen(function* () {
      class ReducerOnlyStatuslessError extends Schema.TaggedErrorClass<ReducerOnlyStatuslessError>()(
        "ReducerOnlyStatuslessError",
        {},
      ) {}
      const ReducerOnlyErrors = Stdb.errors(ReducerOnlyStatuslessError)
      const ReducerOnlyModule = Stdb.StdbModule.make(
        "reducer_only_statusless_errors",
        {},
      ).add(
        Stdb.StdbGroup.make("Reducers").add(
          Stdb.StdbFn.reducer("statuslessReducer", {
            params: Stdb.struct({}),
            errors: ReducerOnlyErrors,
          }),
        ),
      ).spec

      expect(Stdb.validate(withWireNames(ReducerOnlyModule))).toEqual([])
    }),
  )

  it.effect("accepts typed HTTP route errors with complete statuses", () =>
    Effect.gen(function* () {
      class FullyStatusedError extends Schema.TaggedErrorClass<FullyStatusedError>()(
        "FullyStatusedError",
        {},
        { httpApiStatus: 409 },
      ) {}
      const FullyStatusedErrors = Stdb.errors(FullyStatusedError)
      const ValidModule = Stdb.StdbModule.make("http_statused_errors", {}).add(
        Stdb.StdbHttpGroup.make("Http").add(
          Stdb.StdbHttp.post("statusedRoute", "/statused", {
            request: Schema.Void,
            response: Schema.Void,
            errors: FullyStatusedErrors,
          }),
        ),
      ).spec

      expect(Stdb.validate(withWireNames(ValidModule))).toEqual([])
    }),
  )

  it.effect(
    "requires statuses for a shared definition reachable from HTTP",
    () =>
      Effect.gen(function* () {
        class SharedStatusedError extends Schema.TaggedErrorClass<SharedStatusedError>()(
          "SharedStatusedError",
          {},
          { httpApiStatus: 409 },
        ) {}
        class SharedStatuslessError extends Schema.TaggedErrorClass<SharedStatuslessError>()(
          "SharedStatuslessError",
          {},
        ) {}
        const SharedErrors = Stdb.errors(
          SharedStatusedError,
          SharedStatuslessError,
        )
        const InvalidModule = {
          kind: "module" as const,
          name: "http_shared_missing_error_status",
          settings: {},
          tables: {},
          views: {},
          reducers: {
            sharedReducer: Stdb.StdbFn.reducer("sharedReducer", {
              params: Stdb.struct({}),
              errors: SharedErrors,
            }).spec,
          },
          procedures: {},
          httpHandlers: {
            sharedRoute: {
              kind: "httpHandler" as const,
              method: "post" as const,
              path: "/shared",
              request: Schema.Void,
              response: Schema.Void,
              errors: SharedErrors,
            },
          },
          httpGroups: {},
          lifecycle: {},
        }

        expect(Stdb.validate(withWireNames(InvalidModule))).toEqual([
          expect.objectContaining({
            code: "HttpRouteMissingErrorStatus",
            path: ["httpHandlers", "sharedRoute", "errors"],
            message: expect.stringContaining("SharedStatuslessError"),
          }),
        ])
      }),
  )

  it.effect("reports non-canonical declared names across module surfaces", () =>
    Effect.gen(function* () {
      const BadVariant = Stdb.sum({
        BadTag: Stdb.struct({
          nested_field: Stdb.string(),
        }),
      })
      const InvalidModule = {
        kind: "module" as const,
        name: "canonical_names",
        settings: {},
        tables: {
          User_Table: Stdb.table("User_Table", {
            columns: {
              user_id: Stdb.string().primaryKey(),
              payload: Stdb.struct({
                created_at: Stdb.string(),
              }),
            },
            indexes: [Stdb.index("by_user", ["user_id"])],
            constraints: [Stdb.unique("bad_name", ["user_id"])],
          }),
        },
        views: {
          snake_view: Stdb.StdbFn.anonymousView("snake_view", {
            returns: Stdb.array(Stdb.struct({ id: Stdb.string() })),
          }).spec,
        },
        reducers: {
          DoThing: Stdb.StdbFn.reducer("DoThing", {
            params: Stdb.struct({
              created_at: Stdb.string(),
              variant: BadVariant,
            }),
          }).spec,
        },
        procedures: {},
        httpHandlers: {
          bad_handler: {
            kind: "httpHandler" as const,
            path: "/bad",
            method: "POST" as const,
            request: Schema.Struct({ id: Schema.String }),
            response: Schema.Struct({ ok: Schema.Boolean }),
          },
        },
        httpGroups: {},
        lifecycle: {},
      }

      const diagnostics = Stdb.validate(withWireNames(InvalidModule))

      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: ["tables", "User_Table", "name"],
          }),
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: ["tables", "User_Table", "columns", "user_id"],
          }),
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: ["tables", "User_Table", "columns", "payload", "created_at"],
          }),
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: ["tables", "User_Table", "indexes", 0, "name"],
          }),
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: ["tables", "User_Table", "constraints", 0, "name"],
          }),
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: ["views", "snake_view"],
          }),
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: ["reducers", "DoThing"],
          }),
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: ["reducers", "DoThing", "params", "created_at"],
          }),
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: ["reducers", "DoThing", "params", "variant", "BadTag"],
          }),
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: [
              "reducers",
              "DoThing",
              "params",
              "variant",
              "BadTag",
              "nested_field",
            ],
          }),
          expect.objectContaining({
            code: "NonCanonicalDeclaredName",
            path: ["httpHandlers", "bad_handler"],
          }),
        ]),
      )
    }),
  )

  it.effect("reports canonical name collisions in shared namespaces", () =>
    Effect.gen(function* () {
      const InvalidModule = {
        kind: "module" as const,
        name: "canonical_collisions",
        settings: {},
        tables: {
          first: Stdb.table("userId", {
            columns: {
              id: Stdb.string().primaryKey(),
            },
          }),
          second: Stdb.table("userID", {
            columns: {
              id: Stdb.string().primaryKey(),
            },
          }),
        },
        views: {
          reportRun: Stdb.StdbFn.anonymousView("reportRun", {
            returns: Stdb.array(Stdb.struct({ id: Stdb.string() })),
          }).spec,
        },
        reducers: {
          report_run: Stdb.StdbFn.reducer("report_run", {
            params: Stdb.struct({}),
          }).spec,
          columns: Stdb.StdbFn.reducer("columns", {
            params: Stdb.struct({
              userId: Stdb.string(),
              userID: Stdb.string(),
            }),
          }).spec,
        },
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(InvalidModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "CanonicalNameCollision",
            path: ["relations"],
          }),
          expect.objectContaining({
            code: "CanonicalNameCollision",
            path: ["functions"],
          }),
          expect.objectContaining({
            code: "CanonicalNameCollision",
            path: ["reducers", "columns", "params"],
          }),
        ]),
      )
    }),
  )

  it.effect("skips native special type names during validation", () =>
    Effect.gen(function* () {
      const NativeSpecialsModule = {
        kind: "module" as const,
        name: "native_specials",
        settings: {},
        tables: {
          specials: Stdb.table("specials", {
            columns: {
              id: Stdb.string().primaryKey(),
              status: Stdb.literal("active"),
            },
          }),
        },
        views: {},
        reducers: {
          specials: Stdb.StdbFn.reducer("specials", {
            params: Stdb.struct({
              scheduleAt: Stdb.scheduleAt(),
              uuid: Stdb.uuid(),
              maybe: Stdb.option(Stdb.string()),
              result: Stdb.result(Stdb.string(), Stdb.string()),
            }),
          }).spec,
        },
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(NativeSpecialsModule))).toEqual([])
    }),
  )

  it.effect("skips canonical name validation under none policy", () =>
    Effect.gen(function* () {
      const NonePolicyModule = {
        kind: "module" as const,
        name: "none_policy",
        settings: {
          caseConversionPolicy: "none" as const,
        },
        tables: {
          user_table: Stdb.table("user_table", {
            columns: {
              user_id: Stdb.string().primaryKey(),
            },
            indexes: [Stdb.index("by_user", ["user_id"])],
          }),
        },
        views: {},
        reducers: {
          do_thing: Stdb.StdbFn.reducer("do_thing", {
            params: Stdb.struct({ created_at: Stdb.string() }),
          }).spec,
        },
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(NonePolicyModule))).toEqual([])
    }),
  )

  it.effect("reports repeated unsupported descriptors at each path", () =>
    Effect.gen(function* () {
      const raw = Schema.instanceOf(URL) as unknown as Stdb.AnyValueType
      const InvalidModule = {
        kind: "module" as const,
        name: "repeated_unsupported_type",
        settings: {},
        tables: {},
        views: {},
        reducers: {
          repeated_reducer: Stdb.StdbFn.reducer("repeated_reducer", {
            params: Stdb.struct({
              first: raw,
              second: raw,
            }),
          }).spec,
        },
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }

      expect(Stdb.validate(withWireNames(InvalidModule))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "UnsupportedTypeDescriptor",
            path: ["reducers", "repeated_reducer", "params", "first"],
          }),
          expect.objectContaining({
            code: "UnsupportedTypeDescriptor",
            path: ["reducers", "repeated_reducer", "params", "second"],
          }),
        ]),
      )
    }),
  )

  it.effect("throws tagged validation errors with aggregate diagnostics", () =>
    Effect.gen(function* () {
      const InvalidModule = {
        kind: "module" as const,
        name: "validation_error",
        settings: {},
        tables: {
          user: Stdb.table("user", {
            columns: {
              id: Stdb.string().primaryKey(),
            },
            indexes: [
              Stdb.index({
                name: "missing_index",
                columns: ["missing"],
              }),
            ],
          }),
        },
        views: {},
        reducers: {},
        procedures: {},
        httpHandlers: {},
        httpGroups: {},
        lifecycle: {},
      }
      const diagnostics = Stdb.validate(withWireNames(InvalidModule)).filter(
        (entry) => entry.severity === "error",
      )

      const exit = yield* Effect.exit(
        Effect.try({
          try: () => Stdb.assertValid(withWireNames(InvalidModule)),
          catch: (cause) =>
            cause instanceof Stdb.StdbValidationError
              ? cause
              : new TestEffectCallbackError({
                  operation:
                    "interop/effect-spacetimedb/unit/module-validation",
                  cause,
                }),
        }).pipe(
          Effect.catchTag("TestEffectCallbackError", (error) =>
            Effect.die(error),
          ),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) {
        return
      }

      const failure = Cause.findErrorOption(exit.cause)
      expect(Option.isSome(failure)).toBe(true)
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(Stdb.StdbValidationError)
        if (failure.value instanceof Stdb.StdbValidationError) {
          expect(failure.value.diagnostics).toEqual(diagnostics)
        }
      }
    }),
  )
})
