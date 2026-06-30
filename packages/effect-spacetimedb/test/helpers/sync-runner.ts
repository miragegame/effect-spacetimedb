import * as Effect from "effect/Effect"
import type { SyncRunner } from "effect-spacetimedb/server"

export const TestSyncRunner: SyncRunner = {
  runSync: Effect.runSync,
  runSyncExit: Effect.runSyncExit,
}
