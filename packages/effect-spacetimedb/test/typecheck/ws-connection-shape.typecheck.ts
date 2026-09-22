import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"
import {
  makeFullModuleWsConnection,
  makeStaticRelationHandle,
  makeUnexpectedSubscriptionBuilder,
} from "../helpers/ws-fixtures"
import type { Assert, IsEqual } from "./helpers"

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
const allUsersRelation =
  makeStaticRelationHandle<
    StdbTesting.ClientWs.WsTableRow<typeof FullModule.tables.user>
  >()

const NonePolicyModule = Stdb.StdbModule.make("none_policy_views", {
  settings: { caseConversionPolicy: "none" },
}).add(
  Stdb.StdbGroup.make("Views").add(
    Stdb.StdbFn.anonymousView("allUsers", {
      returns: Stdb.array(FullModule.tables.user.row),
    }),
  ),
).spec

const validNonePolicyDb = {
  allUsers: allUsersRelation,
} satisfies StdbTesting.ClientWs.WsDbShape<typeof NonePolicyModule>

void validNonePolicyDb

// The query-builder root is keyed by contract key under either name policy,
// matching the camelCase accessors the generated client emits.
type _snakePolicyViewQueryRootKeys = Assert<
  IsEqual<keyof StdbTesting.ClientViewQueryRoot<typeof FullModule>, "allUsers">
>
type _nonePolicyViewQueryRootKeys = Assert<
  IsEqual<
    keyof StdbTesting.ClientViewQueryRoot<typeof NonePolicyModule>,
    "allUsers"
  >
>
type _viewQueryRootRejectsWireName = Assert<
  IsEqual<
    "all_users" extends keyof StdbTesting.ClientViewQueryRoot<typeof FullModule>
      ? true
      : false,
    false
  >
>

const validConnection = {
  db: {
    user: userRelation,
    presenceEvent: presenceRelation,
    allUsers: allUsersRelation,
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
      presenceEvent: presenceRelation,
      // @ts-expect-error public view relation keys are exact
      allUsersMissing: allUsersRelation,
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
      allUsers: allUsersRelation,
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

const WireString = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(255))),
)

const optionalWireRow = Stdb.table("optionalWireRow", {
  columns: {
    id: WireString,
    optionValue: Stdb.option(WireString),
    optionalField: WireString.optional(),
  },
})

type OptionalWireRow = StdbTesting.ClientWs.WsTableRow<typeof optionalWireRow>

const omittedOptionalKeys: OptionalWireRow = { id: "required" }
const explicitUndefinedKeys: OptionalWireRow = {
  id: "required",
  optionValue: undefined,
  optionalField: undefined,
}
// @ts-expect-error required non-option columns must remain present.
const missingRequiredKey: OptionalWireRow = {}

void omittedOptionalKeys
void explicitUndefinedKeys
void missingRequiredKey
