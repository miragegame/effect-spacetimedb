// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - interop tests intentionally exercise raw STDB schema constructors
import * as Effect from "effect/Effect"
import * as Server from "effect-spacetimedb/server"
import { FullModule } from "../fixtures/full-module"
import * as Stdb from "effect-spacetimedb"

const staticTagsUser = Stdb.table("static_tags_user", {
  columns: {
    id: Stdb.string().primaryKey(),
  },
})

const ModuleWithAccessors = Stdb.StdbModule.make(
  "static_tags_typecheck",
  {},
).addTables(staticTagsUser)

const projectedDb = ModuleWithAccessors.Db
const projectedReadonlyDb = ModuleWithAccessors.ReadonlyDb

declare const db: Server.DbService<typeof FullModule>
declare const readonlyDb: Server.ReadonlyDbService<typeof FullModule>

void projectedDb
void projectedReadonlyDb

void Effect.gen(function* () {
  const genericDb = yield* Server.Db
  const moduleDb = yield* projectedDb
  const genericReadonlyDb = yield* Server.ReadonlyDb
  const moduleReadonlyDb = yield* projectedReadonlyDb

  void genericDb
  void moduleDb
  void genericReadonlyDb
  void moduleReadonlyDb
  void moduleDb.static_tags_user.id.find
  void moduleReadonlyDb.static_tags_user.id.find

  // @ts-expect-error static Server.Db remains generic
  void genericDb.user.id.find

  // @ts-expect-error static Server.ReadonlyDb remains generic
  void genericReadonlyDb.user.id.find
}).pipe(
  Effect.provideService(Server.Db, db),
  Effect.provideService(Server.ReadonlyDb, readonlyDb),
)
