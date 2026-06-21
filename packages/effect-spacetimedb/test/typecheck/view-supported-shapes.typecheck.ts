import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

const ViewString = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

const ViewsGroup = Stdb.StdbGroup.make("Views")
  .add(
    Stdb.StdbFn.anonymousView("allUsers", {
      public: true,
      returns: Stdb.array(
        Stdb.struct({
          id: ViewString,
          name: ViewString,
        }),
      ),
    }),
  )
  .add(
    Stdb.StdbFn.view("self_user", {
      public: false,
      returns: Stdb.option(
        Stdb.struct({
          id: ViewString,
          name: ViewString,
        }),
      ),
    }),
  )

const user = Stdb.table("user", {
  public: true,
  columns: {
    id: ViewString.primaryKey(),
    name: ViewString,
  },
})

const ViewsModule = Stdb.StdbModule.make("supported_views", {})
  .addTables(user)
  .add(ViewsGroup).spec

void ViewsModule.views.allUsers
void ViewsModule.views.self_user
