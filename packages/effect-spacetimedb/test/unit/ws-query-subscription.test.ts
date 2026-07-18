import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { FullModule, UserId } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"
import {
  type FullModuleSubscriptionBuilder,
  makeFullModuleWsConnection,
} from "../helpers/ws-fixtures"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

class ExpectedQuerySourceError extends Data.TaggedError(
  "ExpectedQuerySourceError",
) {}

describe("ws query subscriptions", (it) => {
  it.effect("lowers a where target through the native query root", () =>
    Effect.gen(function* () {
      let applied: (() => void) | undefined
      let capturedQuery: unknown
      const handle: StdbTesting.NativeSubscriptionHandleLike = {
        isEnded: () => false,
        unsubscribe: () => undefined,
      }
      const builder: FullModuleSubscriptionBuilder = {
        onApplied: (callback) => {
          applied = callback
          return builder
        },
        onError: () => builder,
        subscribe: (query) => {
          capturedQuery = query
          return handle
        },
      }
      const session = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: makeFullModuleWsConnection({
          subscriptionBuilder: () => builder,
        }),
      })
      const Full = Stdb.project(FullModule)
      const userId = Schema.decodeUnknownSync(UserId)("user-1")
      const predicateResult = {}
      const relationResult = {}
      const target = Full.targets.tables.user.where((row) => row.id.eq(userId))

      const fiber = yield* Effect.forkScoped(session.subscribe(target))
      yield* Effect.yieldNow

      expect(capturedQuery).toBeTypeOf("function")
      const querySource = yield* typeof capturedQuery === "function"
        ? Effect.succeed(capturedQuery)
        : new ExpectedQuerySourceError()

      const lowered = querySource({
        user: {
          where: (predicate: (row: unknown) => unknown) => {
            const row = {
              id: {
                eq: (value: unknown) => {
                  expect(value).toBe(userId)
                  return predicateResult
                },
              },
            }
            expect(predicate(row)).toBe(predicateResult)
            return relationResult
          },
        },
      })

      expect(lowered).toBe(relationResult)
      applied?.()
      yield* Fiber.join(fiber)
    }).pipe(Effect.scoped),
  )
})
