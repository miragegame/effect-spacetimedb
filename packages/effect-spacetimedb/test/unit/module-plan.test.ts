import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const describe = EffectVitest.layer(TestLayer)

const noopWsConnection = makeFullModuleWsConnection()

describe("module plan", (it) => {
  it.effect(
    "derives the canonical plan data directly from the authored module",
    () =>
      Effect.gen(function* () {
        const plan = StdbTesting.makeModulePlan(FullModule)

        expect(plan.module).toBe(FullModule)
        expect(plan.scheduleBindings).toEqual([
          {
            tableKey: "reminder",
            tableName: "reminder",
            targetKey: "reminderFire",
            targetKind: "procedure",
            allowExternalCallers: false,
          },
        ])
        expect(Object.keys(plan.publicTables)).toEqual(["user"])
        expect(Object.keys(plan.publicEventTables)).toEqual(["presenceEvent"])
        expect(Object.keys(plan.publicReducers)).toEqual([
          "userRequire",
          "userUpsert",
        ])
        expect(Object.keys(plan.publicProcedures)).toEqual(["userGet"])
        expect(Object.keys(plan.httpHandlers)).toEqual([
          "rotateToken",
          "stripeWebhook",
        ])
        expect(plan.reducerCallables.userUpsert).toEqual(
          expect.objectContaining({
            kind: "reducer",
            name: "user_upsert",
            declaredName: "userUpsert",
            spec: FullModule.reducers.userUpsert,
          }),
        )
        expect(plan.procedureCallables.userGet).toEqual(
          expect.objectContaining({
            kind: "procedure",
            name: "user_get",
            declaredName: "userGet",
            spec: FullModule.procedures.userGet,
          }),
        )
        expect(plan.httpHandlerCallables.rotateToken).toEqual(
          expect.objectContaining({
            kind: "httpHandler",
            name: "rotate_token",
            declaredName: "rotateToken",
            spec: FullModule.httpHandlers.rotateToken,
          }),
        )
        expect(plan.targets.tables.user).toEqual({
          kind: "table",
          key: "user",
          name: "user",
        })
        expect(plan.targets.eventTables.presenceEvent).toEqual({
          kind: "eventTable",
          key: "presenceEvent",
          name: "presenceEvent",
        })
      }),
  )

  it.effect("reuses the same direct projections across projected helpers", () =>
    Effect.gen(function* () {
      const plan = StdbTesting.makeModulePlan(FullModule)
      const Full = StdbTesting.project(FullModule)

      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })
      const http = StdbTesting.ClientHttp.makeFromModulePlan({
        plan,
        config: {
          uri: "http://localhost:3000",
          databaseName: "example",
        },
      })
      const ws = StdbTesting.ClientWs.makeFromModulePlan({
        plan,
        connection: noopWsConnection,
      })

      expect(Full.targets.tables).toEqual(plan.targets.tables)
      expect(Full.targets.eventTables).toEqual(plan.targets.eventTables)
      expect(Full.targets.allPublicTables()).toEqual(
        plan.targets.allPublicTables(),
      )
      expect(server.module).toBe(plan.module)
      expect(server.plan.module).toBe(plan.module)
      expect(server.scheduleBindings).toEqual(plan.scheduleBindings)
      expect(Object.keys(http.reducers)).toEqual(
        Object.keys(plan.publicReducers),
      )
      expect(Object.keys(http.procedures)).toEqual(
        Object.keys(plan.publicProcedures),
      )
      expect(Object.keys(http.httpHandlers)).toEqual(
        Object.keys(plan.httpHandlers),
      )
      expect(Object.keys(ws.reducers)).toEqual(Object.keys(plan.publicReducers))
      expect(Object.keys(ws.procedures)).toEqual(
        Object.keys(plan.publicProcedures),
      )
    }),
  )
})
