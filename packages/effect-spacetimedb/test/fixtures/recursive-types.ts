import * as Stdb from "effect-spacetimedb"
import { testArrayLength } from "../helpers/array-bounds"

export type Tree = {
  readonly name: string
  readonly children: ReadonlyArray<Tree>
}

export const TreeType: ReturnType<typeof Stdb.lazy<Tree, unknown>> = Stdb.lazy(
  () =>
    Stdb.struct({
      name: Stdb.string(),
      children: Stdb.array(TreeType, testArrayLength),
    }),
)
