import { build } from "effect-spacetimedb/server-compiler"
import { EnvironmentModule } from "./contract"
import {
  EnvironmentFunctionsLive,
  EnvironmentLifecycleLive,
  EnvironmentRoutesLive,
} from "./live"

const compiled = build(
  EnvironmentModule,
  [EnvironmentFunctionsLive, EnvironmentRoutesLive, EnvironmentLifecycleLive],
  { runtimeMode: "dev-guarded" },
)

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
