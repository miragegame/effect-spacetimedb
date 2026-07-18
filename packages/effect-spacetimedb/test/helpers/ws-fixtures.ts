import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"

export type FullModuleWsConnection<RelationContext = unknown> =
  StdbTesting.WsConnectionLike<typeof FullModule, unknown, RelationContext>

export type FullModuleWsDb<RelationContext = unknown> =
  FullModuleWsConnection<RelationContext>["db"]

export type FullModuleSubscriptionBuilder = StdbTesting.SubscriptionBuilderLike<
  unknown,
  StdbTesting.ClientQueryRoot<typeof FullModule>
>

type FullUserRow = StdbTesting.WsTableRow<typeof FullModule.tables.user>
type FullPresenceEventRow = StdbTesting.WsTableRow<
  typeof FullModule.tables.presenceEvent
>

const unexpected = (path: string): never => {
  throw new Error(`unexpected ${path}`)
}

export const makeStaticRelationHandle = <Row, Ctx = unknown>(
  rows: ReadonlyArray<Row> = [],
): StdbTesting.RelationHandle<Row, Ctx> => ({
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

export type SubscriptionHandleLike = StdbTesting.SubscriptionHandleLike
