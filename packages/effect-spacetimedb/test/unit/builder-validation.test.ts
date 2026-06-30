import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
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
type RuntimeImpl = Stdb.GroupImpl<BuilderErrorModuleType, "Runtime", unknown>

const groupFromRecord = Stdb.StdbBuilder.group as unknown as (
  module: BuilderErrorModuleType,
  name: "Runtime",
  handlers: Record<string, unknown>,
) => RuntimeImpl

const buildFromImpls = build as unknown as (
  module: BuilderErrorModuleType,
  impls: ReadonlyArray<RuntimeImpl>,
) => unknown

const pingHandler = Effect.fn(function* () {})
const lifecycleHandler = Effect.fn(function* () {})
const LegacyLifecycleGroupName = "Lifecycle"

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
          expect(failure.message).toBe("Endpoint not handled: ping")
          expect(failure.diagnostics).toEqual([
            expect.objectContaining({
              code: "EndpointNotHandled",
              path: ["groups", "Runtime", "ping"],
              message: "Endpoint not handled: ping",
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
        message: "Group implemented more than once: Runtime",
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

    expect(firstClassImpl.definitions.lifecycle).toEqual(
      legacyImpl.definitions.lifecycle,
    )
    expect(firstClassImpl.lifecycleSpecs).toEqual(
      LegacyLifecycleModule.spec.lifecycle,
    )
  })

  it("keeps empty lifecycle declarations empty", () => {
    const EmptyModule = Stdb.StdbModule.make("empty_lifecycle", {})
    const emptyLifecycle = Stdb.StdbBuilder.lifecycle(EmptyModule, {})

    expect(EmptyModule.spec.lifecycle).toEqual({})
    expect(emptyLifecycle.lifecycleSpecs).toEqual({})
    expect(emptyLifecycle.definitions).toEqual({})
  })

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
        build(OtherBuilderErrorModule, [runtimeLive]),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
      if (failure instanceof Stdb.StdbValidationError) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "UndeclaredGroupImpl",
            path: ["groups", "Runtime"],
            message:
              "Group Runtime implementation was built for a different module",
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
        build(TargetModule, [lifecycleLive]),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(Stdb.StdbValidationError)
      if (failure instanceof Stdb.StdbValidationError) {
        expect(failure.diagnostics).toEqual([
          expect.objectContaining({
            code: "UnknownEndpoint",
            path: ["lifecycle"],
            message:
              "Lifecycle implementation was built for a different module",
            severity: "error",
          }),
        ])
      }
    }),
  )
})
