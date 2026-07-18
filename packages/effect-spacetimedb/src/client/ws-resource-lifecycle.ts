import * as Data from "effect/Data"
import type { Identity } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"
import type { ManagedWsConnection } from "./generated-ws-adapter.ts"

/** Connection acquisition failure. Specific causes retain their own identity. */
const WsConnectErrorTypeId = errorTypeId("WsConnectError")
export class WsConnectError extends Data.TaggedError("WsConnectError")<{
  readonly cause: unknown
  readonly context?: unknown
}> {
  readonly [WsConnectErrorTypeId] = WsConnectErrorTypeId
  static is = hasErrorTypeId<WsConnectError>(WsConnectErrorTypeId)
}

const WsConnectTimeoutErrorTypeId = errorTypeId("WsConnectTimeoutError")
export class WsConnectTimeoutError extends Data.TaggedError(
  "WsConnectTimeoutError",
)<{
  readonly timeoutMillis: number
}> {
  readonly [WsConnectTimeoutErrorTypeId] = WsConnectTimeoutErrorTypeId
  static is = hasErrorTypeId<WsConnectTimeoutError>(WsConnectTimeoutErrorTypeId)

  override get message(): string {
    return `WebSocket connection did not complete within ${this.timeoutMillis.toString()}ms`
  }
}

export class WsDisconnectError extends Data.TaggedError("WsDisconnectError")<{
  readonly cause: unknown
}> {}

export type PendingConnect<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
> = {
  readonly connection: ManagedWsConnection<
    Module,
    ErrorContext,
    RelationContext
  >
  readonly identity: Identity
  readonly token: string
}

// Acquisition lifecycle:
// initial -> pending connection -> connected session -> scoped release.
export type AcquisitionState<
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  ValidationError,
> = {
  readonly built:
    | ManagedWsConnection<Module, ErrorContext, RelationContext>
    | undefined
  readonly connected:
    | PendingConnect<Module, ErrorContext, RelationContext>
    | undefined
  readonly acquired:
    | ManagedWsConnection<Module, ErrorContext, RelationContext>
    | undefined
  readonly failed: WsConnectError | ValidationError | undefined
  readonly released: boolean
}
