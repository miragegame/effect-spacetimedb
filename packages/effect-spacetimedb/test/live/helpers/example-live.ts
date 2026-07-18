import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { WsSession } from "effect-spacetimedb/client"
import type { DevServerError } from "effect-spacetimedb/dev-server"
import type { TableRow, WsConnectError } from "effect-spacetimedb/testing"
import * as ExampleModuleFixture from "effect-spacetimedb/testing/example-module"
import {
  CONVERGENCE_TIMEOUT_MS,
  LIVE_TEST_TIMEOUT_MS,
  type LiveConnection,
  type LiveHarness,
  type LiveTestRequirements,
  liveHarness,
  typedConnection,
} from "./live-harness"

export {
  CONVERGENCE_TIMEOUT_MS,
  LIVE_TEST_TIMEOUT_MS,
} from "./live-harness"

export const {
  Example: Live,
  ExampleErrors: LiveErrors,
  ExampleModule: LiveModule,
  ThingId,
  UserId,
  UserMissingError,
  UserName,
} = ExampleModuleFixture

type ExampleFunctionName =
  | Extract<keyof (typeof LiveModule)["reducers"], string>
  | Extract<keyof (typeof LiveModule)["procedures"], string>
  | Extract<keyof (typeof LiveModule)["httpHandlers"], string>

export const wireFunction = (name: ExampleFunctionName): string =>
  LiveModule.wireNames.functions[name] ?? name

export const decodeUserId = Schema.decodeUnknownSync(UserId)
export const decodeUserName = Schema.decodeUnknownSync(UserName)
export const decodeThingId = Schema.decodeUnknownSync(ThingId)
export type UserRow = TableRow<(typeof LiveModule)["tables"]["user"]>

export type ExampleLiveSession = {
  readonly live: LiveHarness
  readonly session: WsSession<typeof LiveModule>
  readonly connection: LiveConnection<typeof LiveModule>
}

export const makeExampleSession: Effect.Effect<
  ExampleLiveSession,
  DevServerError | WsConnectError,
  LiveTestRequirements
> = Effect.gen(function* () {
  const live = yield* liveHarness
  const session = yield* Live.client.ws.scoped(live.makeWsConfig(LiveModule))
  return {
    live,
    session,
    connection: typedConnection(session, LiveModule),
  }
})

export const firstFailure = (exit: Exit.Exit<unknown, unknown>): unknown =>
  Exit.isFailure(exit)
    ? exit.cause.pipe(Cause.findErrorOption, Option.getOrUndefined)
    : undefined

export const syncFinalizer = (finalize: () => void): Effect.Effect<void> =>
  Effect.suspend(() => {
    finalize()
    return Effect.void
  })
