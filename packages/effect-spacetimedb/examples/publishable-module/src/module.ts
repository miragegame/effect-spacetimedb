import * as Stdb from "effect-spacetimedb"
import { MembershipFunctions } from "./memberships/contract"
import { exampleTables } from "./schema"
import { ScheduleFunctions } from "./schedules/contract"
import { ThingFunctions, ThingRoutes } from "./things/contract"
import { UserFunctions, UserLifecycle } from "./users/contract"
import { WebhookRoutes } from "./webhooks/contract"

export const ExampleModule = Stdb.StdbModule.make(
  "effect_spacetimedb_example",
  {
    lifecycle: UserLifecycle,
  },
)
  .addTables(...exampleTables)
  .add(UserFunctions)
  .add(MembershipFunctions)
  .add(ThingFunctions)
  .add(ScheduleFunctions)
  .add(ThingRoutes)
  .add(WebhookRoutes)

export const {
  Db,
  ReadonlyDb,
  ReducerCtx,
  Tx,
  HttpTx,
  From,
  ViewCtx,
  MutationCtx,
} = ExampleModule

export const Example = Stdb.project(ExampleModule.spec)
