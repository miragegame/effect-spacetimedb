import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { testViewRowsLength } from "../helpers/array-bounds"

const user = Stdb.table("view_context_user", {
  public: true,
  columns: {
    id: Stdb.string().primaryKey(),
    name: Stdb.string(),
  },
})

const ViewFunctions = Stdb.Group.make("Views")
  .add(
    Stdb.Fn.view("senderUsers", {
      returns: Stdb.array(user.row, testViewRowsLength),
    }),
  )
  .add(
    Stdb.Fn.anonymousView("allUsers", {
      returns: Stdb.array(user.row, testViewRowsLength),
    }),
  )

const ViewModule = Stdb.Module.make("view_context", {})
  .addTables(user)
  .add(ViewFunctions)

const { AnonymousViewCtx, Db, From, ReadonlyDb, ViewCtx } = ViewModule

const ViewsLive = Stdb.Builder.group(ViewModule, "Views", {
  senderUsers: Effect.fn(function* () {
    const ctx = yield* ViewCtx
    const from = yield* From
    const db = yield* ReadonlyDb

    void ctx.sender
    void from.view_context_user
    void db.view_context_user
    void db.view_context_user.count
    void db.view_context_user.id.find

    // @ts-expect-error readonly db must not expose table writes
    void db.view_context_user.insert

    // @ts-expect-error readonly db must not expose lookup writes
    void db.view_context_user.id.delete
    return []
  }),
  allUsers: Effect.fn(function* () {
    const ctx = yield* AnonymousViewCtx
    const from = yield* From

    void ctx.db
    void from.view_context_user
    return []
  }),
})

const InvalidAnonymousViewCtxLive = Stdb.Builder.group(
  ViewModule,
  "Views",
  // @ts-expect-error sender views must not access anonymous view context
  {
    senderUsers: Effect.fn(function* () {
      const ctx = yield* AnonymousViewCtx
      void ctx
      return []
    }),
    allUsers: () => Effect.succeed([]),
  },
)

const InvalidSenderViewDbLive = Stdb.Builder.group(
  ViewModule,
  "Views",
  // @ts-expect-error sender views must not depend on read-write Db
  {
    senderUsers: Effect.fn(function* () {
      const db = yield* Db
      void db
      return []
    }),
    allUsers: () => Effect.succeed([]),
  },
)

void ViewsLive
void InvalidAnonymousViewCtxLive
void InvalidSenderViewDbLive
