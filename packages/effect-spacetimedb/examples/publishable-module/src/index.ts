import { build } from "effect-spacetimedb/server-compiler"
import "effect-spacetimedb/server-polyfills"
import { MembershipFunctionsLive } from "./memberships/live"
import { ExampleModule } from "./module"
import { ScheduleFunctionsLive } from "./schedules/live"
import { ThingFunctionsLive, ThingRoutesLive } from "./things/live"
import { LifecycleFunctionsLive, UserFunctionsLive } from "./users/live"
import { WebhookRoutesLive } from "./webhooks/live"

const compiled = build(ExampleModule, [
  UserFunctionsLive,
  LifecycleFunctionsLive,
  MembershipFunctionsLive,
  ThingFunctionsLive,
  ScheduleFunctionsLive,
  ThingRoutesLive,
  WebhookRoutesLive,
])

export const ModuleExports = compiled.exportGroup()

// ast-grep-reason: SpacetimeDB module loader requires a default schema export.
// ast-grep-ignore: no-default-export
export default compiled.schema
