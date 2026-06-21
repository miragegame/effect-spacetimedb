// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - interop tests intentionally exercise raw STDB schema constructors
import * as Stdb from "effect-spacetimedb"

export type Tree = {
  readonly name: string
  readonly children: ReadonlyArray<Tree>
}

export const TreeType: ReturnType<typeof Stdb.lazy<Tree, unknown>> = Stdb.lazy(
  () =>
    Stdb.struct({
      name: Stdb.string(),
      children: Stdb.array(TreeType),
    }),
)
