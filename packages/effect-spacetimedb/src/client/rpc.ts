import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Schema from "effect/Schema"
import type {
  HttpHandlerCallableDescriptor,
  ProcedureCallableDescriptor,
  ReducerCallableDescriptor,
} from "../callable-protocol.ts"
import { type ProcedureResultEnvelope } from "../callable-protocol.ts"
import type * as ErrorCodec from "../contract/error.ts"
import type { HttpHandlerSpec } from "../contract/http-handler.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"
import type {
  AnyValueType,
  StructLikeValueType,
  TypeOf,
} from "../contract/type.ts"
import type {
  HttpHandlers,
  PublicProcedures,
  PublicReducers,
} from "../module-projection.ts"
import { typedEntries } from "../utils.ts"
import type { CallFailure, RawCallFailure } from "./call-errors.ts"

export type PublicReducerKeys<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["reducers"] &
    string]: Module["reducers"][Key]["public"] extends false ? never : Key
}[keyof Module["reducers"] & string]

export type PublicProcedureKeys<Module extends AnyModuleSpec> = {
  readonly [Key in keyof Module["procedures"] &
    string]: Module["procedures"][Key]["public"] extends false ? never : Key
}[keyof Module["procedures"] & string]

export type HttpHandlerKeys<Module extends AnyModuleSpec> =
  keyof Module["httpHandlers"] & string

export type DeclaredErrorsOf<Spec> = Spec extends {
  readonly errors?: infer Definition extends ErrorCodec.AnyErrorDefinition
}
  ? ErrorCodec.ErrorInstances<Definition>
  : never

export type ParamsOf<
  Spec extends {
    readonly params: StructLikeValueType
  },
> = TypeOf<Spec["params"]>

export type ReturnsOf<
  Spec extends {
    readonly returns: AnyValueType
  },
> = TypeOf<Spec["returns"]>

export type HttpHandlerRequestOf<Spec extends HttpHandlerSpec> = Spec extends {
  readonly request: infer RequestSchema extends Schema.Top
}
  ? Schema.Schema.Type<RequestSchema>
  : string | undefined

export type HttpHandlerResponseOf<Spec extends HttpHandlerSpec> = Spec extends {
  readonly response: infer ResponseSchema extends Schema.Top
}
  ? Schema.Schema.Type<ResponseSchema>
  : string | undefined

export type ProcedureEnvelopeOf<Spec extends ProcedureSpec> =
  ProcedureResultEnvelope<
    ReturnsOf<Spec>,
    ErrorCodec.ProcedureDeclaredErrorCarrier
  >

type ReducerTransport<R> = <Spec extends ReducerSpec>(
  callable: ReducerCallableDescriptor<Spec>,
  payload: ParamsOf<Spec>,
) => Effect.Effect<void, CallFailure<DeclaredErrorsOf<Spec>>, R>

type RawReducerTransport<R> = <Spec extends ReducerSpec>(
  callable: ReducerCallableDescriptor<Spec>,
  payload: ParamsOf<Spec>,
) => Effect.Effect<void, RawCallFailure<DeclaredErrorsOf<Spec>>, R>

type ProcedureTransport<R> = <Spec extends ProcedureSpec>(
  callable: ProcedureCallableDescriptor<Spec>,
  payload: ParamsOf<Spec>,
) => Effect.Effect<ReturnsOf<Spec>, CallFailure<DeclaredErrorsOf<Spec>>, R>

type RawProcedureTransport<R> = <Spec extends ProcedureSpec>(
  callable: ProcedureCallableDescriptor<Spec>,
  payload: ParamsOf<Spec>,
) => Effect.Effect<ReturnsOf<Spec>, RawCallFailure<DeclaredErrorsOf<Spec>>, R>

export type HttpHandlerConcreteMethod =
  | "get"
  | "post"
  | "put"
  | "delete"
  | "patch"
  | "head"
  | "options"

export type HttpHandlerCallOptions = {
  readonly headers?: Record<string, string>
  readonly contentType?: string
}

type HttpHandlerArgs<Spec extends HttpHandlerSpec> =
  undefined extends HttpHandlerRequestOf<Spec>
    ? [payload?: HttpHandlerRequestOf<Spec>, options?: HttpHandlerCallOptions]
    : [payload: HttpHandlerRequestOf<Spec>, options?: HttpHandlerCallOptions]

type HttpHandlerTransport<R> = <Spec extends HttpHandlerSpec>(
  callable: HttpHandlerCallableDescriptor<Spec>,
  method: HttpHandlerConcreteMethod,
  payload: HttpHandlerRequestOf<Spec> | undefined,
  options?: HttpHandlerCallOptions,
) => Effect.Effect<
  HttpHandlerResponseOf<Spec>,
  CallFailure<DeclaredErrorsOf<Spec>>,
  R
>

export type ReducerRpcFunction<Spec extends ReducerSpec, R> = ((
  payload: ParamsOf<Spec>,
) => Effect.Effect<void, CallFailure<DeclaredErrorsOf<Spec>>, R>) & {
  readonly raw: (
    payload: ParamsOf<Spec>,
  ) => Effect.Effect<void, RawCallFailure<DeclaredErrorsOf<Spec>>, R>
}

export type ProcedureRpcFunction<Spec extends ProcedureSpec, R> = ((
  payload: ParamsOf<Spec>,
) => Effect.Effect<ReturnsOf<Spec>, CallFailure<DeclaredErrorsOf<Spec>>, R>) & {
  readonly raw: (
    payload: ParamsOf<Spec>,
  ) => Effect.Effect<ReturnsOf<Spec>, RawCallFailure<DeclaredErrorsOf<Spec>>, R>
}

export type HttpHandlerRpcFunction<
  Spec extends HttpHandlerSpec,
  R,
> = Spec["method"] extends "any"
  ? (
      method: HttpHandlerConcreteMethod,
      ...args: HttpHandlerArgs<Spec>
    ) => Effect.Effect<
      HttpHandlerResponseOf<Spec>,
      CallFailure<DeclaredErrorsOf<Spec>>,
      R
    >
  : (
      ...args: HttpHandlerArgs<Spec>
    ) => Effect.Effect<
      HttpHandlerResponseOf<Spec>,
      CallFailure<DeclaredErrorsOf<Spec>>,
      R
    >

const withRaw = <Args extends ReadonlyArray<unknown>, A, Raw>(
  call: (...args: Args) => A,
  raw: Raw,
): ((...args: Args) => A) & { readonly raw: Raw } =>
  Object.assign(call, { raw }) as ((...args: Args) => A) & {
    readonly raw: Raw
  }

export const make = <Module extends AnyModuleSpec, R>(options: {
  readonly reducers: PublicReducers<Module>
  readonly procedures: PublicProcedures<Module>
  readonly httpHandlers: HttpHandlers<Module>
  readonly reducerCallables: {
    readonly [Key in keyof Module["reducers"] &
      string]: ReducerCallableDescriptor<Module["reducers"][Key]>
  }
  readonly procedureCallables: {
    readonly [Key in keyof Module["procedures"] &
      string]: ProcedureCallableDescriptor<Module["procedures"][Key]>
  }
  readonly httpHandlerCallables: {
    readonly [Key in keyof Module["httpHandlers"] &
      string]: HttpHandlerCallableDescriptor<Module["httpHandlers"][Key]>
  }
  readonly callReducer: ReducerTransport<R>
  readonly callReducerRaw: RawReducerTransport<R>
  readonly callProcedure: ProcedureTransport<R>
  readonly callProcedureRaw: RawProcedureTransport<R>
  readonly callHttpHandler: HttpHandlerTransport<R>
}) => {
  const reducers = Object.fromEntries(
    typedEntries(options.reducers).map(([key, reducerSpec]) => {
      const callable = options.reducerCallables[
        key
      ] as ReducerCallableDescriptor<typeof reducerSpec>

      return [
        key,
        withRaw(
          (payload: ParamsOf<typeof reducerSpec>) =>
            options.callReducer(callable, payload),
          (payload: ParamsOf<typeof reducerSpec>) =>
            options.callReducerRaw(callable, payload),
        ),
      ] as const
    }),
  ) as unknown as {
    readonly [Key in PublicReducerKeys<Module>]: ReducerRpcFunction<
      Module["reducers"][Key],
      R
    >
  }

  const procedures = Object.fromEntries(
    typedEntries(options.procedures).map(([key, procedureSpec]) => {
      const callable = options.procedureCallables[
        key
      ] as ProcedureCallableDescriptor<typeof procedureSpec>

      return [
        key,
        withRaw(
          (payload: ParamsOf<typeof procedureSpec>) =>
            options.callProcedure(callable, payload),
          (payload: ParamsOf<typeof procedureSpec>) =>
            options.callProcedureRaw(callable, payload),
        ),
      ] as const
    }),
  ) as unknown as {
    readonly [Key in PublicProcedureKeys<Module>]: ProcedureRpcFunction<
      Module["procedures"][Key],
      R
    >
  }

  const httpHandlers = Object.fromEntries(
    typedEntries(options.httpHandlers).map(([key, httpHandlerSpec]) => {
      const callable = options.httpHandlerCallables[
        key
      ] as HttpHandlerCallableDescriptor<typeof httpHandlerSpec>

      const call = Match.value(httpHandlerSpec.method).pipe(
        Match.when(
          "any",
          () =>
            (
              method: HttpHandlerConcreteMethod,
              ...args: HttpHandlerArgs<typeof httpHandlerSpec>
            ) =>
              options.callHttpHandler(callable, method, args[0], args[1]),
        ),
        Match.whenOr(
          "get",
          "post",
          "put",
          "delete",
          "patch",
          "head",
          "options",
          (method) =>
            (...args: HttpHandlerArgs<typeof httpHandlerSpec>) =>
              options.callHttpHandler(callable, method, args[0], args[1]),
        ),
        Match.exhaustive,
      )

      return [key, call] as const
    }),
  ) as unknown as {
    readonly [Key in HttpHandlerKeys<Module>]: HttpHandlerRpcFunction<
      Module["httpHandlers"][Key],
      R
    >
  }

  return {
    reducers,
    procedures,
    httpHandlers,
  }
}
