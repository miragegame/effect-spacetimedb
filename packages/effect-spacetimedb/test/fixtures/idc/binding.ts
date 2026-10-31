import * as Stdb from "effect-spacetimedb"
import { IdcFixtureInboxInterface } from "./interface.ts"
import idcFixtureInboxBinding from "./remote/idc_fixture_inbox/index.js"

// `remote/idc_fixture_inbox/` is native `spacetime generate --bindings module`
// output for the bundle of `receiver/entry.ts`, quarantined like a generated
// client (`generateReceiverArtifact`): `index.js` is that output bundled
// verbatim, `index.d.ts` names its receivers. `bun run codegen` regenerates it
// and `bun run codegen:check` fails when it no longer matches `inbox.ts`;
// never edit it.
//
// `index.js` imports `spacetimedb/server`, which loads only inside a
// SpacetimeDB host, so only code that builds the sender imports this file:
// its `build` takes `IdcFixtureInboxBinding` in `receiverBindings`.

export const IdcFixtureInboxBinding = Stdb.RemoteInterface.bind(
  IdcFixtureInboxInterface,
  idcFixtureInboxBinding,
)
