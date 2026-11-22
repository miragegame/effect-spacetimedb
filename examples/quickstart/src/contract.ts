import * as Stdb from "effect-spacetimedb"

export const message = Stdb.table("message", {
  public: true,
  columns: {
    id: Stdb.string().primaryKey(),
    text: Stdb.string(),
  },
})

export const MessageRow = Stdb.struct({
  id: Stdb.string(),
  text: Stdb.string(),
}).named("MessageRow")

export const MessageFunctions = Stdb.Group.make("Messages").add(
  Stdb.Fn.reducer("messageSend", {
    params: MessageRow,
  }),
  Stdb.Fn.procedure("messageList", {
    params: Stdb.struct({}),
    returns: Stdb.array(MessageRow),
  }),
)

export const QuickstartModule = Stdb.Module.make(
  "effect_spacetimedb_quickstart",
  {},
)
  .addTables(message)
  .add(MessageFunctions)
