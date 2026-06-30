import type * as Schema from "effect/Schema"
import {
  normalizeErrorsInput,
  type AnyErrorDefinition,
  type DefinitionOfInput,
  type ErrorsInput,
} from "./error.ts"

export const HttpRouterExportKey = "__http_router__" as const

export type HttpHandlerMethod =
  | "get"
  | "post"
  | "put"
  | "delete"
  | "patch"
  | "head"
  | "options"
  | "any"

export type RawHttpHandlerSpec<
  Method extends HttpHandlerMethod = HttpHandlerMethod,
  Path extends string = string,
> = {
  readonly kind: "httpHandler"
  readonly method: Method
  readonly path: Path
  readonly request?: undefined
  readonly response?: undefined
  readonly errors?: undefined
  readonly successStatus?: number
}

export type TypedHttpHandlerSpec<
  Request extends Schema.Top = Schema.Top,
  Response extends Schema.Top = Schema.Top,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
  Method extends HttpHandlerMethod = HttpHandlerMethod,
  Path extends string = string,
> = {
  readonly kind: "httpHandler"
  readonly method: Method
  readonly path: Path
  readonly request: Request
  readonly response: Response
  readonly successStatus?: number
} & (Errors extends AnyErrorDefinition
  ? {
      readonly errors: Errors
    }
  : {
      readonly errors?: undefined
    })

export type HttpHandlerSpec<
  Request extends Schema.Top | undefined = Schema.Top | undefined,
  Response extends Schema.Top | undefined = Schema.Top | undefined,
  Errors extends AnyErrorDefinition | undefined =
    | AnyErrorDefinition
    | undefined,
  Method extends HttpHandlerMethod = HttpHandlerMethod,
  Path extends string = string,
> = Request extends Schema.Top
  ? Response extends Schema.Top
    ? TypedHttpHandlerSpec<Request, Response, Errors, Method, Path>
    : never
  : RawHttpHandlerSpec<Method, Path>

const hasDefinedSchemas = (value: {
  readonly request?: unknown
  readonly response?: unknown
}): boolean => value.request !== undefined && value.response !== undefined

export const isTypedHttpHandlerSpec = (
  spec: HttpHandlerSpec,
): spec is HttpHandlerSpec & {
  readonly request: NonNullable<HttpHandlerSpec["request"]>
  readonly response: NonNullable<HttpHandlerSpec["response"]>
} => hasDefinedSchemas(spec)

type RawHttpHandlerDefineOptions<
  Method extends HttpHandlerMethod,
  Path extends string,
> = {
  readonly method: Method
  readonly path: Path
  readonly request?: undefined
  readonly response?: undefined
  readonly errors?: undefined
  readonly successStatus?: number
  readonly public?: never
}

type TypedHttpHandlerDefineOptions<
  Request extends Schema.Top,
  Response extends Schema.Top,
  Errors extends ErrorsInput | undefined,
  Method extends HttpHandlerMethod,
  Path extends string,
> = {
  readonly method: Method
  readonly path: Path
  readonly request: Request
  readonly response: Response
  readonly errors?: Errors
  readonly successStatus?: number
  readonly public?: never
}

export function define<
  const Method extends HttpHandlerMethod,
  const Path extends string,
>(
  options: RawHttpHandlerDefineOptions<Method, Path>,
): RawHttpHandlerSpec<Method, Path>
export function define<
  const Request extends Schema.Top,
  const Response extends Schema.Top,
  const Errors extends ErrorsInput | undefined,
  const Method extends HttpHandlerMethod,
  const Path extends string,
>(
  options: TypedHttpHandlerDefineOptions<
    Request,
    Response,
    Errors,
    Method,
    Path
  >,
): TypedHttpHandlerSpec<
  Request,
  Response,
  Errors extends ErrorsInput ? DefinitionOfInput<Errors> : undefined,
  Method,
  Path
>
export function define(
  options:
    | RawHttpHandlerDefineOptions<HttpHandlerMethod, string>
    | TypedHttpHandlerDefineOptions<
        Schema.Top,
        Schema.Top,
        ErrorsInput | undefined,
        HttpHandlerMethod,
        string
      >,
): HttpHandlerSpec {
  const base = {
    kind: "httpHandler" as const,
    method: options.method,
    path: options.path,
    ...(options.successStatus === undefined
      ? {}
      : { successStatus: options.successStatus }),
  }

  if (hasDefinedSchemas(options)) {
    const typedOptions = options as TypedHttpHandlerDefineOptions<
      Schema.Top,
      Schema.Top,
      ErrorsInput | undefined,
      HttpHandlerMethod,
      string
    >
    const errors =
      typedOptions.errors === undefined
        ? undefined
        : normalizeErrorsInput(typedOptions.errors)
    return {
      ...base,
      request: typedOptions.request,
      response: typedOptions.response,
      ...(errors === undefined ? {} : { errors }),
    } as HttpHandlerSpec
  }

  return base as HttpHandlerSpec
}
