import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

class ExternalProbe extends Context.Service<
  ExternalProbe,
  {
    readonly value: string
  }
>()(
  "effect-spacetimedb/test/typecheck/sealed-builder-impls.typecheck/ExternalProbe",
) {}

const SealedModule = Stdb.StdbModule.make("sealed_builder_impls", {}).add(
  Stdb.StdbGroup.make("Runtime").add(
    Stdb.StdbFn.reducer("ping", {
      params: Stdb.struct({}),
    }),
  ),
)

const { Db } = SealedModule

const RuntimeLive = Stdb.StdbBuilder.group(SealedModule, "Runtime", {
  ping: () =>
    Effect.gen(function* () {
      const probe = yield* ExternalProbe
      void probe.value
    }),
})

// @ts-expect-error build requires a runtime when handlers require custom services.
void build(SealedModule, [RuntimeLive] as const)

void build(SealedModule, [RuntimeLive] as const, {
  runtime: Layer.succeed(ExternalProbe, { value: "ok" }),
})

// @ts-expect-error hand-rolled impls cannot satisfy the sealed builder brand.
void build(SealedModule, [{ groupName: "Runtime" }] as const)

// @ts-expect-error duplicate group implementations are rejected at build.
void build(SealedModule, [RuntimeLive, RuntimeLive] as const, {
  runtime: Layer.succeed(ExternalProbe, { value: "ok" }),
})

const WidenedRuntimeImpls = [RuntimeLive]

// @ts-expect-error builder impl arrays must stay readonly tuples.
void build(SealedModule, WidenedRuntimeImpls, {
  runtime: Layer.succeed(ExternalProbe, { value: "ok" }),
})

const CheckedServerContextOnly: Stdb.GroupCheckedHandlers<
  typeof SealedModule,
  "Runtime"
> = {
  ping: () =>
    Effect.gen(function* () {
      const db = yield* Db
      void db
    }),
}

const CheckedServerContextOnlyLive = Stdb.StdbBuilder.groupPrechecked(
  SealedModule,
  "Runtime",
  {
    ...CheckedServerContextOnly,
  },
)

const PublicRootBuilderImpls: ReadonlyArray<Stdb.AnyBuilderImpl> = [
  RuntimeLive,
  CheckedServerContextOnlyLive,
]
void PublicRootBuilderImpls

void build(SealedModule, [CheckedServerContextOnlyLive] as const)

const CheckedExternalOnly: Stdb.GroupCheckedHandlers<
  typeof SealedModule,
  "Runtime"
> = {
  // @ts-expect-error prechecked reducers cannot require external services; @effect-diagnostics-next-line missingEffectContext:off
  ping: () => ExternalProbe,
}
void CheckedExternalOnly

const CheckedMixedExternal: Stdb.GroupCheckedHandlers<
  typeof SealedModule,
  "Runtime"
> = {
  // @ts-expect-error prechecked reducers cannot mix server context and external services; @effect-diagnostics-next-line missingEffectContext:off
  ping: () => Effect.all([Db, ExternalProbe]),
}
void CheckedMixedExternal

const LifecycleGroupModule = Stdb.StdbModule.make(
  "sealed_lifecycle_group_impls",
  {},
).add(
  Stdb.StdbGroup.make("LifecycleRuntime").add(Stdb.StdbFn.clientDisconnected()),
)

const { Db: LifecycleDb } = LifecycleGroupModule

const CheckedLifecycleServerContextOnly: Stdb.GroupCheckedHandlers<
  typeof LifecycleGroupModule,
  "LifecycleRuntime"
> = {
  clientDisconnected: () =>
    Effect.gen(function* () {
      const db = yield* LifecycleDb
      void db
    }),
}

const CheckedLifecycleServerContextOnlyLive = Stdb.StdbBuilder.groupPrechecked(
  LifecycleGroupModule,
  "LifecycleRuntime",
  {
    ...CheckedLifecycleServerContextOnly,
  },
)

void build(LifecycleGroupModule, [
  CheckedLifecycleServerContextOnlyLive,
] as const)

const CheckedLifecycleExternalOnly: Stdb.GroupCheckedHandlers<
  typeof LifecycleGroupModule,
  "LifecycleRuntime"
> = {
  // @ts-expect-error prechecked lifecycle hooks cannot require external services; @effect-diagnostics-next-line missingEffectContext:off
  clientDisconnected: () => ExternalProbe,
}
void CheckedLifecycleExternalOnly
