import * as Stdb from "effect-spacetimedb"

export const cacheModule = (rotated: boolean) => {
  const columns = { id: Stdb.string().primaryKey() }
  const memory = Stdb.table("memory", {
    public: true,
    columns,
    cachePolicy: rotated ? "required_on_disk" : "required_in_memory",
  })
  const disk = Stdb.table("disk", {
    public: true,
    columns,
    cachePolicy: rotated ? "no_requirement" : "required_on_disk",
  })
  const flexible = Stdb.table("flexible", {
    public: true,
    columns,
    cachePolicy: rotated ? "required_in_memory" : "no_requirement",
  })
  const inherited = Stdb.table("inherited", { public: true, columns })
  return Stdb.Module.make("cache_policy_fixture", {
    settings: {
      tableCachePolicyDefault: rotated ? "no_requirement" : "required_on_disk",
    },
  })
    .addTables(memory, disk, flexible, inherited)
    .add(
      Stdb.Group.make("Storage").add(
        Stdb.Fn.reducer("record", {
          params: Stdb.struct({ id: Stdb.string() }),
        }),
      ),
    )
}
