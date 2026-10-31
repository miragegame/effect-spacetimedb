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

// `messageList` returns every message, so the quickstart states how many it
// will carry; an app that outgrows this paginates instead of raising it.
export const MessageListLength: Stdb.ArrayLengthBounds = {
  minimum: 0,
  maximum: 1_000,
}

export const MessageFunctions = Stdb.StdbGroup.make("Messages").add(
  Stdb.StdbFn.reducer("messageSend", {
    params: MessageRow,
  }),
  Stdb.StdbFn.procedure("messageList", {
    params: Stdb.struct({}),
    returns: Stdb.array(MessageRow, MessageListLength),
  }),
)

export const QuickstartModule = Stdb.StdbModule.make(
  "effect_spacetimedb_quickstart",
  {},
)
  .addTables(message)
  .add(MessageFunctions)
