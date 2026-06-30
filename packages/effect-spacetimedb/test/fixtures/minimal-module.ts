import * as Stdb from "effect-spacetimedb"

const thing = Stdb.table("thing", {
  public: true,
  columns: {
    id: Stdb.u64().primaryKey(),
  },
})

export const MinimalModule = Stdb.StdbModule.make("minimal", {}).addTables(
  thing,
).spec
