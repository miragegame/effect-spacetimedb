import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Exit from "effect/Exit"
const { expect } = EffectVitest
import * as Server from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule } from "../fixtures/full-module"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

describe("server service tags", (it) => {
  it.effect("projects module-specific services from package-global tags", () =>
    Effect.gen(function* () {
      const firstServer = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })
      const secondServer = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      const sameServerExit = yield* firstServer.db.pipe(
        Effect.asVoid,
        Effect.provideService(Server.Db, {} as never),
        Effect.exit,
      )
      const crossServerExit = yield* secondServer.db.pipe(
        Effect.asVoid,
        Effect.provideService(Server.Db, {} as never),
        Effect.exit,
      )

      expect(Exit.isSuccess(sameServerExit)).toBe(true)
      expect(Exit.isSuccess(crossServerExit)).toBe(true)
      expect(firstServer.db).not.toBe(secondServer.db)
    }),
  )
})
