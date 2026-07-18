import * as Data from "effect/Data"
import * as Match from "effect/Match"
import * as Schema from "effect/Schema"
import type * as HttpMethod from "effect/unstable/http/HttpMethod"
import * as HttpApi from "effect/unstable/httpapi/HttpApi"
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint"
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup"
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema"
import { statusOf, type AnyErrorDefinition } from "../contract/error.ts"
import {
  isTypedHttpHandlerSpec,
  type HttpHandlerMethod,
  type HttpHandlerSpec,
  type TypedHttpHandlerSpec,
} from "../contract/http-handler.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import { isHttpEmptySchema } from "../http-wire-codec.ts"
import {
  moduleSpecOf,
  type ModuleSpecInput,
  type SpecOf,
} from "../module-input.ts"
import { normalizeBaseUri } from "./http.ts"

type ProjectableHttpMethod = Extract<
  HttpHandlerMethod,
  "post" | "put" | "patch"
>

type ProjectableTypedHttpHandlerSpec = TypedHttpHandlerSpec<
  Schema.Top,
  Schema.Top,
  AnyErrorDefinition | undefined,
  ProjectableHttpMethod,
  string
>

type HttpApiMethod<Method extends ProjectableHttpMethod> =
  Uppercase<Method> extends HttpMethod.HttpMethod ? Uppercase<Method> : never

type DeclaredErrorSchema<Errors extends AnyErrorDefinition | undefined> =
  Errors extends AnyErrorDefinition ? Errors["errors"][number] : never

type ProjectedEndpoint<
  Name extends string,
  Spec,
> = Spec extends TypedHttpHandlerSpec<
  infer Request,
  infer Response,
  infer Errors,
  infer Method,
  infer Path
>
  ? Method extends ProjectableHttpMethod
    ? HttpApiEndpoint.HttpApiEndpoint<
        Name,
        HttpApiMethod<Method>,
        Path,
        never,
        never,
        HttpApiEndpoint.Json<Request>,
        never,
        HttpApiEndpoint.Json<Response>,
        HttpApiEndpoint.Json<DeclaredErrorSchema<Errors>>
      >
    : never
  : never

type ProjectedEndpointMap<Module extends AnyModuleSpec> = {
  readonly [Name in keyof Module["httpHandlers"] & string]: ProjectedEndpoint<
    Name,
    Module["httpHandlers"][Name]
  >
}

type EndpointsInGroup<Module extends AnyModuleSpec, Group extends string> = {
  [Name in keyof Module["httpHandlers"] &
    string]: Name extends keyof Module["httpGroups"]
    ? Module["httpGroups"][Name] extends Group
      ? ProjectedEndpointMap<Module>[Name]
      : never
    : never
}[keyof Module["httpHandlers"] & string]

type ProjectedGroups<Module extends AnyModuleSpec> = {
  [Group in Module["httpGroups"][keyof Module["httpGroups"] & string]]: [
    EndpointsInGroup<Module, Group>,
  ] extends [never]
    ? never
    : HttpApiGroup.HttpApiGroup<
        Group & string,
        EndpointsInGroup<Module, Group>,
        false
      >
}[Module["httpGroups"][keyof Module["httpGroups"] & string]]

export type ProjectedHttpApi<Module extends AnyModuleSpec> = HttpApi.HttpApi<
  Module["name"],
  ProjectedGroups<Module>
>

export class StdbHttpProjectionError extends Data.TaggedError(
  "StdbHttpProjectionError",
)<{
  readonly route: string
}> {
  override get message(): string {
    return `Projectable STDB HTTP route ${this.route} is missing an httpGroups entry`
  }
}

const isProjectableHttpMethod = (
  method: HttpHandlerMethod,
): method is ProjectableHttpMethod =>
  method === "post" || method === "put" || method === "patch"

const isProjectableTypedRoute = (
  spec: HttpHandlerSpec,
): spec is ProjectableTypedHttpHandlerSpec =>
  isTypedHttpHandlerSpec(spec) && isProjectableHttpMethod(spec.method)

const successSchema = (spec: ProjectableTypedHttpHandlerSpec): Schema.Top => {
  const status = spec.successStatus ?? 200

  if (isHttpEmptySchema(spec.response)) {
    return HttpApiSchema.Empty(status)
  }

  return status === 200
    ? spec.response
    : spec.response.pipe(HttpApiSchema.status(status))
}

const errorSchemas = (
  spec: ProjectableTypedHttpHandlerSpec,
): ReadonlyArray<Schema.Top> =>
  spec.errors?.errors.map((errorClass) =>
    errorClass.pipe(HttpApiSchema.status(statusOf(errorClass) ?? 400)),
  ) ?? []

const endpointOptions = (spec: ProjectableTypedHttpHandlerSpec) => {
  const errors = errorSchemas(spec)
  const options = {
    payload: spec.request,
    success: successSchema(spec),
  }

  return errors.length === 0 ? options : { ...options, error: errors }
}

const makeEndpoint = (
  name: string,
  spec: ProjectableTypedHttpHandlerSpec,
): HttpApiEndpoint.AnyWithProps => {
  const path = spec.path as `/${string}`

  return Match.value(spec.method).pipe(
    Match.when("post", () =>
      HttpApiEndpoint.post(name, path, endpointOptions(spec)),
    ),
    Match.when("put", () =>
      HttpApiEndpoint.put(name, path, endpointOptions(spec)),
    ),
    Match.when("patch", () =>
      HttpApiEndpoint.patch(name, path, endpointOptions(spec)),
    ),
    Match.exhaustive,
  )
}

/**
 * Project a module spec's typed STDB HTTP routes into a canonical Effect
 * `HttpApi`.
 *
 * The projection is pure and client-direction only. It emits one
 * `HttpApiGroup` per authored `StdbHttpGroup`, preserving those group ids as
 * `HttpApiClient` property keys. Within those groups it emits typed `post`,
 * `put`, and `patch` routes, because those are the methods whose
 * `HttpApiClient` payload encoding is a JSON request body. Raw
 * routes and typed `get`, `head`, `options`, `delete`, and `any` routes are
 * intentionally omitted: raw routes have no schemas, `any` has no canonical
 * `HttpApiEndpoint` method, and no-body methods would encode typed payloads into
 * the URL instead of the STDB route body.
 *
 * ```ts
 * const api = Stdb.toHttpApi(Module)
 * const client = yield* HttpApiClient.make(api, {
 *   baseUrl: Stdb.httpApiBaseUrl({ uri, databaseName }),
 *   transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(token)),
 * })
 * const out = yield* client.Webhooks.rotate_token({ payload: { userId } })
 * ```
 */
export const toHttpApi = <const Input extends ModuleSpecInput>(
  input: Input,
): ProjectedHttpApi<SpecOf<Input>> => {
  const moduleSpec = moduleSpecOf(input)
  const byGroup = new Map<string, Array<HttpApiEndpoint.AnyWithProps>>()
  const httpGroups: Partial<Record<string, string>> = Object.hasOwn(
    moduleSpec,
    "httpGroups",
  )
    ? moduleSpec.httpGroups
    : {}

  for (const [name, spec] of Object.entries(moduleSpec.httpHandlers)) {
    if (!isProjectableTypedRoute(spec)) {
      continue
    }

    const groupName = httpGroups[name]
    if (groupName === undefined) {
      throw new StdbHttpProjectionError({ route: name })
    }

    const endpoints = byGroup.get(groupName) ?? []
    endpoints.push(makeEndpoint(name, spec))
    byGroup.set(groupName, endpoints)
  }

  let api = HttpApi.make(moduleSpec.name) as HttpApi.AnyWithProps

  for (const groupName of [...byGroup.keys()].sort()) {
    let group = HttpApiGroup.make(groupName) as HttpApiGroup.AnyWithProps
    for (const endpoint of byGroup.get(groupName) ?? []) {
      group = group.add(endpoint)
    }
    api = api.add(group)
  }

  // Object.entries erases the literal route and group names kept by the type.
  return api as ProjectedHttpApi<SpecOf<Input>>
}

/**
 * Build the STDB host route prefix for `HttpApiClient.make(api, { baseUrl })`.
 */
export const httpApiBaseUrl = (config: {
  readonly uri: string
  readonly databaseName: string
}): string =>
  `${normalizeBaseUri(config.uri)}/v1/database/${config.databaseName}/route`
