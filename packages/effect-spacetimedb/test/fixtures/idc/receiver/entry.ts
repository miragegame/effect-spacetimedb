// First, before anything that loads Effect: the polyfills adapt the module
// host (see effect-spacetimedb/server-polyfills).
import "effect-spacetimedb/server-polyfills"
import { build } from "effect-spacetimedb/server-compiler"
import { IdcReceiverModule } from "./contract.ts"
import { IdcFixtureInboxLive } from "./live.ts"

// The interface fixture entry: bundled to generate the committed receiver
// binding under `../remote/`, and published by the real-delivery tests.

const compiled = build(IdcReceiverModule, [IdcFixtureInboxLive], {
  runtimeMode: "dev-guarded",
})

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
