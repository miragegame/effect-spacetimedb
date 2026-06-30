import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

const CallableGroup = Stdb.StdbGroup.make("Callable").add(
  Stdb.StdbFn.reducer("ping", {
    params: Stdb.struct({}),
  }),
)

const LifecycleModule = Stdb.StdbModule.make("first_class_lifecycle", {
  lifecycle: {
    clientDisconnected: Stdb.StdbFn.clientDisconnected().spec,
  },
}).add(CallableGroup)

const { Db, Http, MutationCtx } = LifecycleModule

const CallableLive = Stdb.StdbBuilder.group(LifecycleModule, "Callable", {
  ping: () => Effect.void,
})

const LifecycleLive = Stdb.StdbBuilder.lifecycle(LifecycleModule, {
  clientDisconnected: Effect.fn(function* () {
    const db = yield* Db
    const ctx = yield* MutationCtx
    void db
    void ctx.connectionId
  }),
})

void build(LifecycleModule, [CallableLive, LifecycleLive])

const DerivedLifecycleModule = Stdb.StdbModule.make("derived_lifecycle", {})
const DerivedLifecycleLive = Stdb.StdbBuilder.lifecycle(
  DerivedLifecycleModule,
  {
    clientDisconnected: () => Effect.void,
  },
)

void build(DerivedLifecycleModule, [DerivedLifecycleLive])

const EmptyLifecycleModule = Stdb.StdbModule.make("empty_lifecycle", {})

void build(EmptyLifecycleModule, [])

const ExtraLifecycleHook = Stdb.StdbBuilder.lifecycle(LifecycleModule, {
  clientDisconnected: () => Effect.void,
  // @ts-expect-error lifecycle handlers only accept fixed framework hook names.
  unknown: () => Effect.void,
})
void ExtraLifecycleHook

const InvalidLifecycleScope = Stdb.StdbBuilder.lifecycle(LifecycleModule, {
  // @ts-expect-error lifecycle handlers must not require HTTP handler services.
  clientDisconnected: () => Http,
})
void InvalidLifecycleScope

const InvalidLifecycleDeclarationKey = Stdb.StdbModule.make(
  "invalid_lifecycle_declaration_key",
  {
    lifecycle: {
      // @ts-expect-error lifecycle declarations only accept framework hook names.
      onConnect: Stdb.StdbFn.init().spec,
    },
  },
)
void InvalidLifecycleDeclarationKey

const InvalidLifecycleDeclarationHook = Stdb.StdbModule.make(
  "invalid_lifecycle_declaration_hook",
  {
    lifecycle: {
      // @ts-expect-error lifecycle declaration specs must match their record key.
      clientDisconnected: Stdb.StdbFn.init().spec,
    },
  },
)
void InvalidLifecycleDeclarationHook
