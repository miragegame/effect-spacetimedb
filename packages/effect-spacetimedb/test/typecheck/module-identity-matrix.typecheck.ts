import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as Server from "effect-spacetimedb/server"
import { build } from "effect-spacetimedb/server-compiler"
import type { Assert, IsEqual, RequirementsOf } from "./helpers"

const IdentityIdSchema = Schema.String.pipe(Schema.brand("IdentityMatrixId"))
type IdentityId = typeof IdentityIdSchema.Type
const IdentityId = Stdb.string(IdentityIdSchema)

const identityUser = Stdb.table("module_identity_user", {
  columns: {
    id: IdentityId.primaryKey(),
  },
})

const IdentityCore = Stdb.StdbGroup.make("Core")
  .add(
    Stdb.StdbFn.reducer("write", {
      params: Stdb.struct({ id: IdentityId }),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("read", {
      params: Stdb.struct({ id: IdentityId }),
      returns: Stdb.option(identityUser.row),
    }),
  )
  .add(
    Stdb.StdbFn.view("self", {
      returns: Stdb.array(identityUser.row),
    }),
  )
  .add(
    Stdb.StdbFn.anonymousView("all", {
      returns: Stdb.array(identityUser.row),
    }),
  )
  .add(Stdb.StdbFn.init())

const IdentityHttpRequest = Schema.Struct({
  id: IdentityIdSchema,
})
const IdentityHttpResponse = Schema.Struct({
  ok: Schema.Boolean,
})

const IdentityHttp = Stdb.StdbHttpGroup.make("Http").add(
  Stdb.StdbHttp.post("rotate", "/rotate", {
    request: IdentityHttpRequest,
    response: IdentityHttpResponse,
  }),
)

const ModuleA = Stdb.StdbModule.make("module_identity_a", {})
  .addTables(identityUser)
  .add(IdentityCore)
  .add(IdentityHttp)

const ModuleB = Stdb.StdbModule.make("module_identity_b", {})
  .addTables(identityUser)
  .add(IdentityCore)
  .add(IdentityHttp)

const {
  Db: ADb,
  ReadonlyDb: AReadonlyDb,
  From: AFrom,
  Tx: ATx,
  withTx: AWithTx,
  HttpTx: AHttpTx,
  ReducerCtx: AReducerCtx,
  MutationCtx: AMutationCtx,
} = ModuleA

const {
  Db: BDb,
  ReadonlyDb: BReadonlyDb,
  From: BFrom,
  Http: BHttp,
  HttpTx: BHttpTx,
  MutationCtx: BMutationCtx,
  ProcedureCtx: BProcedureCtx,
  ReducerCtx: BReducerCtx,
  Tx: BTx,
  TxCtx: BTxCtx,
  ViewCtx: BViewCtx,
  AnonymousViewCtx: BAnonymousViewCtx,
  withTx: BWithTx,
} = ModuleB

class MatrixExternalService extends Context.Service<
  MatrixExternalService,
  {
    readonly value: string
  }
>()(
  "effect-spacetimedb/test/typecheck/module-identity-matrix.typecheck/MatrixExternalService",
) {}

const coreHandlers = {
  write: Effect.fn(function* ({ id }) {
    const db = yield* BDb
    const ctx = yield* BReducerCtx
    const mutation = yield* BMutationCtx
    void ctx.sender
    void ctx.databaseIdentity
    void mutation.databaseIdentity
    void mutation.identity
    yield* db.module_identity_user.insert({ id })
  }),
  read: Effect.fn(function* ({ id }) {
    const http = yield* BHttp
    const ctx = yield* BProcedureCtx
    const tx = yield* BTx
    void http.fetch
    void ctx.sender
    return yield* tx.run(
      Effect.gen(function* () {
        const db = yield* BDb
        const txCtx = yield* BTxCtx
        const mutation = yield* BMutationCtx
        void txCtx.timestamp
        void mutation.random
        return yield* db.module_identity_user.id.find(id)
      }),
    )
  }),
  self: () =>
    Effect.gen(function* () {
      const db = yield* BReadonlyDb
      const from = yield* BFrom
      const ctx = yield* BViewCtx
      void from.module_identity_user
      void ctx.sender
      return yield* db.module_identity_user.toArray()
    }),
  all: () =>
    Effect.gen(function* () {
      const db = yield* BReadonlyDb
      const from = yield* BFrom
      const ctx = yield* BAnonymousViewCtx
      void from.module_identity_user
      void ctx
      return yield* db.module_identity_user.toArray()
    }),
  init: () =>
    Effect.gen(function* () {
      const db = yield* BDb
      const mutation = yield* BMutationCtx
      void db.module_identity_user
      void mutation.senderAuth
    }),
} satisfies Stdb.GroupCheckedHandlers<typeof ModuleB, "Core">

const CoreLiveA = Stdb.StdbBuilder.groupPrechecked(ModuleA, "Core", {
  write: Effect.fn(function* ({ id }) {
    const db = yield* ADb
    yield* db.module_identity_user.insert({ id })
  }),
  read: Effect.fn(function* ({ id }) {
    const tx = yield* ATx
    return yield* tx.run(
      Effect.gen(function* () {
        const db = yield* ADb
        return yield* db.module_identity_user.id.find(id)
      }),
    )
  }),
  self: () =>
    Effect.gen(function* () {
      const db = yield* AReadonlyDb
      return yield* db.module_identity_user.toArray()
    }),
  all: () => Effect.succeed([]),
  init: () => Effect.void,
})
void CoreLiveA

const CoreLiveB = Stdb.StdbBuilder.groupPrechecked(ModuleB, "Core", {
  ...coreHandlers,
})

const HttpLiveB = Stdb.StdbBuilder.group(ModuleB, "Http", {
  rotate: Effect.fn(function* ({ id }) {
    const httpTx = yield* BHttpTx
    return yield* httpTx.run(
      Effect.gen(function* () {
        const db = yield* BDb
        void (yield* db.module_identity_user.id.find(id))
        return { ok: true }
      }),
    )
  }),
})

void build(ModuleB, [CoreLiveB, HttpLiveB] as const)

const PrecheckedCoreImpl: Stdb.GroupImpl<"Core", never, "module_identity_b"> =
  CoreLiveB
void build(ModuleB, [PrecheckedCoreImpl, HttpLiveB] as const)

const TwoArgGroupImpl: Stdb.GroupImpl<"Core", never> = CoreLiveB
void TwoArgGroupImpl

const LifecycleModule = Stdb.StdbModule.make("module_identity_lifecycle", {})
const LifecycleLive = Stdb.StdbBuilder.lifecycle(LifecycleModule, {
  init: () => Effect.void,
})
const lifecycleHandlers = Stdb.StdbBuilder.handlersOf(
  LifecycleModule,
  LifecycleLive,
)
void lifecycleHandlers.init

// @ts-expect-error handlersOf must reject implementations built for another module.
void Stdb.StdbBuilder.handlersOf(ModuleB, CoreLiveA)

const buildWithGenericModule = <M extends Stdb.AnyStdbModule>(module: M) =>
  // @ts-expect-error generic helper module widening must not turn off impl identity validation.
  build(module, [CoreLiveA] as const)
void buildWithGenericModule

const CrossModuleGroupInline = Stdb.StdbBuilder.group(
  ModuleB,
  "Core",
  // @ts-expect-error group() inline records reject cross-module accessors.
  {
    ...coreHandlers,
    write: () => ADb,
  },
)
void CrossModuleGroupInline

const CrossModuleAnnotatedRecord: Stdb.GroupCheckedHandlers<
  typeof ModuleB,
  "Core"
> = {
  ...coreHandlers,
  // @ts-expect-error annotated handler records preserve both module brands; @effect-diagnostics-next-line missingEffectContext:off
  write: () => ADb,
}
void CrossModuleAnnotatedRecord

const CrossModulePrecheckedInline = Stdb.StdbBuilder.groupPrechecked(
  ModuleB,
  "Core",
  // @ts-expect-error groupPrechecked() inline records reject cross-module accessors.
  {
    ...coreHandlers,
    write: () => ADb,
  },
)
void CrossModulePrecheckedInline

const PrecheckedExternalInline = Stdb.StdbBuilder.groupPrechecked(
  ModuleB,
  "Core",
  // @ts-expect-error groupPrechecked() inline records cannot erase external services.
  {
    ...coreHandlers,
    write: () => MatrixExternalService,
  },
)
void PrecheckedExternalInline

const CrossModuleReadonlyDb = Stdb.StdbBuilder.group(
  ModuleB,
  "Core",
  // @ts-expect-error ReadonlyDb carries module identity in view handlers.
  {
    ...coreHandlers,
    self: () =>
      Effect.gen(function* () {
        const db = yield* AReadonlyDb
        return yield* db.module_identity_user.toArray()
      }),
  },
)
void CrossModuleReadonlyDb

const CrossModuleFrom = Stdb.StdbBuilder.group(
  ModuleB,
  "Core",
  // @ts-expect-error From carries module identity in view handlers.
  {
    ...coreHandlers,
    self: () =>
      Effect.gen(function* () {
        const from = yield* AFrom
        void from.module_identity_user
        return []
      }),
  },
)
void CrossModuleFrom

const CrossModuleCtx = Stdb.StdbBuilder.group(
  ModuleB,
  "Core",
  // @ts-expect-error request context accessors carry module identity.
  {
    ...coreHandlers,
    write: () =>
      Effect.gen(function* () {
        const ctx = yield* AReducerCtx
        void ctx.sender
      }),
  },
)
void CrossModuleCtx

const CrossModuleTxAccessor = Stdb.StdbBuilder.group(
  ModuleB,
  "Core",
  // @ts-expect-error Tx runner accessor carries module identity.
  {
    ...coreHandlers,
    read: () =>
      Effect.gen(function* () {
        const tx = yield* ATx
        return yield* tx.run(Effect.void).pipe(Effect.as(undefined))
      }),
  },
)
void CrossModuleTxAccessor

const CrossModuleWithTx = Stdb.StdbBuilder.group(
  ModuleB,
  "Core",
  // @ts-expect-error withTx carries module identity in its residual runner.
  {
    ...coreHandlers,
    read: () => AWithTx(Effect.void).pipe(Effect.as(undefined)),
  },
)
void CrossModuleWithTx

const CrossModuleHttpTxAccessor = Stdb.StdbBuilder.group(
  ModuleB,
  "Http",
  // @ts-expect-error HttpTx accessor carries module identity in HTTP handlers.
  {
    rotate: () =>
      Effect.gen(function* () {
        const httpTx = yield* AHttpTx
        return yield* httpTx.run(Effect.succeed({ ok: true }))
      }),
  },
)
void CrossModuleHttpTxAccessor

// @ts-expect-error Tx.run rejects Db from another module.
const CrossDbInsideTxRun = Stdb.StdbBuilder.group(ModuleB, "Core", {
  ...coreHandlers,
  read: () =>
    Effect.gen(function* () {
      const tx = yield* BTx
      return yield* tx.run(
        // @ts-expect-error Tx.run rejects Db from another module.
        Effect.gen(function* () {
          yield* ADb
          return undefined
        }),
      )
    }),
})
void CrossDbInsideTxRun

// @ts-expect-error Tx.run rejects MutationCtx from another module.
const CrossMutationCtxInsideTxRun = Stdb.StdbBuilder.group(ModuleB, "Core", {
  ...coreHandlers,
  read: () =>
    Effect.gen(function* () {
      const tx = yield* BTx
      return yield* tx.run(
        // @ts-expect-error Tx.run rejects MutationCtx from another module.
        Effect.gen(function* () {
          yield* AMutationCtx
          return undefined
        }),
      )
    }),
})
void CrossMutationCtxInsideTxRun

// @ts-expect-error module withTx rejects Db from another module.
const CrossDbInsideWithTx = Stdb.StdbBuilder.group(ModuleB, "Core", {
  ...coreHandlers,
  read: () =>
    BWithTx(
      // @ts-expect-error module withTx rejects Db from another module.
      Effect.gen(function* () {
        yield* ADb
        return undefined
      }),
    ),
})
void CrossDbInsideWithTx

// @ts-expect-error module withTx rejects MutationCtx from another module.
const CrossMutationCtxInsideWithTx = Stdb.StdbBuilder.group(ModuleB, "Core", {
  ...coreHandlers,
  read: () =>
    BWithTx(
      // @ts-expect-error module withTx rejects MutationCtx from another module.
      Effect.gen(function* () {
        yield* AMutationCtx
        return undefined
      }),
    ),
})
void CrossMutationCtxInsideWithTx

// @ts-expect-error HttpTx.run rejects Db from another module.
const CrossDbInsideHttpTxRun = Stdb.StdbBuilder.group(ModuleB, "Http", {
  rotate: () =>
    Effect.gen(function* () {
      const httpTx = yield* BHttpTx
      return yield* httpTx.run(
        // @ts-expect-error HttpTx.run rejects Db from another module.
        Effect.gen(function* () {
          yield* ADb
          return { ok: true }
        }),
      )
    }),
})
void CrossDbInsideHttpTxRun

const reducerEffectWithBrandedRequirements = Effect.gen(function* () {
  const db = yield* BDb
  const ctx = yield* BReducerCtx
  const mutation = yield* BMutationCtx
  void db.module_identity_user
  void ctx.sender
  void ctx.databaseIdentity
  void mutation.databaseIdentity
  void mutation.identity
})

declare const rawDb: Server.DbService<(typeof ModuleB)["spec"]>
declare const rawReducerCtx: Server.ReducerCtxService<(typeof ModuleB)["spec"]>
declare const rawMutationCtx: Server.MutationCtxService<
  (typeof ModuleB)["spec"]
>

const providedReducerEffect = reducerEffectWithBrandedRequirements.pipe(
  Effect.provideService(Server.Db, rawDb),
  Effect.provideService(Server.ReducerCtx, rawReducerCtx),
  Effect.provideService(Server.MutationCtx, rawMutationCtx),
)

type _ProvisioningDischargesBrandedRequirements = Assert<
  IsEqual<RequirementsOf<typeof providedReducerEffect>, never>
>
