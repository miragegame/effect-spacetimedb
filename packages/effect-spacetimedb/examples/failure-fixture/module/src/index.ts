import { build } from "effect-spacetimedb/server-compiler"
import { FailureModule } from "./contract"
import { FailureFunctionsLive } from "./live"

const compiled = build(FailureModule, [FailureFunctionsLive])

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
