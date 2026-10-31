// First, before anything that loads Effect: the polyfills adapt the module
// host (see effect-spacetimedb/server-polyfills).
import "effect-spacetimedb/server-polyfills"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import { IdcPairSenderModule } from "./contract.ts"
import { PairInboxInterface } from "./interface.ts"
import { IdcPairSendsLive, IdcPairSettlesLive } from "./live.ts"
import pairInboxBinding from "./remote/pair_inbox/index.js"

// `remote/pair_inbox/` is the receiver binding native codegen generated from
// the receiver's bundle (`bun run codegen`), quarantined like a generated
// client: `index.js` is the native output, `index.d.ts` names its receivers.
// `bun run codegen:check` fails when it no longer matches the receiver.
// `index.js` imports `spacetimedb/server`, so only this entry, which runs
// inside the host, imports it. `bind` checks at load that it carries every
// receiver of the interface under its pinned wire name.
const compiled = build(
  IdcPairSenderModule,
  [IdcPairSendsLive, IdcPairSettlesLive],
  {
    runtimeMode: "dev-guarded",
    receiverBindings: [
      Stdb.RemoteInterface.bind(PairInboxInterface, pairInboxBinding),
    ],
  },
)

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
