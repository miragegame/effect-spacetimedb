import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { FullModule } from "../fixtures/full-module"
import {
  makeFullModuleWsConnection,
  makeStaticRelationHandle,
  makeUnexpectedSubscriptionBuilder,
} from "../helpers/ws-fixtures"
import type { Assert, IsEqual } from "./helpers"
import { testViewRowsLength } from "../helpers/array-bounds"

void StdbInternal.ClientWs.make({
  module: FullModule,
  connection: makeFullModuleWsConnection(),
})

const userRelation =
  makeStaticRelationHandle<
    StdbInternal.ClientWs.WsTableRow<typeof FullModule.tables.user>
  >()
const presenceRelation =
  makeStaticRelationHandle<
    StdbInternal.ClientWs.WsTableRow<typeof FullModule.tables.presenceEvent>
  >()
const allUsersRelation =
  makeStaticRelationHandle<
    StdbInternal.ClientWs.WsTableRow<typeof FullModule.tables.user>
  >()

const NonePolicyModule = Stdb.Module.make("none_policy_views", {
  settings: { caseConversionPolicy: "none" },
}).add(
  Stdb.Group.make("Views").add(
    Stdb.Fn.anonymousView("allUsers", {
      returns: Stdb.array(FullModule.tables.user.row, testViewRowsLength),
    }),
  ),
).spec

const validNonePolicyDb = {
  allUsers: allUsersRelation,
} satisfies StdbInternal.ClientWs.WsDbShape<typeof NonePolicyModule>

void validNonePolicyDb

const profiles = Stdb.Module.make("profiles").addTables(
  Stdb.table("user_profile", {
    public: true,
    columns: { user_id: Stdb.string().primaryKey() },
  }),
)
const profileDb = {
  userProfile: makeStaticRelationHandle([{ userId: "one" }]),
} satisfies StdbInternal.ClientWs.WsDbShape<typeof profiles.spec>
void profileDb

// The query-builder facade keeps the contract key under either name policy.
type _snakePolicyViewQueryRootKeys = Assert<
  IsEqual<keyof StdbInternal.ClientViewQueryRoot<typeof FullModule>, "allUsers">
>
type _nonePolicyViewQueryRootKeys = Assert<
  IsEqual<
    keyof StdbInternal.ClientViewQueryRoot<typeof NonePolicyModule>,
    "allUsers"
  >
>
type _viewQueryRootRejectsWireName = Assert<
  IsEqual<
    "all_users" extends keyof StdbInternal.ClientViewQueryRoot<
      typeof FullModule
    >
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
} satisfies StdbInternal.ClientWs.WsConnectionLike<typeof FullModule, unknown>

void StdbInternal.ClientWs.make({
  module: FullModule,
  connection: validConnection,
})

void StdbInternal.ClientWs.make({
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

void StdbInternal.ClientWs.make({
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

const invalidUserRow: StdbInternal.ClientWs.WsTableRow<
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

type OptionalWireRow = StdbInternal.ClientWs.WsTableRow<typeof optionalWireRow>

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
