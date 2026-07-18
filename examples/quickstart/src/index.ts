import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import { QuickstartModule } from "./contract.ts"

export type { QuickstartClientExample } from "./client.ts"
export * from "./contract.ts"

const { Db, Tx } = QuickstartModule

const MessageFunctionsLive = Stdb.StdbBuilder.group(
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

const compiled = build(QuickstartModule, [MessageFunctionsLive])

export const ModuleExports = compiled.exportGroup()

export default compiled.schema
