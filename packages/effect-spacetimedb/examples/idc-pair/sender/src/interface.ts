import * as Stdb from "effect-spacetimedb"
import { IdcPairInbox } from "../../receiver/src/inbox.ts"

// The interface carries no binding: the contract that imports it must stay
// importable outside a SpacetimeDB host, and the generated binding is not. The
// module entry (`index.ts`) pairs it with its binding for `build`.
export const PairInboxInterface = Stdb.RemoteInterface.make({
  name: "pair_inbox",
  group: IdcPairInbox,
})
