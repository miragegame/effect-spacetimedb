import * as Effect from "effect/Effect"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, UserId, UserName } from "../fixtures/full-module"

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

const reconnecting = StdbTesting.makeWsSessionSupervisorFromModulePlan({
  plan,
  config: {
    builder: () => builder,
    uri: "ws://localhost:3000",
    databaseName: "test",
    connectTimeoutMillis: 1_000,
    automaticReconnect: { delayMillisMin: 500 },
    token: Effect.succeed("token"),
  },
  onAutomaticReconnect: (session) =>
    session.reducers
      .userUpsert({ userId: UserId.make("u"), name: UserName.make("n") })
      .pipe(Effect.ignore),
})

const tokenFailingWithoutError =
  StdbTesting.makeWsSessionSupervisorFromModulePlan({
    plan,
    config: {
      builder: () => builder,
      uri: "ws://localhost:3000",
      databaseName: "test",
      connectTimeoutMillis: 1_000,
      // @ts-expect-error a token Effect fails with an Error, so it can be a WsConnectError cause; @effect-diagnostics-next-line missingEffectError:off
      token: Effect.fail("no token"),
    },
  })

void [supervised, missingTimeout, reconnecting, tokenFailingWithoutError]
