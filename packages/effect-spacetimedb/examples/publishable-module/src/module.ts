import * as Stdb from "effect-spacetimedb"
import { DeterminismFunctions } from "./determinism/contract"
import { ExampleLifecycle } from "./lifecycle/contract"
import { MembershipFunctions } from "./memberships/contract"
import { ScheduleFunctions } from "./schedules/contract"
import { exampleTables } from "./schema"
import { ThingFunctions, ThingRoutes } from "./things/contract"
import { UserFunctions } from "./users/contract"
import { WebhookRoutes } from "./webhooks/contract"

export const ExampleModule = Stdb.StdbModule.make(
  "effect_spacetimedb_example",
  {
    lifecycle: ExampleLifecycle,
  },
)
  .addTables(...exampleTables)
  .add(UserFunctions)
  .add(DeterminismFunctions)
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
