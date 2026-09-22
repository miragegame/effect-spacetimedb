import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"

const plan = StdbTesting.makeModulePlan(FullModule)
declare const builder: StdbTesting.GeneratedWsBuilderLike<
  typeof FullModule,
  unknown
>

const supervised = StdbTesting.makeWsSessionSupervisorFromModulePlan({
  plan,
  config: {
    builder: () => builder,
    uri: "ws://localhost:3000",
    databaseName: "test",
    connectTimeoutMillis: 1_000,
  },
})

const missingTimeout = StdbTesting.makeWsSessionSupervisorFromModulePlan({
  plan,
  // @ts-expect-error supervised sessions require a timeout for every connection attempt
  config: {
    builder: () => builder,
    uri: "ws://localhost:3000",
    databaseName: "test",
  },
})

void [supervised, missingTimeout]
