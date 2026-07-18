import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as EffectVitest from "@effect/vitest"
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

const BuilderErrorModule = Stdb.StdbModule.make("builder_errors", {}).add(
  Stdb.StdbGroup.make("Runtime").add(
    Stdb.StdbFn.reducer("ping", {
      params: Stdb.struct({}),
    }),
  ),
)

type BuilderErrorModuleType = typeof BuilderErrorModule
type RuntimeImpl = Stdb.GroupImpl<"Runtime", unknown>

const groupFromRecord = Stdb.StdbBuilder.group as unknown as (
  module: BuilderErrorModuleType,
  name: "Runtime",
  handlers: Record<string, unknown>,
) => RuntimeImpl

const groupWithArbitraryNameFromRecord = Stdb.StdbBuilder.group as unknown as (
  module: BuilderErrorModuleType,
  name: string,
  handlers: Record<string, unknown>,
) => RuntimeImpl

const buildFromImpls = build as unknown as (
  module: BuilderErrorModuleType,
  impls: ReadonlyArray<RuntimeImpl>,
) => unknown

const buildIgnoringModuleBrandRaw = build as unknown as (
  module: Stdb.AnyStdbModule,
  impls: ReadonlyArray<Stdb.AnyBuilderImpl>,
) => unknown

const buildIgnoringModuleBrand = (
  module: Stdb.AnyStdbModule,
  impls: ReadonlyArray<Stdb.AnyBuilderImpl>,
): void => {
  void buildIgnoringModuleBrandRaw(module, impls)
}

const handlersOfIgnoringModuleBrand = Stdb.StdbBuilder
  .handlersOf as unknown as (
  module: Stdb.AnyStdbModule,
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
  Stdb.StdbValidationError | UnexpectedBuilderAssemblyError
> =>
  Effect.try({
    try: evaluate,
    catch: (error) =>
      error instanceof Stdb.StdbValidationError
        ? error
        : new UnexpectedBuilderAssemblyError({ cause: error }),
  })

describe("builder validation diagnostics", (it) => {
  it.effect(
    "throws StdbValidationError with diagnostics for incomplete group assembly",
    () =>
      Effect.gen(function* () {
        const failure = yield* tryAssembly(() =>
          groupFromRecord(BuilderErrorModule, "Runtime", {}),
        ).pipe(Effect.flip)

        expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
        if (failure instanceof Stdb.StdbValidationError) {
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

        expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
        if (failure instanceof Stdb.StdbValidationError) {
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

        expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
        if (failure instanceof Stdb.StdbValidationError) {
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
      const runtimeLive = Stdb.StdbBuilder.group(
        BuilderErrorModule,
        "Runtime",
        {
          ping: pingHandler,
        },
      )

      const recovered = yield* tryAssembly(() =>
        buildFromImpls(BuilderErrorModule, [runtimeLive, runtimeLive]),
      ).pipe(
        Effect.as({
          recovered: false as const,
        }),
        Effect.catchTag("StdbValidationError", (error) =>
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
    const LegacyLifecycleModule = Stdb.StdbModule.make(
      "legacy_lifecycle",
      {},
    ).add(
      Stdb.StdbGroup.make(LegacyLifecycleGroupName).add(
        Stdb.StdbFn.clientDisconnected(),
      ),
    )
    const FirstClassLifecycleModule = Stdb.StdbModule.make(
      "first_class_lifecycle",
      {},
    )

    const legacyImpl = Stdb.StdbBuilder.group(
      LegacyLifecycleModule,
      LegacyLifecycleGroupName,
      {
        clientDisconnected: lifecycleHandler,
      },
    )
    const firstClassImpl = Stdb.StdbBuilder.lifecycle(
      FirstClassLifecycleModule,
      {
        clientDisconnected: lifecycleHandler,
      },
    )

    const legacyPlan = Stdb.StdbBuilder.plan(LegacyLifecycleModule, [
      legacyImpl,
    ])
    const firstClassPlan = Stdb.StdbBuilder.plan(FirstClassLifecycleModule, [
      firstClassImpl,
    ])

    expect(Object.keys(firstClassPlan.handlers.lifecycle ?? {})).toEqual(
      Object.keys(legacyPlan.handlers.lifecycle ?? {}),
    )
    expect(firstClassPlan.module.lifecycle).toEqual(legacyPlan.module.lifecycle)
  })

  it("builds declared lifecycle hooks implemented by first-class lifecycle impls", () => {
    const CallableGroup = Stdb.StdbGroup.make("Callable").add(
      Stdb.StdbFn.reducer("ping", {
        params: Stdb.struct({}),
      }),
    )
    const DeclaredLifecycleModule = Stdb.StdbModule.make(
      "declared_first_class_lifecycle",
      {
        lifecycle: {
          clientDisconnected: Stdb.StdbFn.clientDisconnected(),
        },
      },
    ).add(CallableGroup)
    const callableLive = Stdb.StdbBuilder.group(
      DeclaredLifecycleModule,
      "Callable",
      {
        ping: pingHandler,
      },
    )
    const lifecycleLive = Stdb.StdbBuilder.lifecycle(DeclaredLifecycleModule, {
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
      const DeclaredOnlyModule = Stdb.StdbModule.make(
        "declared_lifecycle_without_impl",
        {
          lifecycle: {
            init: Stdb.StdbFn.init(),
          },
        },
      )

      const failure = yield* tryAssembly(() =>
        Stdb.StdbBuilder.plan(DeclaredOnlyModule, []),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
      if (failure instanceof Stdb.StdbValidationError) {
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
    const DeclaredGroupedLifecycleModule = Stdb.StdbModule.make(
      "declared_grouped_lifecycle",
      {
        lifecycle: {
          clientDisconnected: Stdb.StdbFn.clientDisconnected(),
        },
      },
    ).add(
      Stdb.StdbGroup.make(LegacyLifecycleGroupName).add(
        Stdb.StdbFn.clientDisconnected(),
      ),
    )
    const legacyLive = Stdb.StdbBuilder.group(
      DeclaredGroupedLifecycleModule,
      LegacyLifecycleGroupName,
      {
        clientDisconnected: lifecycleHandler,
      },
    )

    const plan = Stdb.StdbBuilder.plan(DeclaredGroupedLifecycleModule, [
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
      const MismatchedLifecycleModule = Stdb.StdbModule.make(
        "declared_lifecycle_mismatch",
        {
          lifecycle: {
            clientDisconnected: Stdb.StdbFn.init(),
          },
        } as never,
      )

      const failure = yield* tryAssembly(() =>
        Stdb.StdbBuilder.plan(MismatchedLifecycleModule, []),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
      if (failure instanceof Stdb.StdbValidationError) {
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
    const EmptyModule = Stdb.StdbModule.make("empty_lifecycle", {})
    const emptyLifecycle = Stdb.StdbBuilder.lifecycle(EmptyModule, {})
    const plan = Stdb.StdbBuilder.plan(EmptyModule, [emptyLifecycle])

    expect(EmptyModule.spec.lifecycle).toEqual({})
    expect(plan.module.lifecycle).toEqual({})
    expect(plan.handlers.lifecycle).toBeUndefined()
  })

  it.effect(
    "rejects duplicate lifecycle hooks across legacy groups and first-class impls",
    () =>
      Effect.gen(function* () {
        const DuplicateLifecycleSurfaceModule = Stdb.StdbModule.make(
          "duplicate_lifecycle_surface",
          {},
        ).add(
          Stdb.StdbGroup.make(LegacyLifecycleGroupName).add(
            Stdb.StdbFn.clientDisconnected(),
          ),
        )
        const legacyLive = Stdb.StdbBuilder.group(
          DuplicateLifecycleSurfaceModule,
          LegacyLifecycleGroupName,
          {
            clientDisconnected: lifecycleHandler,
          },
        )
        const firstClassLive = Stdb.StdbBuilder.lifecycle(
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
              Stdb.StdbBuilder.plan(DuplicateLifecycleSurfaceModule, impls),
            ).pipe(Effect.flip)

            expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
            if (failure instanceof Stdb.StdbValidationError) {
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
          const LifecycleHttpModule = Stdb.StdbModule.make(
            "lifecycle_http_groups",
            {},
          ).add(
            Stdb.StdbGroup.make("Calls")
              .add(Stdb.StdbFn.reducer("refreshToken", {}))
              .add(
                Stdb.StdbFn.procedure("readToken", {
                  returns: Stdb.unit(),
                }),
              ),
            Stdb.StdbHttpGroup.make("Webhooks").add(
              Stdb.StdbHttp.post("rotateToken", "/server-tokens/rotate", {
                request: LifecycleHttpRequest,
                response: LifecycleHttpResponse,
              }),
            ),
          )
          const callsLive = Stdb.StdbBuilder.group(
            LifecycleHttpModule,
            "Calls",
            {
              refreshToken: lifecycleHandler,
              readToken: lifecycleHandler,
            },
          )
          const httpLive = Stdb.StdbBuilder.group(
            LifecycleHttpModule,
            "Webhooks",
            {
              rotateToken: lifecycleHttpHandler,
            },
          )
          const lifecycleLive = Stdb.StdbBuilder.lifecycle(
            LifecycleHttpModule,
            {
              init: lifecycleHandler,
            },
          )

          const plan = Stdb.StdbBuilder.plan(LifecycleHttpModule, [
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
          })
          expect(Object.keys(client.Calls.reducers)).toEqual(["refreshToken"])
          expect(Object.keys(client.Calls.procedures)).toEqual(["readToken"])
          expect(() => Stdb.toHttpApi(plan.module)).not.toThrow()
        },
        catch: (error) => new UnexpectedBuilderAssemblyError({ cause: error }),
      }).pipe(Effect.orDie),
  )

  it.effect(
    "rejects duplicate first-class lifecycle hook implementations",
    () =>
      Effect.gen(function* () {
        const DuplicateLifecycleModule = Stdb.StdbModule.make(
          "duplicate_lifecycle_impl",
          {},
        )
        const first = Stdb.StdbBuilder.lifecycle(DuplicateLifecycleModule, {
          init: lifecycleHandler,
        })
        const second = Stdb.StdbBuilder.lifecycle(DuplicateLifecycleModule, {
          init: lifecycleHandler,
        })

        const failure = yield* tryAssembly(() =>
          build(DuplicateLifecycleModule, [first, second]),
        ).pipe(Effect.flip)

        expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
        if (failure instanceof Stdb.StdbValidationError) {
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
      const OtherBuilderErrorModule = Stdb.StdbModule.make(
        "other_builder_errors",
        {},
      ).add(
        Stdb.StdbGroup.make("Runtime").add(
          Stdb.StdbFn.reducer("ping", {
            params: Stdb.struct({}),
          }),
        ),
      )
      const runtimeLive = Stdb.StdbBuilder.group(
        BuilderErrorModule,
        "Runtime",
        {
          ping: pingHandler,
        },
      )

      const failure = yield* tryAssembly(() =>
        buildIgnoringModuleBrand(OtherBuilderErrorModule, [runtimeLive]),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
      if (failure instanceof Stdb.StdbValidationError) {
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
    const HandlerAccessorModule = Stdb.StdbModule.make(
      "handler_accessor",
      {},
    ).add(
      Stdb.StdbGroup.make("Runtime").add(
        Stdb.StdbFn.reducer("ping", {
          params: Stdb.struct({}),
        }),
        Stdb.StdbFn.procedure("value", {
          returns: Stdb.string(),
        }),
      ),
    )
    const runtimeLive = Stdb.StdbBuilder.group(
      HandlerAccessorModule,
      "Runtime",
      {
        ping: pingHandler,
        value: valueHandler,
      },
    )

    const handlers = Stdb.StdbBuilder.handlersOf(
      HandlerAccessorModule,
      runtimeLive,
    )

    expect(Object.keys(handlers)).toEqual(["ping", "value"])
    expect(handlers.ping).toBe(pingHandler)
    expect(handlers.value).toBe(valueHandler)
  })

  it("exposes sealed lifecycle handlers through a typed accessor", () => {
    const HandlerAccessorModule = Stdb.StdbModule.make(
      "lifecycle_handler_accessor",
      {},
    )
    const lifecycleLive = Stdb.StdbBuilder.lifecycle(HandlerAccessorModule, {
      init: lifecycleHandler,
    })

    const handlers = Stdb.StdbBuilder.handlersOf(
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

      expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
      if (failure instanceof Stdb.StdbValidationError) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "InvalidBuilderImpl",
            path: ["groups", "Runtime"],
            message:
              "Builder implementation at impls[0] must be created by StdbBuilder.group, StdbBuilder.groupChecked, StdbBuilder.groupPrechecked, or StdbBuilder.lifecycle",
            severity: "error",
          }),
        ])
      }
    }),
  )

  it.effect("rejects unbranded impl values through handlersOf", () =>
    Effect.gen(function* () {
      const failure = yield* tryAssembly(() =>
        Stdb.StdbBuilder.handlersOf(BuilderErrorModule, {
          groupName: "Runtime",
        } as never),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
      if (failure instanceof Stdb.StdbValidationError) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "InvalidBuilderImpl",
            path: ["groups", "Runtime"],
            message:
              "Builder implementation at impls[0] must be created by StdbBuilder.group, StdbBuilder.groupChecked, StdbBuilder.groupPrechecked, or StdbBuilder.lifecycle",
            severity: "error",
          }),
        ])
      }
    }),
  )

  it.effect("rejects handlersOf impls built for another module", () =>
    Effect.gen(function* () {
      const OtherBuilderErrorModule = Stdb.StdbModule.make(
        "handler_accessor_other_builder_errors",
        {},
      ).add(
        Stdb.StdbGroup.make("Runtime").add(
          Stdb.StdbFn.reducer("ping", {
            params: Stdb.struct({}),
          }),
        ),
      )
      const runtimeLive = Stdb.StdbBuilder.group(
        BuilderErrorModule,
        "Runtime",
        {
          ping: pingHandler,
        },
      )

      const failure = yield* tryAssembly(() =>
        handlersOfIgnoringModuleBrand(OtherBuilderErrorModule, runtimeLive),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
      if (failure instanceof Stdb.StdbValidationError) {
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
      const OwnerModule = Stdb.StdbModule.make("lifecycle_owner", {})
      const TargetModule = Stdb.StdbModule.make("lifecycle_target", {})
      const lifecycleLive = Stdb.StdbBuilder.lifecycle(OwnerModule, {
        init: lifecycleHandler,
      })

      const failure = yield* tryAssembly(() =>
        buildIgnoringModuleBrand(TargetModule, [lifecycleLive]),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
      if (failure instanceof Stdb.StdbValidationError) {
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
