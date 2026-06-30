import * as Effect from "effect/Effect"

import * as Schema from "effect/Schema"

import type { HttpHandlerSpec } from "../contract/http-handler.ts"

import { isTypedHttpHandlerSpec } from "../contract/http-handler.ts"

import { Request } from "../http-primitives.ts"

import type { AnyModuleSpec } from "../contract/module.ts"

import { decodeEmptyHttpBody, httpWireCodec } from "../http-wire-codec.ts"

import {
  HandlerBundleOwnerSymbol,
  HandlerOwnerSymbol,
  assertOwnedHandler,
  type OwnedHandler,
  type OwnedHandlerBundle,
} from "./handler-ownership.ts"

import { HttpRequestDecodeError, hostCall } from "./callable-runtime.ts"

import type { CallableContextFields } from "./handler-types.ts"

import {
  provideConstrainedServerRuntime,
  type ConstrainedServerRuntimeMode,
} from "./runtime-layer.ts"

import type { HttpHandlerCtxLike } from "./runtime-types.ts"

import { type SyncRunner } from "./sync-runner.ts"

export const assertHandlerRecordOwnership = <
  RecordType extends Record<string, unknown>,
>(
  owner: symbol,
  section: string,
  record: RecordType,
) => {
  for (const [key, handler] of Object.entries(record)) {
    assertOwnedHandler(owner, handler as OwnedHandler, `${section}.${key}`)
  }
}

export const isOwnedHandler = (value: unknown): value is OwnedHandler =>
  typeof value === "object" && value !== null && HandlerOwnerSymbol in value

export const isOwnedHandlerBundle = (
  value: unknown,
): value is OwnedHandlerBundle =>
  typeof value === "object" &&
  value !== null &&
  HandlerBundleOwnerSymbol in value

export const assertKnownHandlerKey = (
  section: string,
  key: string,
  specs: Record<string, unknown>,
) => {
  if (!(key in specs)) {
    throw new Error(`Unknown ${section} handler key ${key}`)
  }
}

export const decodeHttpRequest = (
  spec: HttpHandlerSpec,
  request: Request,
): Effect.Effect<unknown, HttpRequestDecodeError> => {
  if (!isTypedHttpHandlerSpec(spec)) {
    return Effect.succeed(request)
  }

  return Effect.try({
    try: () => request.text(),
    catch: (cause) => new HttpRequestDecodeError({ cause }),
  }).pipe(
    Effect.flatMap((body) => {
      if (body.length === 0) {
        return decodeEmptyHttpBody(spec.request).pipe(
          Effect.mapError((cause) => new HttpRequestDecodeError({ cause })),
        )
      }

      return Schema.decodeUnknownEffect(httpWireCodec(spec.request))(body).pipe(
        Effect.mapError((cause) => new HttpRequestDecodeError({ cause })),
      )
    }),
  )
}

export const messageFromThrowable = (cause: unknown): string =>
  cause instanceof Error && cause.message.length > 0
    ? cause.message
    : String(cause)

export const logHttpHandlerBoundaryFailure = <Module extends AnyModuleSpec>(
  runner: SyncRunner,
  runtimeMode: ConstrainedServerRuntimeMode,
  ctx: HttpHandlerCtxLike<Module>,
  key: string,
  spec: HttpHandlerSpec,
  cause: unknown,
): void => {
  const route = `${spec.method.toUpperCase()} ${spec.path}`
  runner.runSync(
    provideConstrainedServerRuntime(
      Effect.logError(
        `SpaceTimeDB HTTP handler ${key} (${route}) returned 500 after an uncaught host-boundary failure: ${messageFromThrowable(cause)}`,
      ),
      ctx,
      runtimeMode,
    ),
  )
}

export type HandlerLogKind =
  | "reducer"
  | "procedure"
  | "httpHandler"
  | "view"
  | "lifecycle"

export type HandlerLogAnnotations = {
  readonly module: string
  readonly handler: string
  readonly kind: HandlerLogKind
}

export const senderLogValue = (sender: unknown): string => {
  if (
    typeof sender === "object" &&
    sender !== null &&
    typeof (sender as { readonly toHexString?: unknown }).toHexString ===
      "function"
  ) {
    const value = (
      sender as { readonly toHexString: () => unknown }
    ).toHexString()
    if (typeof value === "string") {
      return value
    }
  }

  return String(sender)
}

export const makeCallableContextHelpers = <
  ContextValue extends CallableContextFields,
  Requirements,
>(
  context: Effect.Effect<ContextValue, never, Requirements>,
  opPrefix: string,
) => ({
  sender: Effect.map(context, (ctx) => ctx.sender),
  identity: Effect.map(context, (ctx) => ctx.identity),
  timestamp: Effect.map(context, (ctx) => ctx.timestamp),
  connectionId: Effect.map(context, (ctx) => ctx.connectionId),
  random: Effect.map(context, (ctx) => ctx.random),
  newUuidV4: Effect.flatMap(context, (ctx) =>
    hostCall(`${opPrefix}.newUuidV4`, () => ctx.newUuidV4()),
  ),
  newUuidV7: Effect.flatMap(context, (ctx) =>
    hostCall(`${opPrefix}.newUuidV7`, () => ctx.newUuidV7()),
  ),
})

export const makeHttpHandlerContextHelpers = <
  ContextValue extends {
    readonly databaseIdentity: unknown
    readonly timestamp: unknown
    readonly random: unknown
    readonly newUuidV4: () => unknown
    readonly newUuidV7: () => unknown
  },
  Requirements,
>(
  context: Effect.Effect<ContextValue, never, Requirements>,
) => ({
  databaseIdentity: Effect.map(context, (ctx) => ctx.databaseIdentity),
  timestamp: Effect.map(context, (ctx) => ctx.timestamp),
  random: Effect.map(context, (ctx) => ctx.random),
  newUuidV4: Effect.flatMap(context, (ctx) =>
    hostCall("httpHandlerCtx.newUuidV4", () => ctx.newUuidV4()),
  ),
  newUuidV7: Effect.flatMap(context, (ctx) =>
    hostCall("httpHandlerCtx.newUuidV7", () => ctx.newUuidV7()),
  ),
})
