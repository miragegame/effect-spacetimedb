import * as Server from "effect-spacetimedb/server"
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"

const { describe, expect, it } = EffectVitest

const EmptyModule = Stdb.Module.make("scoped_db_tx").spec

describe("a transaction fragment run from a context", () => {
  it.effect("releases what it acquired as it ends", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const note = (step: string) =>
        Effect.suspend(() => {
          order.push(step)
          return Effect.void
        })
      const run = Server.scopedDbTxFromCtx({
        db: {},
        ctx: StdbTesting.makeTestModuleHarness(EmptyModule).makeMutationCtx(),
      })

      yield* run(() =>
        Effect.acquireRelease(note("acquired"), () => note("released")),
      )
      yield* note("after the fragment")

      expect(order).toEqual(["acquired", "released", "after the fragment"])
    }),
  )
})
