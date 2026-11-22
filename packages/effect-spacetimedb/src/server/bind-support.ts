import * as Effect from "effect/Effect"

import * as Schema from "effect/Schema"
import type * as Tracer from "effect/Tracer"

import type { HttpHandlerSpec } from "../contract/http-handler.ts"

import { isTypedHttpHandlerSpec } from "../contract/http-handler.ts"
import { Request } from "../http-primitives.ts"

import { decodeEmptyHttpBody, httpWireCodec } from "../http-wire-codec.ts"
import { HttpRequestDecodeError } from "./callable-runtime.ts"
export const handlerSpanTraceOptions = {
  captureStackTrace: false,
} satisfies Tracer.TraceOptions

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
