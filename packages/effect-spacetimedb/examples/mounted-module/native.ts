import {
  schema,
  table,
  t,
  SenderError,
  type InferSchema,
  type ReducerCtx,
} from "spacetimedb/server"

const library = schema({
  nativeItem: table({}, { id: t.u32().primaryKey(), value: t.u32() }),
})
export default library

export function insert(
  ctx: Pick<ReducerCtx<InferSchema<typeof library>>, "db">,
  id: number,
  value = 0,
) {
  if (id === 0) throw new SenderError("native item requires a positive id")
  ctx.db.nativeItem.insert({ id, value })
}
