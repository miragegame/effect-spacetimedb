import { testEffectCallbackError } from "../helpers/effect-errors"
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as HttpApi from "effect/unstable/httpapi/HttpApi"
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import { makeMockHttpClientLayer } from "../helpers/mock-http-client"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)
const emptyWireNames: Stdb.AnyModuleSpec["wireNames"] = {
  tables: {},
  views: {},
  functions: {},
}
const withWireNames = <
  const Module extends Omit<Stdb.AnyModuleSpec, "wireNames" | "diagnostics">,
>(
  module: Module,
): Module & Pick<Stdb.AnyModuleSpec, "wireNames" | "diagnostics"> => ({
  ...module,
  wireNames: emptyWireNames,
  diagnostics: [],
})

class TokenMissing extends Schema.TaggedErrorClass<TokenMissing>()(
  "TokenMissing",
  { userId: Schema.String },
  { httpApiStatus: 404 },
) {}

class TokenInvalid extends Schema.TaggedErrorClass<TokenInvalid>()(
  "TokenInvalid",
  { reason: Schema.String },
  { httpApiStatus: 400 },
) {}

class TokenExpired extends Schema.TaggedErrorClass<TokenExpired>()(
  "TokenExpired",
  { expiredAt: Schema.String },
  { httpApiStatus: 401 },
) {}

const ProjectionErrors = Stdb.errors(TokenMissing, TokenInvalid, TokenExpired)

const RotateTokenRequest = Schema.Struct({
  scenario: Schema.String,
})

const RotateTokenResponse = Schema.Struct({
  token: Schema.String,
})

const IssueTokenRequest = Schema.Struct({
  userId: Schema.String,
})

const IssueTokenResponse = Schema.Struct({
  issued: Schema.Boolean,
})

const CreateWidgetRequest = Schema.Struct({
  name: Schema.String,
})

const CreateWidgetResponse = Schema.Struct({
  widgetId: Schema.String,
})

const WebhooksGroup = Stdb.StdbHttpGroup.make("Webhooks").add(
  Stdb.StdbHttp.post("rotateToken", "/server-tokens/rotate", {
    request: RotateTokenRequest,
    response: RotateTokenResponse,
    errors: ProjectionErrors,
  }),
  Stdb.StdbHttp.post("issueToken", "/server-tokens/issue", {
    request: IssueTokenRequest,
    response: IssueTokenResponse,
  }),
  Stdb.StdbHttp.post("rawWebhook", "/webhook"),
  Stdb.StdbHttp.any("typedAny", "/typed-any", {
    request: RotateTokenRequest,
    response: RotateTokenResponse,
  }),
  Stdb.StdbHttp.get("typedGet", "/typed-get", {
    request: RotateTokenRequest,
    response: RotateTokenResponse,
  }),
)

const AdminGroup = Stdb.StdbHttpGroup.make("Admin").add(
  Stdb.StdbHttp.post("createWidget", "/admin/widgets", {
    request: CreateWidgetRequest,
    response: CreateWidgetResponse,
  }),
)

const NonProjectableGroup = Stdb.StdbHttpGroup.make("Diagnostics").add(
  Stdb.StdbHttp.get("health", "/health", {
    request: Schema.Struct({ verbose: Schema.Boolean }),
    response: Schema.Struct({ ok: Schema.Boolean }),
  }),
  Stdb.StdbHttp.post("rawProbe", "/probe"),
)

const ProjectionBuilderModule = Stdb.StdbModule.make(
  "http_api_projection",
  {},
).add(WebhooksGroup, AdminGroup, NonProjectableGroup)
const ProjectionModule = ProjectionBuilderModule.spec

const projectedShape = (api: HttpApi.AnyWithProps) => {
  const groups: Record<
    string,
    { readonly topLevel: boolean; readonly endpoints: Array<string> }
  > = {}
  HttpApi.reflect(api, {
    onGroup: ({ group }) => {
      groups[group.identifier] = {
        topLevel: group.topLevel,
        endpoints: [],
      }
    },
    onEndpoint: ({ endpoint, group }) => {
      groups[group.identifier]?.endpoints.push(endpoint.name)
    },
  })

  return Object.fromEntries(
    Object.entries(groups)
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
      .map(([name, group]) => [
        name,
        {
          ...group,
          endpoints: group.endpoints.sort(),
        },
      ]),
  )
}

const jsonBody = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

const MockHttpClientLayer = makeMockHttpClientLayer((request) => {
  expect(request.method).toBe("POST")

  switch (request.url.href) {
    case "http://stdb.test/v1/database/projection/route/server-tokens/rotate":
      switch ((request.body as { readonly scenario?: string }).scenario) {
        case "success":
          return Effect.succeed({
            body: jsonBody({ token: "rotated" }),
          })
        case "missing":
          return Effect.succeed({
            status: 404,
            body: jsonBody({ _tag: "TokenMissing", userId: "missing-user" }),
          })
        case "invalid":
          return Effect.succeed({
            status: 400,
            body: jsonBody({ _tag: "TokenInvalid", reason: "bad-signature" }),
          })
        case "expired":
          return Effect.succeed({
            status: 401,
            body: jsonBody({ _tag: "TokenExpired", expiredAt: "2026-01-01" }),
          })
      }
      break
    case "http://stdb.test/v1/database/projection/route/server-tokens/issue":
      expect(request.body).toEqual({ userId: "new-user" })
      return Effect.succeed({
        body: jsonBody({ issued: true }),
      })
    case "http://stdb.test/v1/database/projection/route/admin/widgets":
      expect(request.body).toEqual({ name: "widget" })
      return Effect.succeed({
        body: jsonBody({ widgetId: "widget-1" }),
      })
  }

  return Effect.succeed({
    status: 500,
    body: "unexpected request",
  })
})

const MalformedModule = withWireNames({
  kind: "module" as const,
  name: "missing_http_groups",
  settings: {},
  tables: {},
  views: {},
  reducers: {},
  procedures: {},
  httpHandlers: {
    orphan: Stdb.StdbHttp.post("orphan", "/orphan", {
      request: RotateTokenRequest,
      response: RotateTokenResponse,
    }).spec,
  },
  httpGroups: {},
  reducerGroups: {},
  procedureGroups: {},
  lifecycle: {},
})

const MissingHttpGroupsFieldModule = {
  kind: "module" as const,
  name: "missing_http_groups_field",
  settings: {},
  tables: {},
  views: {},
  reducers: {},
  procedures: {},
  httpHandlers: {
    orphan: Stdb.StdbHttp.post("orphan", "/orphan", {
      request: RotateTokenRequest,
      response: RotateTokenResponse,
    }).spec,
  },
  wireNames: emptyWireNames,
  lifecycle: {},
} as unknown as typeof MalformedModule

describe("HTTP API projection", (it) => {
  it.effect(
    "accepts built modules wherever public projection accepts specs",
    () =>
      Effect.try({
        try: () => {
          const fromModule = Stdb.project(ProjectionBuilderModule)
          const fromSpec = Stdb.project(ProjectionModule)

          expect(fromModule.module).toEqual(ProjectionModule)
          expect(fromSpec.module).toEqual(ProjectionModule)
          expect(fromModule.targets.allPublicTables()).toEqual(
            fromSpec.targets.allPublicTables(),
          )
          expect(
            projectedShape(Stdb.toHttpApi(ProjectionBuilderModule)),
          ).toEqual(projectedShape(Stdb.toHttpApi(ProjectionModule)))
          expect(Stdb.validate(ProjectionBuilderModule)).toEqual(
            Stdb.validate(ProjectionModule),
          )
          expect(() => Stdb.assertValid(ProjectionBuilderModule)).not.toThrow()
          expect(() => Stdb.assertValid(ProjectionModule)).not.toThrow()
          expect(() =>
            Stdb.assertValid({ spec: { kind: "not-module" } } as never),
          ).toThrow()
        },
        catch: testEffectCallbackError(
          "effect-spacetimedb/unit/http-api-projection",
        ),
      }).pipe(Effect.orDie),
  )

  it.effect(
    "projects typed body routes into nested groups and decodes declared errors",
    () =>
      Effect.gen(function* () {
        const api = Stdb.toHttpApi(ProjectionModule)

        expect(projectedShape(api)).toEqual({
          Admin: {
            topLevel: false,
            endpoints: ["createWidget"],
          },
          Webhooks: {
            topLevel: false,
            endpoints: ["issueToken", "rotateToken"],
          },
        })
        expect(
          Stdb.httpApiBaseUrl({
            uri: "http://stdb.test/",
            databaseName: "projection",
          }),
        ).toBe("http://stdb.test/v1/database/projection/route")

        const client = yield* HttpApiClient.make(api, {
          baseUrl: Stdb.httpApiBaseUrl({
            uri: "http://stdb.test/",
            databaseName: "projection",
          }),
        })

        expect("rotateToken" in client).toBe(false)
        expect("Webhooks" in client).toBe(true)
        expect("Admin" in client).toBe(true)
        expect("Diagnostics" in client).toBe(false)
        expect("rawWebhook" in client.Webhooks).toBe(false)
        expect("typedAny" in client.Webhooks).toBe(false)
        expect("typedGet" in client.Webhooks).toBe(false)
        expect("createWidget" in client.Webhooks).toBe(false)

        const success = yield* client.Webhooks.rotateToken({
          payload: { scenario: "success" },
        })
        expect(success).toEqual({ token: "rotated" })

        const issued = yield* client.Webhooks.issueToken({
          payload: { userId: "new-user" },
        })
        expect(issued).toEqual({ issued: true })

        const created = yield* client.Admin.createWidget({
          payload: { name: "widget" },
        })
        expect(created).toEqual({ widgetId: "widget-1" })

        const missing = yield* client.Webhooks.rotateToken({
          payload: { scenario: "missing" },
        }).pipe(Effect.flip)
        expect(missing).toBeInstanceOf(TokenMissing)
        expect(missing).toMatchObject({
          _tag: "TokenMissing",
          userId: "missing-user",
        })

        const invalid = yield* client.Webhooks.rotateToken({
          payload: { scenario: "invalid" },
        }).pipe(Effect.flip)
        expect(invalid).toBeInstanceOf(TokenInvalid)
        expect(invalid).toMatchObject({
          _tag: "TokenInvalid",
          reason: "bad-signature",
        })

        const expired = yield* client.Webhooks.rotateToken({
          payload: { scenario: "expired" },
        }).pipe(Effect.flip)
        expect(expired).toBeInstanceOf(TokenExpired)
        expect(expired).toMatchObject({
          _tag: "TokenExpired",
          expiredAt: "2026-01-01",
        })
      }).pipe(Effect.provide(MockHttpClientLayer)),
  )

  it.effect("fails fast when a projectable route has no HTTP group entry", () =>
    Effect.try({
      try: () => {
        expect(() => Stdb.toHttpApi(MalformedModule)).toThrow(
          Stdb.StdbHttpProjectionError,
        )
      },
      catch: testEffectCallbackError(
        "effect-spacetimedb/unit/http-api-projection",
      ),
    }).pipe(Effect.orDie),
  )

  it.effect("fails fast when a malformed spec omits HTTP groups", () =>
    Effect.try({
      try: () => {
        expect(() => Stdb.toHttpApi(MissingHttpGroupsFieldModule)).toThrow(
          Stdb.StdbHttpProjectionError,
        )
      },
      catch: testEffectCallbackError(
        "effect-spacetimedb/unit/http-api-projection",
      ),
    }).pipe(Effect.orDie),
  )
})
