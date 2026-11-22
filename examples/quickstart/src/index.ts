import { build } from "effect-spacetimedb/server-compiler"
import { QuickstartModule } from "./contract.ts"
import { MessageFunctionsLive } from "./live.ts"

export type { QuickstartClientExample } from "./client.ts"

const compiled = build(QuickstartModule, [MessageFunctionsLive])

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
