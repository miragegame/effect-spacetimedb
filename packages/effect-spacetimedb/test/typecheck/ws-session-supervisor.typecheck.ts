import * as Effect from "effect/Effect"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { FullModule, UserId, UserName } from "../fixtures/full-module"

const plan = StdbInternal.makeModulePlan(FullModule)
declare const builder: StdbInternal.GeneratedWsBuilderLike<
  typeof FullModule,
  unknown
>

const supervised = StdbInternal.makeWsSessionSupervisorFromModulePlan({
  plan,
  config: {
    builder: () => builder,
    uri: "ws://localhost:3000",
    databaseName: "test",
    connectDurationMax: 1_000,
  },
})

const defaultTimeout = StdbInternal.makeWsSessionSupervisorFromModulePlan({
  plan,
  config: {
    builder: () => builder,
    uri: "ws://localhost:3000",
    databaseName: "test",
  },
})

const reconnecting = StdbInternal.makeWsSessionSupervisorFromModulePlan({
  plan,
  config: {
    builder: () => builder,
    uri: "ws://localhost:3000",
    databaseName: "test",
    connectDurationMax: 1_000,
    automaticReconnect: { delayMin: 500 },
    token: Effect.succeed("token"),
  },
  onAutomaticReconnect: (session) =>
    session.reducers
      .userUpsert({ userId: UserId.make("u"), name: UserName.make("n") })
      .pipe(Effect.ignore),
})

const tokenFailingWithoutError =
  StdbInternal.makeWsSessionSupervisorFromModulePlan({
    plan,
    config: {
      builder: () => builder,
      uri: "ws://localhost:3000",
      databaseName: "test",
      connectDurationMax: 1_000,
      // @ts-expect-error a token Effect fails with an Error, so it can be a WsConnectError cause; @effect-diagnostics-next-line missingEffectError:off
      token: Effect.fail("no token"),
    },
  })

void [supervised, defaultTimeout, reconnecting, tokenFailingWithoutError]
