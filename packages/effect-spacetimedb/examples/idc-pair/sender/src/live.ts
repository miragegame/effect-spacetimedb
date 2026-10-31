import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import * as StdbServer from "effect-spacetimedb/server"
import { Identity } from "spacetimedb"
import { IdcPairNoteTooLarge, IdcPairSenderModule } from "./contract.ts"
import { PairInboxInterface } from "./interface.ts"

const { Db, Env, ReducerCtx } = IdcPairSenderModule

/** The peer resolver: the receiving database named by the environment. */
export const resolveReceiver = Effect.gen(function* () {
  const env = yield* Env
  const hex = yield* env.IDC_PAIR_RECEIVER
  return Stdb.RemoteInterface.peer(PairInboxInterface, new Identity(hex))
})

export const IdcPairSendsLive = Stdb.StdbBuilder.group(
  IdcPairSenderModule,
  "IdcPairSends",
  {
    // The insert is the send: the host delivers the row only once this
    // transaction commits, and never if it rolls back.
    sendNote: Effect.fn(function* ({ note }) {
      const target = yield* resolveReceiver
      const db = yield* Db
      yield* db.noteOutbox
        .insert({ target, note })
        .pipe(
          Effect.catchTag("OutboxRowTooLarge", (tooLarge) =>
            Effect.fail(
              IdcPairNoteTooLarge.make({ rowBytes: tooLarge.rowBytes }),
            ),
          ),
        )
    }),
  },
)

const delivery = (result: StdbServer.OutboxResult) =>
  StdbServer.OutboxResult.$match(result, {
    Delivered: () => ({ delivered: true, message: "" }),
    Refused: ({ message }) => ({ delivered: false, message }),
  })

export const IdcPairSettlesLive = Stdb.StdbBuilder.group(
  IdcPairSenderModule,
  "IdcPairSettles",
  {
    // A settle reducer cannot fail: a failed write here is a bug in this
    // module, so it dies, and the host rolls it back and still deletes the row.
    noteSettled: ({ row, result }) =>
      Effect.gen(function* () {
        const ctx = yield* ReducerCtx
        const db = yield* Db
        yield* db.noteDelivery.insert({
          msgId: row.msgId,
          note: row.note,
          settledBy: ctx.sender,
          ...delivery(result),
        })
      }).pipe(Effect.orDie),
  },
)
