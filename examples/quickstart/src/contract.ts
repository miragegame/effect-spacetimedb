import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

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

export const MessageRow = Stdb.struct({
  id: Stdb.string(MessageId),
  text: Stdb.string(MessageText),
}).named("MessageRow")

export const MessageFunctions = Stdb.StdbGroup.make("Messages").add(
  Stdb.StdbFn.reducer("messageSend", {
    params: MessageRow,
  }),
  Stdb.StdbFn.procedure("messageList", {
    params: Stdb.struct({}),
    returns: Stdb.array(MessageRow),
  }),
)

export const QuickstartModule = Stdb.StdbModule.make(
  "effect_spacetimedb_quickstart",
  {},
)
  .addTables(message)
  .add(MessageFunctions)
