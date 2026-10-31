// First, before anything that loads Effect: the polyfills adapt the module
// host (see effect-spacetimedb/server-polyfills).
import "effect-spacetimedb/server-polyfills"
import { build } from "effect-spacetimedb/server-compiler"
import { IdcPairReceiverModule } from "./contract.ts"
import { IdcPairInboxLive } from "./live.ts"

const compiled = build(IdcPairReceiverModule, [IdcPairInboxLive], {
  runtimeMode: "dev-guarded",
})

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
