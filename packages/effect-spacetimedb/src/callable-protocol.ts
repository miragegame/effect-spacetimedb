import * as Effect from "effect/Effect"
import * as ParseResult from "./schema-parse.ts"
import * as Schema from "effect/Schema"
import { transformOrFail } from "./schema-transform.ts"
import type * as ErrorCodec from "./contract/error.ts"
import type { HttpHandlerSpec } from "./contract/http-handler.ts"
import type { ProcedureSpec } from "./contract/procedure.ts"
import type { ReducerSpec } from "./contract/reducer.ts"
import {
  isAuthoredUnitPayloadEnvelope,
  isTaggedPayloadEnvelope,
  taggedEnvelopeOf,
} from "./contract/type/envelope.ts"
import { narrowSchema } from "./contract/type/wire-schema.ts"
import type * as Type from "./contract/type.ts"
import * as ValueType from "./contract/type.ts"

export type CallableKind = "reducer" | "procedure" | "httpHandler"

export type ReducerCallableDescriptor<Spec extends ReducerSpec = ReducerSpec> =
  {
    readonly kind: "reducer"
    readonly name: string
    readonly declaredName: string
    readonly params: Spec["params"]
    readonly errors: Spec["errors"]
    readonly spec: Spec
  }

export type ProcedureCallableDescriptor<
  Spec extends ProcedureSpec = ProcedureSpec,
> = {
  readonly kind: "procedure"
  readonly name: string
  readonly declaredName: string
  readonly params: Spec["params"]
  readonly returns: Spec["returns"]
  readonly errors: Spec["errors"]
  readonly spec: Spec
}

export type HttpHandlerCallableDescriptor<
  Spec extends HttpHandlerSpec = HttpHandlerSpec,
> = {
  readonly kind: "httpHandler"
  readonly name: string
  readonly declaredName: string
  readonly method: Spec["method"]
  readonly path: Spec["path"]
  readonly spec: Spec
}

export type CallableDescriptor =
  | ReducerCallableDescriptor
  | ProcedureCallableDescriptor
  | HttpHandlerCallableDescriptor

export const reducerCallable = <Spec extends ReducerSpec>(
  name: string,
  spec: Spec,
  declaredName = name,
): ReducerCallableDescriptor<Spec> => ({
  kind: "reducer",
  name,
  declaredName,
  params: spec.params,
  errors: spec.errors,
  spec,
})

export const procedureCallable = <Spec extends ProcedureSpec>(
  name: string,
  spec: Spec,
  declaredName = name,
): ProcedureCallableDescriptor<Spec> => ({
  kind: "procedure",
  name,
  declaredName,
  params: spec.params,
  returns: spec.returns,
  errors: spec.errors,
  spec,
})

export const httpHandlerCallable = <Spec extends HttpHandlerSpec>(
  name: string,
  spec: Spec,
  declaredName = name,
): HttpHandlerCallableDescriptor<Spec> => ({
  kind: "httpHandler",
  name,
  declaredName,
  method: spec.method,
  path: spec.path,
  spec,
})

export type ProcedureResultEnvelope<Return, Error> =
  | ([Return] extends [void]
      ? {
          readonly tag: "ok"
          readonly value?: Return
        }
      : {
          readonly tag: "ok"
          readonly value: Return
        })
  | {
      readonly tag: "err"
      readonly value: Error
    }

// Procedure specs are stable per module definition; this cache is intentionally
// identity-based rather than structural.
const procedureResponseTypeCache = new WeakMap<object, Type.AnyValueType>()

type ProcedureResponseTypeInput =
  | ProcedureSpec
  | ProcedureCallableDescriptor<ProcedureSpec>

const unexpectedEnvelope = (value: unknown): ParseResult.ParseIssue =>
  new ParseResult.Type(value, "Expected procedure result envelope")

const decodeEnvelopeValue = <A, Encoded>(
  schema: Schema.Codec<A, Encoded, never, never>,
  value: unknown,
) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((error) => error.issue),
  )

const encodeEnvelopeValue = <A, Encoded>(
  schema: Schema.Codec<A, Encoded, never, never>,
  value: A,
) =>
  Schema.encodeEffect(schema)(value).pipe(
    Effect.mapError((error) => error.issue),
  )

export const procedureEnvelope = <
  Returns extends Type.AnyValueType,
  Definition extends ErrorCodec.AnyErrorDefinition,
>(
  returns: Returns,
  definition: Definition,
) => {
  const returnsWireUnit = ValueType.isUnitValueType(returns)
  const returnsAuthoredUnit = ValueType.isAuthoredUnitValueType(returns)
  const errorsAreUnit = ValueType.isUnitValueType(definition.type)
  const schema = transformOrFail(Schema.Unknown, Schema.Unknown, {
    strict: true,
    decode: (encoded) => {
      const envelope = taggedEnvelopeOf(encoded)
      if (envelope === undefined) {
        return Effect.fail(unexpectedEnvelope(encoded))
      }

      if (envelope.tag === "ok") {
        if (
          !isTaggedPayloadEnvelope(envelope, {
            unit: returnsWireUnit,
            allowUnitWireValue: false,
          })
        ) {
          return Effect.fail(unexpectedEnvelope(encoded))
        }

        if (returnsWireUnit) {
          return decodeEnvelopeValue(returns.schema, undefined).pipe(
            returnsAuthoredUnit
              ? Effect.as({ tag: "ok" as const })
              : Effect.map((value) => ({ tag: "ok" as const, value })),
          )
        }

        return decodeEnvelopeValue(returns.schema, envelope.value).pipe(
          returnsAuthoredUnit
            ? Effect.as({ tag: "ok" as const })
            : Effect.map((value) => ({ tag: "ok" as const, value })),
        )
      }

      if (envelope.tag === "err") {
        if (
          !isTaggedPayloadEnvelope(envelope, {
            unit: errorsAreUnit,
            allowUnitWireValue: false,
          })
        ) {
          return Effect.fail(unexpectedEnvelope(encoded))
        }

        return errorsAreUnit
          ? decodeEnvelopeValue(definition.type.schema, undefined).pipe(
              Effect.map((value) => ({ tag: "err" as const, value })),
            )
          : decodeEnvelopeValue(definition.type.schema, envelope.value).pipe(
              Effect.map((value) => ({ tag: "err" as const, value })),
            )
      }

      return Effect.fail(unexpectedEnvelope(encoded))
    },
    encode: (value) => {
      const envelope = taggedEnvelopeOf(value)
      if (envelope === undefined) {
        return Effect.fail(unexpectedEnvelope(value))
      }

      if (envelope.tag === "ok") {
        if (returnsAuthoredUnit) {
          if (!isAuthoredUnitPayloadEnvelope(envelope)) {
            return Effect.fail(unexpectedEnvelope(value))
          }
          return encodeEnvelopeValue(
            returns.schema,
            (envelope.hasValue ? envelope.value : undefined) as Returns["Type"],
          ).pipe(
            returnsWireUnit
              ? Effect.as({ tag: "ok" as const })
              : Effect.map((encoded) => ({
                  tag: "ok" as const,
                  value: encoded,
                })),
          )
        }

        if (
          !isTaggedPayloadEnvelope(envelope, {
            unit: false,
            allowUnitWireValue: false,
          })
        ) {
          return Effect.fail(unexpectedEnvelope(value))
        }

        return encodeEnvelopeValue(
          returns.schema,
          envelope.value as Returns["Type"],
        ).pipe(
          returnsWireUnit
            ? Effect.as({ tag: "ok" as const })
            : Effect.map((encoded) => ({ tag: "ok" as const, value: encoded })),
        )
      }

      if (envelope.tag === "err") {
        if (errorsAreUnit) {
          if (!isAuthoredUnitPayloadEnvelope(envelope)) {
            return Effect.fail(unexpectedEnvelope(value))
          }
          return encodeEnvelopeValue(
            definition.type.schema,
            undefined as unknown as Definition["type"]["Type"],
          ).pipe(Effect.as({ tag: "err" as const }))
        }

        if (
          !isTaggedPayloadEnvelope(envelope, {
            unit: false,
            allowUnitWireValue: false,
          })
        ) {
          return Effect.fail(unexpectedEnvelope(value))
        }

        return encodeEnvelopeValue(
          definition.type.schema,
          envelope.value as Definition["type"]["Type"],
        ).pipe(
          Effect.map((encoded) => ({ tag: "err" as const, value: encoded })),
        )
      }

      return Effect.fail(unexpectedEnvelope(value))
    },
  }).pipe(
    narrowSchema<
      ProcedureResultEnvelope<
        Returns["Type"],
        ErrorCodec.ProcedureDeclaredErrorCarrier
      >,
      ProcedureResultEnvelope<
        Returns["Encoded"],
        ErrorCodec.ProcedureDeclaredErrorCarrier
      >
    >,
  )

  // HTTP procedure calls can receive route-shaped SATS enum payloads. Attach a
  // result descriptor so transport normalization can decode nested ok/err
  // values before the schema sees the object envelope.
  return ValueType.attachStdbType(
    schema,
    (factories) =>
      factories.result(
        returnsWireUnit
          ? factories.unit()
          : ValueType.typeBuilderWithFactories(returns, factories),
        ValueType.typeBuilderWithFactories(definition.type, factories),
      ),
    {
      kind: "result",
      members: [returns, definition.type],
    },
  )
}

const procedureSpecFromInput = (
  input: ProcedureResponseTypeInput,
): ProcedureSpec => ("spec" in input ? input.spec : input)

export const procedureResponseType = (
  input: ProcedureResponseTypeInput,
): Type.AnyValueType => {
  const spec = procedureSpecFromInput(input)
  if (spec.errors == null) {
    return spec.returns
  }

  const cached = procedureResponseTypeCache.get(spec)
  if (cached != null) {
    return cached
  }

  const responseType = procedureEnvelope(spec.returns, spec.errors)
  procedureResponseTypeCache.set(spec, responseType)
  return responseType
}
