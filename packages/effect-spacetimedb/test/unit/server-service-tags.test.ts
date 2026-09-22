import { make as makeServer } from "../../src/server/bind.ts"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Exit from "effect/Exit"
const { expect } = EffectVitest
import * as Server from "effect-spacetimedb/server"
import { FullModule } from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

describe("server service tags", (it) => {
  it.effect("projects module-specific services from package-global tags", () =>
    Effect.gen(function* () {
      const serverFirst = makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })
      const serverSecond = makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      const sameServerExit = yield* serverFirst.db.pipe(
        Effect.asVoid,
        Effect.provideService(Server.Db, {}),
        Effect.exit,
      )
      const crossServerExit = yield* serverSecond.db.pipe(
        Effect.asVoid,
        Effect.provideService(Server.Db, {}),
        Effect.exit,
      )

      expect(Exit.isSuccess(sameServerExit)).toBe(true)
      expect(Exit.isSuccess(crossServerExit)).toBe(true)
      expect(serverFirst.db).not.toBe(serverSecond.db)
    }),
  )
})
