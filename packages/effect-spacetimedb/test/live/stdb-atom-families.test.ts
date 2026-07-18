/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"

const { describe, expect, live } = EffectVitest

import type {
  RowRefValue,
  TableGroupRefValue,
  TableGroupSnapshot,
  TableRefValue,
} from "effect-spacetimedb/client"
import {
  rowAtomFamily,
  tableAtomFamily,
  tableGroupAtomFamily,
} from "effect-spacetimedb/client/atom"
import { scopedAtomRegistry } from "./helpers/atom-registry"
import {
  CONVERGENCE_TIMEOUT_MS,
  decodeUserId,
  decodeUserName,
  LIVE_TEST_TIMEOUT_MS,
  LiveModule,
  makeExampleSession,
  syncFinalizer,
  type UserRow,
  wireFunction,
} from "./helpers/example-live"
import { callLiveReducer, provideLiveTest } from "./helpers/live-harness"
import { waitForPredicate } from "./helpers/wait-for-predicate"

type UserGroupSnapshot = TableGroupSnapshot<
  typeof LiveModule,
  readonly ["user"]
>

describe("effect-spacetimedb live atom families", () => {
  live(
    "tableAtomFamily transitions from initial to success on live insert",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session, connection } = yield* makeExampleSession
          const registry = yield* scopedAtomRegistry
          const tables = tableAtomFamily<typeof LiveModule>(session)
          const values: Array<TableRefValue<UserRow>> = []
          const unsubscribe = registry.subscribe(
            tables("user"),
            (value) => {
              values.push(value)
            },
            { immediate: true },
          )
          yield* Effect.addFinalizer(() => syncFinalizer(unsubscribe))
          expect(values.some((value) => AsyncResult.isInitial(value))).toBe(
            true,
          )

          const userId = decodeUserId("atom-table-user")
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId,
            name: decodeUserName("Ada"),
          })
          yield* waitForPredicate(
            () =>
              values.some(
                (value) =>
                  AsyncResult.isSuccess(value) &&
                  value.value.some(
                    (row) => row.id === userId && row.name === "Ada",
                  ),
              ),
            "table atom did not converge to success",
            CONVERGENCE_TIMEOUT_MS,
          )
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "rowAtomFamily shares table subscriptions and preserves sibling identity",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session, connection } = yield* makeExampleSession
          const registry = yield* scopedAtomRegistry
          const rows = rowAtomFamily<typeof LiveModule>(session)
          const rowAValues: Array<RowRefValue<UserRow>> = []
          const rowBValues: Array<RowRefValue<UserRow>> = []
          const unsubscribeA = registry.subscribe(
            rows("user", decodeUserId("atom-row-user-1")),
            (value) => {
              rowAValues.push(value)
            },
            { immediate: true },
          )
          yield* Effect.addFinalizer(() => syncFinalizer(unsubscribeA))
          const unsubscribeB = registry.subscribe(
            rows("user", decodeUserId("atom-row-user-2")),
            (value) => {
              rowBValues.push(value)
            },
            { immediate: true },
          )
          yield* Effect.addFinalizer(() => syncFinalizer(unsubscribeB))

          const rowAId = decodeUserId("atom-row-user-1")
          const rowBId = decodeUserId("atom-row-user-2")
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: rowAId,
            name: decodeUserName("Ada"),
          })
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: rowBId,
            name: decodeUserName("Grace"),
          })
          yield* waitForPredicate(
            () =>
              rowBValues.some(
                (value) =>
                  AsyncResult.isSuccess(value) &&
                  Option.getOrUndefined(value.value)?.name === "Grace",
              ),
            "row B atom did not receive the initial success",
            CONVERGENCE_TIMEOUT_MS,
          )
          const rowBSuccess = rowBValues.find(
            (value) =>
              AsyncResult.isSuccess(value) &&
              Option.getOrUndefined(value.value)?.name === "Grace",
          )

          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId: rowAId,
            name: decodeUserName("Ada Updated"),
          })
          yield* waitForPredicate(
            () =>
              rowAValues.some(
                (value) =>
                  AsyncResult.isSuccess(value) &&
                  Option.getOrUndefined(value.value)?.name === "Ada Updated",
              ),
            "row A atom did not receive the live update",
            CONVERGENCE_TIMEOUT_MS,
          )

          expect(rowBValues.at(-1)).toBe(rowBSuccess)
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )

  live(
    "tableGroupAtomFamily emits typed snapshots and dedupes canonical keys",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session, connection } = yield* makeExampleSession
          const registry = yield* scopedAtomRegistry
          const groups = tableGroupAtomFamily<typeof LiveModule>(session)
          expect(groups(["user"] as const)).toBe(
            groups(["user", "user"] as const),
          )
          const values: Array<TableGroupRefValue<UserGroupSnapshot>> = []
          const unsubscribe = registry.subscribe(
            groups(["user"] as const),
            (value) => {
              values.push(value)
            },
            { immediate: true },
          )
          yield* Effect.addFinalizer(() => syncFinalizer(unsubscribe))

          const userId = decodeUserId("atom-group-user")
          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId,
            name: decodeUserName("Margaret"),
          })
          yield* waitForPredicate(
            () =>
              values.some(
                (value) =>
                  AsyncResult.isSuccess(value) &&
                  value.value.user.some(
                    (row) => row.id === userId && row.name === "Margaret",
                  ),
              ),
            "table group atom did not converge to a typed snapshot",
            CONVERGENCE_TIMEOUT_MS,
          )
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
