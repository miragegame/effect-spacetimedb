import * as StdbInternal from "effect-spacetimedb/testing/internal"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as EffectVitest from "@effect/vitest"
import { fixtureCallDurationMax } from "../helpers/transport-bounds"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

class UnexpectedBuilderAssemblyError extends Data.TaggedError(
  "UnexpectedBuilderAssemblyError",
)<{
  readonly cause: unknown
}> {}

const BuilderErrorModule = Stdb.Module.make("builder_errors", {}).add(
  Stdb.Group.make("Runtime").add(
    Stdb.Fn.reducer("ping", {
      params: Stdb.struct({}),
    }),
  ),
)

type BuilderErrorModuleType = typeof BuilderErrorModule
type RuntimeImpl = Stdb.GroupImpl<"Runtime", unknown>

const groupFromRecord = Stdb.Builder.group as unknown as (
  module: BuilderErrorModuleType,
  name: "Runtime",
  handlers: Record<string, unknown>,
) => RuntimeImpl

const groupWithArbitraryNameFromRecord = Stdb.Builder.group as unknown as (
  module: BuilderErrorModuleType,
  name: string,
  handlers: Record<string, unknown>,
) => RuntimeImpl

const buildFromImpls = build as unknown as (
  module: BuilderErrorModuleType,
  impls: ReadonlyArray<RuntimeImpl>,
) => unknown

const buildIgnoringModuleBrandRaw = build as unknown as (
  module: Stdb.AnyModule,
  impls: ReadonlyArray<Stdb.AnyBuilderImpl>,
) => unknown

const buildIgnoringModuleBrand = (
  module: Stdb.AnyModule,
  impls: ReadonlyArray<Stdb.AnyBuilderImpl>,
): void => {
  void buildIgnoringModuleBrandRaw(module, impls)
}

const handlersOfIgnoringModuleBrand = Stdb.Builder.handlersOf as unknown as (
  module: Stdb.AnyModule,
  impl: Stdb.AnyBuilderImpl,
) => Readonly<Record<string, unknown>>

const pingHandler = Effect.fn(function* () {})
const valueHandler = Effect.fn(function* () {
  return "value"
})
const lifecycleHandler = Effect.fn(function* () {})
const LegacyLifecycleGroupName = "Lifecycle"
const LifecycleHttpRequest = Schema.Struct({
  token: Schema.String,
})
const LifecycleHttpResponse = Schema.Struct({
  ok: Schema.Boolean,
})
type LifecycleHttpInput = Schema.Schema.Type<typeof LifecycleHttpRequest>
const lifecycleHttpHandler = Effect.fn(function* (_input: LifecycleHttpInput) {
  return { ok: true }
})

const tryAssembly = <A>(
  evaluate: () => A,
): Effect.Effect<
  A,
  Stdb.StdbValidationDefect | UnexpectedBuilderAssemblyError
> =>
  Effect.try({
    try: evaluate,
    catch: (error) =>
      error instanceof Stdb.StdbValidationDefect
        ? error
        : new UnexpectedBuilderAssemblyError({ cause: error }),
  })

describe("builder validation diagnostics", (it) => {
  it.effect(
    "throws StdbValidationDefect with diagnostics for incomplete group assembly",
    () =>
      Effect.gen(function* () {
        const failure = yield* tryAssembly(() =>
          groupFromRecord(BuilderErrorModule, "Runtime", {}),
        ).pipe(Effect.flip)

        expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
        if (failure instanceof Stdb.StdbValidationDefect) {
          expect(failure.message).toBe(
            "[EndpointNotHandled] groups.Runtime.ping: Group Runtime is missing a handler for endpoint ping. Available endpoints: ping",
          )
          expect(failure.diagnostics).toEqual([
            expect.objectContaining({
              code: "EndpointNotHandled",
              path: ["groups", "Runtime", "ping"],
              message:
                "Group Runtime is missing a handler for endpoint ping. Available endpoints: ping",
              severity: "error",
            }),
          ])
        }
      }),
  )

  it.effect(
    "lists declared groups when group assembly receives an unknown group",
    () =>
      Effect.gen(function* () {
        const failure = yield* tryAssembly(() =>
          groupWithArbitraryNameFromRecord(BuilderErrorModule, "Missing", {}),
        ).pipe(Effect.flip)

        expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
        if (failure instanceof Stdb.StdbValidationDefect) {
          expect(failure.message).toBe(
            "[UnknownGroup] groups.Missing: Module builder_errors has no group named Missing. Available groups: Runtime",
          )
          expect(failure.diagnostics).toEqual([
            expect.objectContaining({
              code: "UnknownGroup",
              path: ["groups", "Missing"],
              message:
                "Module builder_errors has no group named Missing. Available groups: Runtime",
              severity: "error",
            }),
          ])
        }
      }),
  )

  it.effect(
    "lists group endpoints when group assembly receives an unknown endpoint",
    () =>
      Effect.gen(function* () {
        const failure = yield* tryAssembly(() =>
          groupFromRecord(BuilderErrorModule, "Runtime", {
            missing: pingHandler,
          }),
        ).pipe(Effect.flip)

        expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
        if (failure instanceof Stdb.StdbValidationDefect) {
          expect(failure.message).toBe(
            "[UnknownEndpoint] groups.Runtime.missing: Group Runtime has no endpoint named missing. Available endpoints: ping",
          )
          expect(failure.diagnostics).toEqual([
            expect.objectContaining({
              code: "UnknownEndpoint",
              path: ["groups", "Runtime", "missing"],
              message:
                "Group Runtime has no endpoint named missing. Available endpoints: ping",
              severity: "error",
            }),
          ])
        }
      }),
  )

  it.effect("recovers builder assembly failures with Effect.catchTag", () =>
    Effect.gen(function* () {
      const runtimeLive = Stdb.Builder.group(BuilderErrorModule, "Runtime", {
        ping: pingHandler,
      })

      const recovered = yield* tryAssembly(() =>
        buildFromImpls(BuilderErrorModule, [runtimeLive, runtimeLive]),
      ).pipe(
        Effect.as({
          recovered: false as const,
        }),
        Effect.catchTag("StdbValidationDefect", (error) =>
          Effect.succeed({
            recovered: true as const,
            code: error.diagnostics[0]?.code,
            path: error.diagnostics[0]?.path,
            message: error.message,
          }),
        ),
      )

      expect(recovered).toEqual({
        recovered: true,
        code: "DuplicateGroupImpl",
        path: ["groups", "Runtime"],
        message:
          "[DuplicateGroupImpl] groups.Runtime: Group implemented more than once: Runtime",
      })
    }),
  )

  it("builds first-class lifecycle impls with legacy group-equivalent lifecycle definitions", () => {
    const LegacyLifecycleModule = Stdb.Module.make("legacy_lifecycle", {}).add(
      Stdb.Group.make(LegacyLifecycleGroupName).add(
        Stdb.Fn.clientDisconnected(),
      ),
    )
    const FirstClassLifecycleModule = Stdb.Module.make(
      "first_class_lifecycle",
      {},
    )

    const legacyImpl = Stdb.Builder.group(
      LegacyLifecycleModule,
      LegacyLifecycleGroupName,
      {
        clientDisconnected: lifecycleHandler,
      },
    )
    const firstClassImpl = Stdb.Builder.lifecycle(FirstClassLifecycleModule, {
      clientDisconnected: lifecycleHandler,
    })

    const legacyPlan = StdbInternal.planModule(LegacyLifecycleModule, [
      legacyImpl,
    ])
    const firstClassPlan = StdbInternal.planModule(FirstClassLifecycleModule, [
      firstClassImpl,
    ])

    expect(Object.keys(firstClassPlan.handlers.lifecycle ?? {})).toEqual(
      Object.keys(legacyPlan.handlers.lifecycle ?? {}),
    )
    expect(firstClassPlan.module.lifecycle).toEqual(legacyPlan.module.lifecycle)
  })

  it("builds declared lifecycle hooks implemented by first-class lifecycle impls", () => {
    const CallableGroup = Stdb.Group.make("Callable").add(
      Stdb.Fn.reducer("ping", {
        params: Stdb.struct({}),
      }),
    )
    const DeclaredLifecycleModule = Stdb.Module.make(
      "declared_first_class_lifecycle",
      {
        lifecycle: {
          clientDisconnected: Stdb.Fn.clientDisconnected(),
        },
      },
    ).add(CallableGroup)
    const callableLive = Stdb.Builder.group(
      DeclaredLifecycleModule,
      "Callable",
      {
        ping: pingHandler,
      },
    )
    const lifecycleLive = Stdb.Builder.lifecycle(DeclaredLifecycleModule, {
      clientDisconnected: lifecycleHandler,
    })

    const compiled = build(DeclaredLifecycleModule, [
      callableLive,
      lifecycleLive,
    ])

    expect(compiled.module.lifecycle).toEqual({
      clientDisconnected: {
        kind: "lifecycle",
        hook: "clientDisconnected",
      },
    })
    expect(compiled.exports.clientDisconnected).toBeDefined()
  })

  it.effect("rejects declared lifecycle hooks with no implementation", () =>
    Effect.gen(function* () {
      const DeclaredOnlyModule = Stdb.Module.make(
        "declared_lifecycle_without_impl",
        {
          lifecycle: {
            init: Stdb.Fn.init(),
          },
        },
      )

      const failure = yield* tryAssembly(() =>
        StdbInternal.planModule(DeclaredOnlyModule, []),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
      if (failure instanceof Stdb.StdbValidationDefect) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "LifecycleNotImplemented",
            path: ["lifecycle", "init"],
            message: "Lifecycle hook not implemented: init",
            severity: "error",
          }),
        ])
      }
    }),
  )

  it("builds declared lifecycle hooks implemented only by legacy grouped endpoints", () => {
    const DeclaredGroupedLifecycleModule = Stdb.Module.make(
      "declared_grouped_lifecycle",
      {
        lifecycle: {
          clientDisconnected: Stdb.Fn.clientDisconnected(),
        },
      },
    ).add(
      Stdb.Group.make(LegacyLifecycleGroupName).add(
        Stdb.Fn.clientDisconnected(),
      ),
    )
    const legacyLive = Stdb.Builder.group(
      DeclaredGroupedLifecycleModule,
      LegacyLifecycleGroupName,
      {
        clientDisconnected: lifecycleHandler,
      },
    )

    const plan = StdbInternal.planModule(DeclaredGroupedLifecycleModule, [
      legacyLive,
    ])

    expect(plan.module.lifecycle).toEqual({
      clientDisconnected: {
        kind: "lifecycle",
        hook: "clientDisconnected",
      },
    })
    expect(plan.handlers.lifecycle?.clientDisconnected).toBeDefined()
  })

  it.effect("rejects lifecycle declaration key/hook mismatches", () =>
    Effect.gen(function* () {
      const MismatchedLifecycleModule = Stdb.Module.make(
        "declared_lifecycle_mismatch",
        {
          lifecycle: {
            clientDisconnected: Stdb.Fn.init(),
          },
        } as never,
      )

      const failure = yield* tryAssembly(() =>
        StdbInternal.planModule(MismatchedLifecycleModule, []),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
      if (failure instanceof Stdb.StdbValidationDefect) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "LifecycleHookMismatch",
            path: ["lifecycle", "clientDisconnected", "hook"],
            message:
              "Lifecycle hook key clientDisconnected must match declared hook init",
            severity: "error",
          }),
        ])
      }
    }),
  )

  it("keeps empty lifecycle declarations empty", () => {
    const EmptyModule = Stdb.Module.make("empty_lifecycle", {})
    const emptyLifecycle = Stdb.Builder.lifecycle(EmptyModule, {})
    const plan = StdbInternal.planModule(EmptyModule, [emptyLifecycle])

    expect(EmptyModule.spec.lifecycle).toEqual({})
    expect(plan.module.lifecycle).toEqual({})
    expect(plan.handlers.lifecycle).toBeUndefined()
  })

  it.effect(
    "rejects duplicate lifecycle hooks across legacy groups and first-class impls",
    () =>
      Effect.gen(function* () {
        const DuplicateLifecycleSurfaceModule = Stdb.Module.make(
          "duplicate_lifecycle_surface",
          {},
        ).add(
          Stdb.Group.make(LegacyLifecycleGroupName).add(
            Stdb.Fn.clientDisconnected(),
          ),
        )
        const legacyLive = Stdb.Builder.group(
          DuplicateLifecycleSurfaceModule,
          LegacyLifecycleGroupName,
          {
            clientDisconnected: lifecycleHandler,
          },
        )
        const firstClassLive = Stdb.Builder.lifecycle(
          DuplicateLifecycleSurfaceModule,
          {
            clientDisconnected: lifecycleHandler,
          },
        )

        yield* Effect.forEach(
          [
            [legacyLive, firstClassLive],
            [firstClassLive, legacyLive],
          ] as const,
          Effect.fn(function* (impls) {
            const failure = yield* tryAssembly(() =>
              StdbInternal.planModule(DuplicateLifecycleSurfaceModule, impls),
            ).pipe(Effect.flip)

            expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
            if (failure instanceof Stdb.StdbValidationDefect) {
              expect(failure.diagnostics).toEqual([
                expect.objectContaining({
                  code: "DuplicateCallableName",
                  path: ["lifecycle", "clientDisconnected"],
                  message:
                    "Lifecycle hook implemented more than once: clientDisconnected",
                  severity: "error",
                }),
              ])
            }
          }),
        )
      }),
  )

  it.effect(
    "preserves all group metadata when lifecycle impls extend a module spec",
    () =>
      Effect.try({
        try: () => {
          const LifecycleHttpModule = Stdb.Module.make(
            "lifecycle_http_groups",
            {},
          ).add(
            Stdb.Group.make("Calls")
              .add(Stdb.Fn.reducer("refreshToken", {}))
              .add(
                Stdb.Fn.procedure("readToken", {
                  returns: Stdb.unit(),
                }),
              ),
            Stdb.HttpGroup.make("Webhooks").add(
              Stdb.Http.post("rotateToken", "/server-tokens/rotate", {
                request: LifecycleHttpRequest,
                response: LifecycleHttpResponse,
              }),
            ),
          )
          const callsLive = Stdb.Builder.group(LifecycleHttpModule, "Calls", {
            refreshToken: lifecycleHandler,
            readToken: lifecycleHandler,
          })
          const httpLive = Stdb.Builder.group(LifecycleHttpModule, "Webhooks", {
            rotateToken: lifecycleHttpHandler,
          })
          const lifecycleLive = Stdb.Builder.lifecycle(LifecycleHttpModule, {
            init: lifecycleHandler,
          })

          const plan = StdbInternal.planModule(LifecycleHttpModule, [
            callsLive,
            httpLive,
            lifecycleLive,
          ])

          expect(plan.module.reducerGroups).toEqual({
            refreshToken: "Calls",
          })
          expect(plan.module.procedureGroups).toEqual({
            readToken: "Calls",
          })
          expect(plan.module.httpGroups).toEqual({
            rotateToken: "Webhooks",
          })
          const client = Stdb.project(plan.module).client.http.make({
            uri: "http://localhost:3000",
            databaseName: "lifecycle_http_groups",
            callDurationMax: fixtureCallDurationMax,
          })
          expect(Object.keys(client.groups.Calls.reducers)).toEqual([
            "refreshToken",
          ])
          expect(Object.keys(client.groups.Calls.procedures)).toEqual([
            "readToken",
          ])
          expect(() => Stdb.toHttpApi(plan.module)).not.toThrow()
        },
        catch: (error) => new UnexpectedBuilderAssemblyError({ cause: error }),
      }).pipe(Effect.orDie),
  )

  it.effect(
    "rejects duplicate first-class lifecycle hook implementations",
    () =>
      Effect.gen(function* () {
        const DuplicateLifecycleModule = Stdb.Module.make(
          "duplicate_lifecycle_impl",
          {},
        )
        const first = Stdb.Builder.lifecycle(DuplicateLifecycleModule, {
          init: lifecycleHandler,
        })
        const second = Stdb.Builder.lifecycle(DuplicateLifecycleModule, {
          init: lifecycleHandler,
        })

        const failure = yield* tryAssembly(() =>
          build(DuplicateLifecycleModule, [first, second]),
        ).pipe(Effect.flip)

        expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
        if (failure instanceof Stdb.StdbValidationDefect) {
          expect(failure.diagnostics).toEqual([
            expect.objectContaining({
              code: "DuplicateCallableName",
              path: ["lifecycle", "init"],
              message: "Lifecycle hook implemented more than once: init",
              severity: "error",
            }),
          ])
        }
      }),
  )

  it.effect("rejects group impls built for another module", () =>
    Effect.gen(function* () {
      const OtherBuilderErrorModule = Stdb.Module.make(
        "other_builder_errors",
        {},
      ).add(
        Stdb.Group.make("Runtime").add(
          Stdb.Fn.reducer("ping", {
            params: Stdb.struct({}),
          }),
        ),
      )
      const runtimeLive = Stdb.Builder.group(BuilderErrorModule, "Runtime", {
        ping: pingHandler,
      })

      const failure = yield* tryAssembly(() =>
        buildIgnoringModuleBrand(OtherBuilderErrorModule, [runtimeLive]),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
      if (failure instanceof Stdb.StdbValidationDefect) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "UndeclaredGroupImpl",
            path: ["groups", "Runtime"],
            message:
              'Group "Runtime" implementation was built for module "builder_errors" but passed to build of "other_builder_errors"',
            severity: "error",
          }),
        ])
      }
    }),
  )

  it("exposes sealed group handlers through a typed accessor", () => {
    const HandlerAccessorModule = Stdb.Module.make("handler_accessor", {}).add(
      Stdb.Group.make("Runtime").add(
        Stdb.Fn.reducer("ping", {
          params: Stdb.struct({}),
        }),
        Stdb.Fn.procedure("value", {
          returns: Stdb.string(),
        }),
      ),
    )
    const runtimeLive = Stdb.Builder.group(HandlerAccessorModule, "Runtime", {
      ping: pingHandler,
      value: valueHandler,
    })

    const handlers = Stdb.Builder.handlersOf(HandlerAccessorModule, runtimeLive)

    expect(Object.keys(handlers)).toEqual(["ping", "value"])
    expect(handlers.ping).toBe(pingHandler)
    expect(handlers.value).toBe(valueHandler)
  })

  it("exposes sealed lifecycle handlers through a typed accessor", () => {
    const HandlerAccessorModule = Stdb.Module.make(
      "lifecycle_handler_accessor",
      {},
    )
    const lifecycleLive = Stdb.Builder.lifecycle(HandlerAccessorModule, {
      init: lifecycleHandler,
    })

    const handlers = Stdb.Builder.handlersOf(
      HandlerAccessorModule,
      lifecycleLive,
    )

    expect(Object.keys(handlers)).toEqual(["init"])
    expect(handlers.init).toBe(lifecycleHandler)
  })

  it.effect("rejects unbranded impl values through build", () =>
    Effect.gen(function* () {
      const failure = yield* tryAssembly(() =>
        build(BuilderErrorModule, [{ groupName: "Runtime" }] as never),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
      if (failure instanceof Stdb.StdbValidationDefect) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "InvalidBuilderImpl",
            path: ["groups", "Runtime"],
            message:
              "Builder implementation at impls[0] must be created by Builder.group, Builder.groupPrechecked, or Builder.lifecycle",
            severity: "error",
          }),
        ])
      }
    }),
  )

  it.effect("rejects unbranded impl values through handlersOf", () =>
    Effect.gen(function* () {
      const failure = yield* tryAssembly(() =>
        Stdb.Builder.handlersOf(BuilderErrorModule, {
          groupName: "Runtime",
        } as never),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
      if (failure instanceof Stdb.StdbValidationDefect) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "InvalidBuilderImpl",
            path: ["groups", "Runtime"],
            message:
              "Builder implementation at impls[0] must be created by Builder.group, Builder.groupPrechecked, or Builder.lifecycle",
            severity: "error",
          }),
        ])
      }
    }),
  )

  it.effect("rejects handlersOf impls built for another module", () =>
    Effect.gen(function* () {
      const OtherBuilderErrorModule = Stdb.Module.make(
        "handler_accessor_other_builder_errors",
        {},
      ).add(
        Stdb.Group.make("Runtime").add(
          Stdb.Fn.reducer("ping", {
            params: Stdb.struct({}),
          }),
        ),
      )
      const runtimeLive = Stdb.Builder.group(BuilderErrorModule, "Runtime", {
        ping: pingHandler,
      })

      const failure = yield* tryAssembly(() =>
        handlersOfIgnoringModuleBrand(OtherBuilderErrorModule, runtimeLive),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
      if (failure instanceof Stdb.StdbValidationDefect) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "UndeclaredGroupImpl",
            path: ["groups", "Runtime"],
            message:
              'Group "Runtime" implementation was built for module "builder_errors" but passed to build of "handler_accessor_other_builder_errors"',
            severity: "error",
          }),
        ])
      }
    }),
  )

  it.effect("rejects lifecycle impls built for another module", () =>
    Effect.gen(function* () {
      const OwnerModule = Stdb.Module.make("lifecycle_owner", {})
      const TargetModule = Stdb.Module.make("lifecycle_target", {})
      const lifecycleLive = Stdb.Builder.lifecycle(OwnerModule, {
        init: lifecycleHandler,
      })

      const failure = yield* tryAssembly(() =>
        buildIgnoringModuleBrand(TargetModule, [lifecycleLive]),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationDefect)
      if (failure instanceof Stdb.StdbValidationDefect) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "UndeclaredLifecycleImpl",
            path: ["lifecycle"],
            message:
              'Lifecycle implementation was built for module "lifecycle_owner" but passed to build of "lifecycle_target"',
            severity: "error",
          }),
        ])
      }
    }),
  )
})
