import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import "effect-spacetimedb/server-polyfills"

export const MessageId = Schema.String.pipe(
  Schema.brand("EffectSpacetimeDbQuickstart/MessageId"),
)
export type MessageId = typeof MessageId.Type

export const MessageText = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(280)),
)
export type MessageText = typeof MessageText.Type

export const message = Stdb.table("message", {
  public: true,
  columns: {
    id: Stdb.string(MessageId).primaryKey(),
    text: Stdb.string(MessageText),
  },
})

export const MessageFunctions = Stdb.StdbGroup.make("Messages").add(
  Stdb.StdbFn.reducer("messageSend", {
    params: Stdb.struct({
      id: Stdb.string(MessageId),
      text: Stdb.string(MessageText),
    }),
  }),
)

export const QuickstartModule = Stdb.StdbModule.make(
  "effect_spacetimedb_quickstart",
  {},
)
  .addTables(message)
  .add(MessageFunctions)

const { Db } = QuickstartModule

const MessageFunctionsLive = Stdb.StdbBuilder.group(
  QuickstartModule,
  "Messages",
  {
    messageSend: Effect.fn(function* ({ id, text }) {
      const db = yield* Db
      yield* db.message.insert({ id, text })
    }),
  },
)

const compiled = build(QuickstartModule, [MessageFunctionsLive])

export const ModuleExports = compiled.exportGroup()

// ast-grep-reason: SpaceTimeDB module loader requires a default schema export.
// ast-grep-ignore: no-default-export
export default compiled.schema
