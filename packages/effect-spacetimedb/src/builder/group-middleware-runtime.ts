import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import {
  StdbDiagnostic,
  StdbValidationError,
} from "../contract/module-validation.ts"
import type { AnyEndpointDecl } from "./declarations.ts"

type ErasedMiddlewareEffect = Effect.Effect<unknown, never, never>

const isEffectValue = (value: unknown): boolean => Effect.isEffect(value)

const invalidMiddleware = (
  groupId: string,
  key: string | undefined,
  message: string,
): StdbValidationError =>
  new StdbValidationError({
    diagnostics: [
      new StdbDiagnostic({
        code: "InvalidGroupMiddleware",
        path: [
          "groups",
          groupId,
          "middleware",
          ...(key === undefined ? [] : [key]),
        ],
        message,
        severity: "error",
      }),
    ],
  })

export const assertValidGroupMiddleware = (
  groupId: string,
  middleware: unknown,
): void => {
  if (middleware === undefined || isEffectValue(middleware)) return
  if (middleware === null || typeof middleware !== "object") {
    throw invalidMiddleware(
      groupId,
      undefined,
      `Group ${groupId} middleware must be an Effect or a per-kind Effect record`,
    )
  }

  const allowedKeys = new Set(["reducers", "procedures", "httpHandlers"])
  for (const [key, candidate] of Object.entries(middleware)) {
    if (!allowedKeys.has(key) || !isEffectValue(candidate)) {
      throw invalidMiddleware(
        groupId,
        key,
        `Group ${groupId} middleware.${key} must be an Effect`,
      )
    }
  }
}

export const middlewareForDecl = (
  decl: AnyEndpointDecl,
  middleware: unknown,
): ErasedMiddlewareEffect | undefined => {
  if (decl.declKind === "view" || decl.declKind === "lifecycle") {
    return undefined
  }
  if (isEffectValue(middleware)) {
    return middleware as ErasedMiddlewareEffect
  }
  if (middleware === null || typeof middleware !== "object") {
    return undefined
  }

  const byKind = middleware as {
    readonly reducers?: unknown
    readonly procedures?: unknown
    readonly httpHandlers?: unknown
  }
  const candidate = Match.value(decl.declKind).pipe(
    Match.when("reducer", () => byKind.reducers),
    Match.when("procedure", () => byKind.procedures),
    Match.when("httpHandler", () => byKind.httpHandlers),
    Match.exhaustive,
  )
  return isEffectValue(candidate)
    ? (candidate as ErasedMiddlewareEffect)
    : undefined
}

export const prependMiddleware = (
  handler: unknown,
  middleware: ErasedMiddlewareEffect | undefined,
): unknown => {
  if (middleware === undefined || typeof handler !== "function") {
    return handler
  }
  const invoke = handler as (
    ...args: ReadonlyArray<unknown>
  ) => ErasedMiddlewareEffect
  return (...args: ReadonlyArray<unknown>) =>
    middleware.pipe(Effect.andThen(Effect.suspend(() => invoke(...args))))
}
