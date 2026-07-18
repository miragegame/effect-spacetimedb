import { make as makeServer } from "../../src/server/bind.ts"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import * as StdbServer from "effect-spacetimedb/server"
import { FullModule, FullModuleHttpHandlers } from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"

const Full = Stdb.project(FullModule)

const publicReducer: boolean = Full.module.reducers.userUpsert.public
const privateProcedure: boolean = Full.module.procedures.reminderFire.public
void publicReducer
void privateProcedure
void Full.targets.tables.user
void Full.targets.allPublicTables()
void Full.client.ws.Session
void Full.client.http

// @ts-expect-error server projection helpers were removed from the clean-break API
void StdbServer.project

const server = makeServer({
  module: FullModule,
  runtime: TestSyncRunner,
})

const handlers = server.handlers({
  reducers: {
    userUpsert: Effect.fn(function* ({ userId, name }) {
      void userId
      void name
    }),
    userRequire: Effect.fn(function* ({ userId }) {
      void userId
    }),
  },
  procedures: {
    userGet: Effect.fn(function* ({ userId }) {
      void userId
      return undefined
    }),
    reminderFire: Effect.fn(function* ({ data }) {
      void data.id
      return undefined
    }),
  },
  httpHandlers: FullModuleHttpHandlers,
  views: {
    allUsers: Effect.fn(function* () {
      const from = yield* server.from
      return from.user
    }),
  },
  lifecycle: {
    init: () => Effect.void,
    clientConnected: () => Effect.void,
    clientDisconnected: () => Effect.void,
  },
})

void handlers

// @ts-expect-error build expects grouped impl values, not raw server handler bundles
void build(FullModule, [handlers])
