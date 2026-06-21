import {
  normalizeErrorsInput,
  type AnyErrorDefinition,
  type DefinitionOfInputOrUndefined,
  type ErrorsInput,
} from "./error.ts"
import { struct, type AnyValueType, type StructLikeValueType } from "./type.ts"

export type ProcedureSpec<
  Params extends StructLikeValueType = StructLikeValueType,
  Returns extends AnyValueType = AnyValueType,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
  Public extends boolean = boolean,
> = {
  readonly kind: "procedure"
  readonly public: Public
  readonly params: Params
  readonly returns: Returns
} & (Errors extends AnyErrorDefinition
  ? {
      readonly errors: Errors
    }
  : {
      readonly errors?: undefined
    })

const EmptyParams = struct({})

type ProcedureDefineOptions = {
  readonly public?: boolean
  readonly params?: StructLikeValueType
  readonly returns: AnyValueType
  readonly errors?: ErrorsInput
}

type ParamsOf<Options extends ProcedureDefineOptions> = Options extends {
  readonly params: infer Params extends StructLikeValueType
}
  ? Params
  : typeof EmptyParams

type ReturnsOf<Options extends ProcedureDefineOptions> = Options extends {
  readonly returns: infer Returns extends AnyValueType
}
  ? Returns
  : AnyValueType

type ErrorsOfOptions<Options extends ProcedureDefineOptions> = Options extends {
  readonly errors: infer Errors extends ErrorsInput
}
  ? DefinitionOfInputOrUndefined<Errors>
  : undefined

type PublicOfOptions<Options extends ProcedureDefineOptions> = Options extends {
  readonly public: infer Public extends boolean
}
  ? Public
  : true

export const define = <const Options extends ProcedureDefineOptions>(
  options: Options,
): ProcedureSpec<
  ParamsOf<Options>,
  ReturnsOf<Options>,
  ErrorsOfOptions<Options>,
  PublicOfOptions<Options>
> => {
  const procedure = {
    kind: "procedure" as const,
    public: (options.public ?? true) as PublicOfOptions<Options>,
    params: (options.params ?? EmptyParams) as ParamsOf<Options>,
    returns: options.returns as ReturnsOf<Options>,
  }

  const errors =
    options.errors === undefined
      ? undefined
      : normalizeErrorsInput(options.errors)

  return (
    errors != null
      ? {
          ...procedure,
          errors: errors as ErrorsOfOptions<Options>,
        }
      : procedure
  ) as ProcedureSpec<
    ParamsOf<Options>,
    ReturnsOf<Options>,
    ErrorsOfOptions<Options>,
    PublicOfOptions<Options>
  >
}
