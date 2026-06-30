import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"
import {
  makeFullModuleWsConnection,
  makeStaticRelationHandle,
  makeUnexpectedSubscriptionBuilder,
} from "../helpers/ws-fixtures"

void StdbTesting.ClientWs.make({
  module: FullModule,
  connection: makeFullModuleWsConnection(),
})

const userRelation =
  makeStaticRelationHandle<
    StdbTesting.ClientWs.WsTableRow<typeof FullModule.tables.user>
  >()
const presenceRelation =
  makeStaticRelationHandle<
    StdbTesting.ClientWs.WsTableRow<typeof FullModule.tables.presenceEvent>
  >()

const validConnection = {
  db: {
    user: userRelation,
    presenceEvent: presenceRelation,
  },
  subscriptionBuilder: () => makeUnexpectedSubscriptionBuilder(),
} satisfies StdbTesting.ClientWs.WsConnectionLike<typeof FullModule, unknown>

void StdbTesting.ClientWs.make({
  module: FullModule,
  connection: validConnection,
})

void StdbTesting.ClientWs.make({
  module: FullModule,
  connection: {
    db: {
      user: userRelation,
      // @ts-expect-error public view relations are no longer part of the exact ws connection contract
      allUsers: makeStaticRelationHandle<{
        readonly id: string
        readonly name: string
      }>(),
      presenceEvent: presenceRelation,
    },
    subscriptionBuilder: () => makeUnexpectedSubscriptionBuilder(),
  },
})

void StdbTesting.ClientWs.make({
  module: FullModule,
  connection: {
    db: {
      // @ts-expect-error wrong public table row shapes no longer satisfy the ws connection contract
      user: makeStaticRelationHandle<{
        readonly id: number
        readonly name: string
      }>(),
      presenceEvent: presenceRelation,
    },
    subscriptionBuilder: () => makeUnexpectedSubscriptionBuilder(),
  },
})

const invalidUserRow: StdbTesting.ClientWs.WsTableRow<
  typeof FullModule.tables.user
> = {
  // @ts-expect-error wrong public table row shapes no longer satisfy the ws row contract
  id: 1,
  name: "Ada",
}

void invalidUserRow
