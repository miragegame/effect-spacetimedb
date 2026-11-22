import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { FullStdbModule } from "../fixtures/full-module"

const { From } = FullStdbModule

const CanonicalLive = Stdb.Builder.group(FullStdbModule, "FullCallables", {
  userUpsert: Effect.fn(function* ({ userId, name }) {
    void userId
    void name
  }),
  userRequire: Effect.fn(function* ({ userId }) {
    void userId
  }),
  userGet: Effect.fn(function* ({ userId }) {
    void userId
    return undefined
  }),
  reminderFire: Effect.fn(function* ({ data }) {
    void data.id
    return undefined
  }),
  allUsers: () => Effect.succeed([]),
  init: () => Effect.void,
  clientConnected: () => Effect.void,
  clientDisconnected: () => Effect.void,
})

const InvalidReducerArgsLive = Stdb.Builder.group(
  FullStdbModule,
  "FullCallables",
  {
    // @ts-expect-error handler params must match reducer contract
    userUpsert: Effect.fn(function* ({ missing }) {
      void missing
    }),
    userRequire: () => Effect.void,
    userGet: Effect.fn(function* () {
      return undefined
    }),
    reminderFire: () => Effect.void,
    allUsers: () => Effect.succeed([]),
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
  },
)

const InvalidReducerFromLive = Stdb.Builder.group(
  FullStdbModule,
  "FullCallables",
  // @ts-expect-error reducers must not depend on the view query root
  {
    userUpsert: Effect.fn(function* () {
      const from = yield* From
      void from
    }),
    userRequire: () => Effect.void,
    userGet: Effect.fn(function* () {
      return undefined
    }),
    reminderFire: () => Effect.void,
    allUsers: () => Effect.succeed([]),
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
  },
)

const MissingHandlersLive = Stdb.Builder.group(
  FullStdbModule,
  "FullCallables",
  // @ts-expect-error a group must implement every endpoint it declares
  {
    userUpsert: () => Effect.void,
    userRequire: () => Effect.void,
  },
)

const ExtraReducerKeyLive = Stdb.Builder.group(
  FullStdbModule,
  "FullCallables",
  {
    userUpsert: () => Effect.void,
    userRequire: () => Effect.void,
    userGet: Effect.fn(function* () {
      return undefined
    }),
    reminderFire: () => Effect.void,
    allUsers: () => Effect.succeed([]),
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
    // @ts-expect-error handler maps must not accept unknown keys
    user_delete: () => Effect.void,
  },
)

void CanonicalLive
void InvalidReducerArgsLive
void InvalidReducerFromLive
void MissingHandlersLive
void ExtraReducerKeyLive
