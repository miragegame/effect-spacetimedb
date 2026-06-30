import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { Db, ExampleModule, MutationCtx } from "../module"

const toHexString = (value: unknown): string => {
  if (typeof value === "string") {
    return value
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toHexString" in value &&
    typeof (value as { readonly toHexString: unknown }).toHexString ===
      "function"
  ) {
    return (value as { readonly toHexString: () => string }).toHexString()
  }

  return String(value)
}

const insertAuditLog = Effect.fn(function* (args: {
  readonly kind: "init" | "connected" | "disconnected"
  readonly subject: string
}) {
  const db = yield* Db
  yield* db.auditLog.insert({
    id: 0n,
    kind: args.kind,
    subject: args.subject,
  })
})

export const LifecycleFunctionsLive = Stdb.StdbBuilder.lifecycle(
  ExampleModule,
  {
    init: () => insertAuditLog({ kind: "init", subject: "module" }),
    clientConnected: Effect.fn(function* () {
      const ctx = yield* MutationCtx
      yield* insertAuditLog({
        kind: "connected",
        subject: toHexString(ctx.sender),
      })
    }),
    clientDisconnected: Effect.fn(function* () {
      const ctx = yield* MutationCtx
      yield* insertAuditLog({
        kind: "disconnected",
        subject: toHexString(ctx.sender),
      })
    }),
  },
)
