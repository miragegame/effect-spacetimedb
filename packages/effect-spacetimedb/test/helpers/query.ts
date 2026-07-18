import { makeQueryBuilder, schema, t, table } from "spacetimedb"
import type { AnyModuleSpec } from "../../src/contract/module.ts"
import type { AnyTableSpec } from "../../src/contract/table.ts"
import type { ServerQueryRoot } from "../../src/query/types.ts"

const user = table(
  { name: "user", public: true },
  {
    id: t.string(),
    name: t.string(),
  },
)

const queries = makeQueryBuilder(
  schema({ user }).schemaType as unknown as Parameters<
    typeof makeQueryBuilder
  >[0],
)

export const makeUserQuery = <
  Module extends AnyModuleSpec & {
    readonly tables: { readonly user: AnyTableSpec }
  },
>(): ServerQueryRoot<Module>["user"] =>
  queries.user as unknown as ServerQueryRoot<Module>["user"]
