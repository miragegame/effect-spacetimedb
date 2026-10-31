import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stdb from "effect-spacetimedb"
import * as StdbServer from "effect-spacetimedb/server"
import { FixtureRejected, FixtureUnknownPeer, refusedNote } from "../inbox.ts"
import { IdcReceiverModule } from "./contract.ts"

const { Db, Env, ReducerCtx } = IdcReceiverModule

/** Admits only the database named by `IDC_FIXTURE_TRUSTED_PEER`. */
export const requireTrustedPeer = Effect.gen(function* () {
  const ctx = yield* ReducerCtx
  const env = yield* Env
  const trusted = yield* env.IDC_FIXTURE_TRUSTED_PEER
  const caller = StdbServer.databaseCaller(ctx)
  if (Option.isNone(caller) || !Stdb.identityEquals(caller.value, trusted)) {
    return yield* FixtureUnknownPeer.make()
  }
})

const recordPing = Effect.fn(function* (
  note: string,
  labels: ReadonlyArray<string>,
) {
  if (note === refusedNote) {
    return yield* FixtureRejected.make({ note })
  }
  const ctx = yield* ReducerCtx
  const db = yield* Db
  yield* db.pingLog.insert({ id: 0n, sender: ctx.sender, note, labels })
})

export const IdcFixtureInboxLive = Stdb.StdbBuilder.group(
  IdcReceiverModule,
  "IdcFixtureInbox",
  {
    receivePing: ({ note }) => recordPing(note, []),
    receiveDetails: ({ body, details }) => recordPing(body, details.labels),
  },
  { middleware: { reducers: requireTrustedPeer } },
)
