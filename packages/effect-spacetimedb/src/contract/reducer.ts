import {
  normalizeErrorsInput,
  type AnyErrorDefinition,
  type DefinitionOfInputOrUndefined,
  type ErrorsInput,
} from "./error.ts"
import { struct, type StructLikeValueType } from "./type.ts"

export type ReducerSpec<
  Params extends StructLikeValueType = StructLikeValueType,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
  Public extends boolean = boolean,
> = {
  readonly kind: "reducer"
  readonly public: Public
  readonly params: Params
} & (Errors extends AnyErrorDefinition
  ? {
      readonly errors: Errors
    }
  : {
      readonly errors?: undefined
    })

const EmptyParams = struct({})

type ReducerDefineOptions = {
  readonly public?: boolean
  readonly params?: StructLikeValueType
  readonly errors?: ErrorsInput
}

type ParamsOf<Options extends ReducerDefineOptions | undefined> =
  Options extends {
    readonly params: infer Params extends StructLikeValueType
  }
    ? Params
    : typeof EmptyParams

type PublicOfOptions<Options extends ReducerDefineOptions | undefined> =
  Options extends {
    readonly public: infer Public extends boolean
  }
    ? Public
    : true

type ErrorsOfOptions<Options extends ReducerDefineOptions | undefined> =
  Options extends {
    readonly errors: infer Errors extends ErrorsInput
  }
    ? DefinitionOfInputOrUndefined<Errors>
    : undefined

export const define = <const Options extends ReducerDefineOptions | undefined>(
  options?: Options,
): ReducerSpec<
  ParamsOf<Options>,
  ErrorsOfOptions<Options>,
  PublicOfOptions<Options>
> => {
  const reducer = {
    kind: "reducer" as const,
    public: (options?.public ?? true) as PublicOfOptions<Options>,
    params: (options?.params ?? EmptyParams) as ParamsOf<Options>,
  }

  const errors =
    options?.errors === undefined
      ? undefined
      : normalizeErrorsInput(options.errors)

  return (
    errors != null
      ? {
          ...reducer,
          errors: errors as ErrorsOfOptions<Options>,
        }
      : reducer
  ) as ReducerSpec<
    ParamsOf<Options>,
    ErrorsOfOptions<Options>,
    PublicOfOptions<Options>
  >
}
