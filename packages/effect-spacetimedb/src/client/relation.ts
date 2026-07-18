export type RelationHandle<Row, Ctx = unknown> = {
  readonly [key: string]: unknown
  readonly onInsert: (callback: (ctx: Ctx, row: Row) => void) => void
  readonly removeOnInsert: (callback: (ctx: Ctx, row: Row) => void) => void
  readonly onDelete: (callback: (ctx: Ctx, row: Row) => void) => void
  readonly removeOnDelete: (callback: (ctx: Ctx, row: Row) => void) => void
  readonly onUpdate: (
    callback: (ctx: Ctx, oldRow: Row, newRow: Row) => void,
  ) => void
  readonly removeOnUpdate: (
    callback: (ctx: Ctx, oldRow: Row, newRow: Row) => void,
  ) => void
  readonly iter: () => Iterable<Row>
  readonly count: () => bigint
}

export type InsertEvent<Row, Ctx> = {
  readonly row: Row
  readonly context: Ctx
}
