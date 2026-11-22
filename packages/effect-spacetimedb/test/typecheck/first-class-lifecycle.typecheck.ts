import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

const CallableGroup = Stdb.Group.make("Callable").add(
  Stdb.Fn.reducer("ping", {
    params: Stdb.struct({}),
  }),
)

const LifecycleModule = Stdb.Module.make("first_class_lifecycle", {
  lifecycle: {
    clientDisconnected: Stdb.Fn.clientDisconnected(),
  },
}).add(CallableGroup)

const { Db, Http, MutationCtx } = LifecycleModule

const CallableLive = Stdb.Builder.group(LifecycleModule, "Callable", {
  ping: () => Effect.void,
})

const LifecycleLive = Stdb.Builder.lifecycle(LifecycleModule, {
  clientDisconnected: Effect.fn(function* () {
    const db = yield* Db
    const ctx = yield* MutationCtx
    void db
    void ctx.connectionId
  }),
})

void build(LifecycleModule, [CallableLive, LifecycleLive])

const DerivedLifecycleModule = Stdb.Module.make("derived_lifecycle", {})
const DerivedLifecycleLive = Stdb.Builder.lifecycle(DerivedLifecycleModule, {
  clientDisconnected: () => Effect.void,
})

void build(DerivedLifecycleModule, [DerivedLifecycleLive])

const EmptyLifecycleModule = Stdb.Module.make("empty_lifecycle", {})

void build(EmptyLifecycleModule, [])

const ExtraLifecycleHook = Stdb.Builder.lifecycle(LifecycleModule, {
  clientDisconnected: () => Effect.void,
  // @ts-expect-error lifecycle handlers only accept fixed framework hook names.
  unknown: () => Effect.void,
})
void ExtraLifecycleHook

// @ts-expect-error lifecycle handlers must not require HTTP handler services.
const InvalidLifecycleScope = Stdb.Builder.lifecycle(LifecycleModule, {
  clientDisconnected: () => Http,
})
void InvalidLifecycleScope

const InvalidLifecycleDeclarationKey = Stdb.Module.make(
  "invalid_lifecycle_declaration_key",
  {
    lifecycle: {
      // @ts-expect-error lifecycle declarations only accept framework hook names.
      onConnect: Stdb.Fn.init(),
    },
  },
)
void InvalidLifecycleDeclarationKey

const InvalidLifecycleDeclarationHook = Stdb.Module.make(
  "invalid_lifecycle_declaration_hook",
  {
    lifecycle: {
      // @ts-expect-error lifecycle declarations must match their record key.
      clientDisconnected: Stdb.Fn.init(),
    },
  },
)
void InvalidLifecycleDeclarationHook

const InvalidLifecycleDeclarationDecl = Stdb.Module.make(
  "invalid_lifecycle_declaration_decl",
  {
    lifecycle: {
      // @ts-expect-error lifecycle declarations must match their record key.
      clientDisconnected: Stdb.Fn.init(),
    },
  },
)
void InvalidLifecycleDeclarationDecl
