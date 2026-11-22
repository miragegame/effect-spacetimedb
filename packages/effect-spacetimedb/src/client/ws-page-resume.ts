import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"

/**
 * Page events after which a browser may have torn a socket down without
 * delivering `onclose`: the page became visible again, regained focus, came
 * back online, or was restored from the back-forward cache. The SDK's own
 * connection manager re-checks its sockets on the same events.
 */
const pageResumeEventTypes = [
  "visibilitychange",
  "focus",
  "online",
  "pageshow",
] as const

/**
 * Re-checks a live session's socket whenever the page resumes, for as long as
 * the enclosing scope lives. Reading the session's liveness invalidates a
 * socket that closed without its close event, so the supervisor reconnects
 * at once instead of publishing a dead session as live until the next call.
 * Outside a page (Bun, Node) none of these events fires.
 */
export const recheckOnPageResume = (
  check: () => void,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.suspend(() => {
      if (typeof globalThis.addEventListener !== "function") {
        return Effect.succeed(false)
      }
      for (const type of pageResumeEventTypes) {
        globalThis.addEventListener(type, check)
      }
      return Effect.succeed(true)
    }),
    (registered) =>
      Effect.suspend(() => {
        if (registered) {
          for (const type of pageResumeEventTypes) {
            globalThis.removeEventListener(type, check)
          }
        }
        return Effect.void
      }),
  ).pipe(Effect.asVoid)
