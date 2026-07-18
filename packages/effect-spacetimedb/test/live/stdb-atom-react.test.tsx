// @vitest-environment jsdom
/**
 * @module-tag local-only
 * @module-tag spacetimedb
 */

import * as AtomReact from "@effect/atom-react"
import * as EffectVitest from "@effect/vitest"
import { waitFor } from "@testing-library/dom"
import { renderHook } from "@testing-library/react"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as React from "react"

const { describe, expect, live } = EffectVitest

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
  wireFunction,
} from "./helpers/example-live"
import { callLiveReducer, provideLiveTest } from "./helpers/live-harness"

class AtomReactRenderError extends Data.TaggedError("AtomReactRenderError")<{
  readonly cause: unknown
}> {}

const waitForRender = (assertion: () => void) =>
  Effect.tryPromise({
    try: () => waitFor(assertion, { timeout: CONVERGENCE_TIMEOUT_MS }),
    catch: (cause) => new AtomReactRenderError({ cause }),
  })

describe("live STDB atoms rendered via @effect/atom-react useAtomValue", () => {
  live(
    "renders table, row, and table group atoms through useAtomValue",
    () =>
      provideLiveTest(
        Effect.gen(function* () {
          const { session, connection } = yield* makeExampleSession
          const registry = yield* scopedAtomRegistry
          const wrapper = ({
            children,
          }: {
            readonly children: React.ReactNode
          }) => (
            <AtomReact.RegistryContext.Provider value={registry}>
              {children}
            </AtomReact.RegistryContext.Provider>
          )
          const tables = tableAtomFamily<typeof LiveModule>(session)
          const rows = rowAtomFamily<typeof LiveModule>(session)
          const groups = tableGroupAtomFamily<typeof LiveModule>(session)
          const userId = decodeUserId("atom-react-user")
          const tableRender = renderHook(
            () => AtomReact.useAtomValue(tables("user")),
            { wrapper },
          )
          yield* Effect.addFinalizer(() =>
            syncFinalizer(() => {
              tableRender.unmount()
            }),
          )
          const rowRender = renderHook(
            () => AtomReact.useAtomValue(rows("user", userId)),
            { wrapper },
          )
          yield* Effect.addFinalizer(() =>
            syncFinalizer(() => {
              rowRender.unmount()
            }),
          )
          const groupRender = renderHook(
            () => AtomReact.useAtomValue(groups(["user"] as const)),
            {
              wrapper,
            },
          )
          yield* Effect.addFinalizer(() =>
            syncFinalizer(() => {
              groupRender.unmount()
            }),
          )

          expect(AsyncResult.isInitial(tableRender.result.current)).toBe(true)
          expect(AsyncResult.isInitial(rowRender.result.current)).toBe(true)
          expect(AsyncResult.isInitial(groupRender.result.current)).toBe(true)

          yield* callLiveReducer(connection, wireFunction("userUpsert"), {
            userId,
            name: decodeUserName("Live React"),
          })
          yield* waitForRender(() => {
            expect(AsyncResult.isSuccess(tableRender.result.current)).toBe(true)
            if (AsyncResult.isSuccess(tableRender.result.current)) {
              expect(tableRender.result.current.value).toContainEqual({
                id: userId,
                name: "Live React",
              })
            }
          })
          yield* waitForRender(() => {
            expect(AsyncResult.isSuccess(rowRender.result.current)).toBe(true)
            if (AsyncResult.isSuccess(rowRender.result.current)) {
              expect(
                Option.getOrUndefined(rowRender.result.current.value),
              ).toEqual({
                id: userId,
                name: "Live React",
              })
            }
          })
          yield* waitForRender(() => {
            expect(AsyncResult.isSuccess(groupRender.result.current)).toBe(true)
            if (AsyncResult.isSuccess(groupRender.result.current)) {
              expect(groupRender.result.current.value.user).toContainEqual({
                id: userId,
                name: "Live React",
              })
            }
          })
        }),
      ),
    { timeout: LIVE_TEST_TIMEOUT_MS },
  )
})
