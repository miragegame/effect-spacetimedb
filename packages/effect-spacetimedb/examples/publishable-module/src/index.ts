import { build } from "effect-spacetimedb/server-compiler"
import { DeterminismFunctionsLive } from "./determinism/live"
import { LifecycleFunctionsLive } from "./lifecycle/live"
import { MembershipFunctionsLive } from "./memberships/live"
import { ExampleModule } from "./module"
import { NativeRangeFunctionsLive } from "./native-ranges/live"
import { ScheduleFunctionsLive } from "./schedules/live"
import { ThingFunctionsLive, ThingRoutesLive } from "./things/live"
import { UserFunctionsLive } from "./users/live"
import { WebhookRoutesLive } from "./webhooks/live"

const compiled = build(
  ExampleModule,
  [
    UserFunctionsLive,
    DeterminismFunctionsLive,
    LifecycleFunctionsLive,
    MembershipFunctionsLive,
    NativeRangeFunctionsLive,
    ThingFunctionsLive,
    ScheduleFunctionsLive,
    ThingRoutesLive,
    WebhookRoutesLive,
  ],
  {
    runtimeMode: "dev-guarded",
  },
)

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
