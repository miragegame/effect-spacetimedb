import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stdb from "effect-spacetimedb"
import * as StdbServer from "effect-spacetimedb/server"
import { IdcPairReceiverModule } from "./contract.ts"
import { IdcPairBlankNote, IdcPairUnknownSender } from "./inbox.ts"

const { Db, Env, ReducerCtx } = IdcPairReceiverModule

/**
 * The inbox guard: the caller must be the trusted database. `databaseCaller`
 * is the sending database's identity, which its host signs, so a client cannot
 * pose as one. A refusal is terminal: the sender's settle reducer sees it.
 */
export const requireTrustedSender = Effect.gen(function* () {
  const ctx = yield* ReducerCtx
  const env = yield* Env
  const trusted = yield* env.IDC_PAIR_TRUSTED_SENDER
  const caller = StdbServer.databaseCaller(ctx)
  if (
    trusted === undefined ||
    Option.isNone(caller) ||
    !Stdb.identityEquals(caller.value, trusted)
  ) {
    return yield* IdcPairUnknownSender.make()
  }
})

export const IdcPairInboxLive = Stdb.StdbBuilder.group(
  IdcPairReceiverModule,
  "IdcPairInbox",
  {
    receiveNote: Effect.fn(function* ({ note }) {
      if (note.trim().length === 0) {
        return yield* IdcPairBlankNote.make()
      }
      const ctx = yield* ReducerCtx
      const db = yield* Db
      yield* db.receivedNote.insert({ id: 0n, sender: ctx.sender, note })
    }),
  },
  // Every group that implements a receiver must declare its guard.
  { middleware: { reducers: requireTrustedSender } },
)
