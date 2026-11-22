import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { QuickstartModule } from "./contract.ts"

const { Db, Tx } = QuickstartModule

export const MessageFunctionsLive = Stdb.Builder.group(
  QuickstartModule,
  "Messages",
  {
    messageSend: Effect.fn(function* ({ id, text }) {
      const db = yield* Db
      yield* db.message.insert({ id, text })
    }),
    messageList: Effect.fn(function* () {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* db.message.toArray()
        }),
      )
    }),
  },
)
