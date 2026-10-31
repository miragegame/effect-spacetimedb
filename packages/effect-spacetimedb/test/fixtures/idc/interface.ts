import * as Stdb from "effect-spacetimedb"
import { IdcFixtureInbox } from "./inbox.ts"

// The interface carries no binding, so the sender's contract stays importable
// outside a SpacetimeDB host; `binding.ts` pairs it with its binding for the
// sender's `build`.

export const IdcFixtureInboxInterface = Stdb.RemoteInterface.make({
  name: "idc_fixture_inbox",
  group: IdcFixtureInbox,
})

export type IdcFixtureInboxPeer = Stdb.PeerIdentity<
  typeof IdcFixtureInboxInterface
>
