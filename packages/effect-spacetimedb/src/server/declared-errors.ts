import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as ErrorCodec from "../contract/error.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import { StdbDecodeError } from "../decode-error.ts"
import {
  StdbDeclaredErrorEncodingFailure,
  StdbSenderFailure,
} from "./services.ts"

export type ProcedureHostResultEnvelope<Return, Error> =
  | {
      readonly ok: Return
    }
  | {
      readonly err: Error
    }

export const declaredErrorFromCause = <
  Definition extends ErrorCodec.AnyErrorDefinition,
>(
  definition: Definition,
  cause: Cause.Cause<unknown>,
): Effect.Effect<
  Option.Option<ErrorCodec.ErrorInstances<Definition>>,
  StdbDecodeError,
  never
> => {
  if (Cause.hasDies(cause)) {
    return Effect.succeed(Option.none())
  }

  const failure = cause.pipe(Cause.findErrorOption, Option.getOrUndefined)
  if (failure !== undefined) {
    return ErrorCodec.matchEffect(definition, failure)
  }

  return Effect.succeed(Option.none())
}

export const encodeDeclaredReducerFailure = <Spec extends ReducerSpec, A, E, R>(
  spec: Spec,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<
  A,
  E | StdbDecodeError | StdbSenderFailure | StdbDeclaredErrorEncodingFailure,
  R
> => {
  if (spec.errors == null) {
    return effect
  }

  const errors = spec.errors
  return effect.pipe(
    Effect.matchCauseEffect({
      onSuccess: Effect.succeed,
      onFailure: (cause) =>
        declaredErrorFromCause(errors, cause).pipe(
          Effect.catchTag("StdbDecodeError", () =>
            Effect.logWarning(
              "Failed to classify declared reducer error; preserving original failure cause",
            ).pipe(Effect.andThen(Effect.failCause(cause))),
          ),
          Effect.flatMap(
            (
              matched,
            ): Effect.Effect<
              A,
              | E
              | StdbDecodeError
              | StdbSenderFailure
              | StdbDeclaredErrorEncodingFailure,
              R
            > => {
              if (Option.isNone(matched)) {
                return Effect.failCause(cause)
              }

              return ErrorCodec.encodeString(errors, matched.value).pipe(
                Effect.mapError(
                  (cause) =>
                    new StdbDeclaredErrorEncodingFailure({
                      callable: "reducer",
                      cause,
                    }),
                ),
                Effect.flatMap((value) =>
                  Effect.fail(new StdbSenderFailure({ value })),
                ),
              )
            },
          ),
        ),
    }),
  )
}

export const encodeDeclaredProcedureFailure = <
  Spec extends ProcedureSpec,
  A,
  E,
  R,
>(
  spec: Spec,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<
  A | ProcedureHostResultEnvelope<A, ErrorCodec.ProcedureDeclaredErrorCarrier>,
  E | StdbDecodeError | StdbDeclaredErrorEncodingFailure,
  R
> => {
  if (spec.errors == null) {
    return effect
  }

  const errors = spec.errors
  return effect.pipe(
    Effect.matchCauseEffect({
      onSuccess: (value) => {
        const envelope = {
          ok: value,
        } as ProcedureHostResultEnvelope<
          A,
          ErrorCodec.ProcedureDeclaredErrorCarrier
        >
        return Effect.succeed(envelope)
      },
      onFailure: (cause) =>
        declaredErrorFromCause(errors, cause).pipe(
          Effect.catchTag("StdbDecodeError", () =>
            Effect.logWarning(
              "Failed to classify declared procedure error; preserving original failure cause",
            ).pipe(Effect.andThen(Effect.failCause(cause))),
          ),
          Effect.flatMap(
            (
              matched,
            ): Effect.Effect<
              ProcedureHostResultEnvelope<
                A,
                ErrorCodec.ProcedureDeclaredErrorCarrier
              >,
              E | StdbDecodeError | StdbDeclaredErrorEncodingFailure,
              R
            > => {
              if (Option.isNone(matched)) {
                return Effect.failCause(cause)
              }

              return ErrorCodec.encodeString(errors, matched.value).pipe(
                Effect.mapError(
                  (cause) =>
                    new StdbDeclaredErrorEncodingFailure({
                      callable: "procedure",
                      cause,
                    }),
                ),
                Effect.map((value) => ({ err: value })),
              )
            },
          ),
        ),
    }),
  )
}
