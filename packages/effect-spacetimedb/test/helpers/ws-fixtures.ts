import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { FullModule } from "../fixtures/full-module"

export type FullModuleWsConnection<RelationContext = unknown> =
  StdbInternal.WsConnectionLike<typeof FullModule, unknown, RelationContext>

export type FullModuleWsDb<RelationContext = unknown> =
  FullModuleWsConnection<RelationContext>["db"]

export type FullModuleSubscriptionBuilder =
  StdbInternal.SubscriptionBuilderLike<
    unknown,
    StdbInternal.ClientQueryRoot<typeof FullModule>
  >

type FullUserRow = StdbInternal.WsTableRow<typeof FullModule.tables.user>
type FullPresenceEventRow = StdbInternal.WsTableRow<
  typeof FullModule.tables.presenceEvent
>
type FullAllUsersRow = StdbInternal.WsTableRow<typeof FullModule.tables.user>

const unexpected = (path: string): never => {
  throw new Error(`unexpected ${path}`)
}

export const makeStaticRelationHandle = <Row, Ctx = unknown>(
  rows: ReadonlyArray<Row> = [],
): StdbInternal.RelationHandle<Row, Ctx> => ({
  onInsert: () => undefined,
  removeOnInsert: () => undefined,
  onDelete: () => undefined,
  removeOnDelete: () => undefined,
  onUpdate: () => undefined,
  removeOnUpdate: () => undefined,
  iter: () => rows.values(),
  count: () => BigInt(rows.length),
})

export const makeUnexpectedSubscriptionBuilder: () => FullModuleSubscriptionBuilder =
  () => {
    const builder = {
      onApplied: () => unexpected("subscriptionBuilder.onApplied"),
      onError: () => unexpected("subscriptionBuilder.onError"),
      subscribe: () => unexpected("subscriptionBuilder.subscribe"),
    }

    return builder
  }

export const makeFullModuleWsDb: <RelationContext = unknown>(
  overrides?: Partial<FullModuleWsDb<RelationContext>>,
) => FullModuleWsDb<RelationContext> = <RelationContext = unknown>(
  overrides: Partial<FullModuleWsDb<RelationContext>> = {},
) => ({
  user: Object.assign(
    makeStaticRelationHandle<FullUserRow, RelationContext>(),
    {
      id: {
        find: (_id: FullUserRow["id"]) => null,
      },
    },
  ),
  presenceEvent: makeStaticRelationHandle<
    FullPresenceEventRow,
    RelationContext
  >(),
  allUsers: makeStaticRelationHandle<FullAllUsersRow, RelationContext>(),
  ...overrides,
})

export const makeFullModuleWsConnection: <RelationContext = unknown>(options?: {
  readonly db?: Partial<FullModuleWsDb<RelationContext>>
  readonly subscriptionBuilder?: FullModuleWsConnection<RelationContext>["subscriptionBuilder"]
}) => FullModuleWsConnection<RelationContext> = <RelationContext = unknown>(
  options: {
    readonly db?: Partial<FullModuleWsDb<RelationContext>>
    readonly subscriptionBuilder?: FullModuleWsConnection<RelationContext>["subscriptionBuilder"]
  } = {},
) => ({
  isActive: true,
  db: makeFullModuleWsDb(options.db),
  subscriptionBuilder:
    options.subscriptionBuilder ?? (() => makeUnexpectedSubscriptionBuilder()),
})

export type SubscriptionHandleLike = StdbInternal.SubscriptionHandleLike
