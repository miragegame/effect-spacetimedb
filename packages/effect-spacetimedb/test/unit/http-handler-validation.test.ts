import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Schema from "effect/Schema"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import { rawHttpHandlerSpec, rawReducerSpec } from "../helpers/module-builders"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const moduleWithHttpHandlers = (
  httpHandlers: Record<string, unknown>,
  reducers: Record<string, unknown> = {},
) =>
  ({
    kind: "module" as const,
    name: "http_validation",
    settings: {},
    tables: {},
    views: {},
    reducers,
    procedures: {},
    httpHandlers,
    httpGroups: Object.fromEntries(
      Object.keys(httpHandlers).map((name) => [name, "Http"]),
    ),
    lifecycle: {},
  }) as never

const httpHandler = (options: {
  readonly method: Stdb.HttpHandlerMethod
  readonly path: string
}) => rawHttpHandlerSpec(options)

describe("HTTP handler validation", (it) => {
  it.effect("enforces literal lowercase route paths with root allowed", () =>
    Effect.gen(function* () {
      const diagnostics = Stdb.validate(
        moduleWithHttpHandlers({
          colon: httpHandler({ method: "get", path: "/users/:id" }),
          wildcard: httpHandler({ method: "get", path: "/users/*" }),
          uppercase: httpHandler({ method: "get", path: "/Users" }),
          trailing: httpHandler({ method: "get", path: "/users/" }),
          empty: httpHandler({ method: "get", path: "" }),
          root: httpHandler({ method: "get", path: "/" }),
        }),
      )

      expect(
        diagnostics.filter((entry) => entry.code === "InvalidHttpHandlerPath"),
      ).toHaveLength(5)
      expect(
        diagnostics.some(
          (entry) => entry.path.join(".") === "httpHandlers.root.path",
        ),
      ).toBe(false)
    }),
  )

  it.effect("rejects SDK-equivalent route overlaps including any", () =>
    Effect.gen(function* () {
      const diagnostics = Stdb.validate(
        moduleWithHttpHandlers({
          first: httpHandler({ method: "any", path: "/x" }),
          second: httpHandler({ method: "get", path: "/x" }),
          third: httpHandler({ method: "post", path: "/x" }),
          other: httpHandler({ method: "get", path: "/y" }),
        }),
      )

      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "DuplicateHttpHandlerRoute",
            path: ["httpHandlers", "second"],
          }),
          expect.objectContaining({
            code: "DuplicateHttpHandlerRoute",
            path: ["httpHandlers", "third"],
          }),
        ]),
      )
    }),
  )

  it.effect("rejects callable name collisions and reserved router key", () =>
    Effect.gen(function* () {
      const diagnostics = Stdb.validate(
        moduleWithHttpHandlers(
          {
            ping: httpHandler({ method: "get", path: "/ping" }),
            [Stdb.HttpRouterExportKey]: httpHandler({
              method: "get",
              path: "/reserved",
            }),
          },
          {
            ping: rawReducerSpec({ params: Stdb.struct({}) }),
          },
        ),
      )

      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "DuplicateCallableName",
          }),
        ]),
      )
    }),
  )

  it.effect("rejects partial or explicitly undefined typed schemas", () =>
    Effect.gen(function* () {
      const diagnostics = Stdb.validate(
        moduleWithHttpHandlers({
          request_only: {
            ...httpHandler({
              method: "post",
              path: "/request-only",
            }),
            request: Schema.Struct({ value: Schema.String }),
          },
          undefined_keys: {
            ...httpHandler({
              method: "post",
              path: "/undefined-keys",
            }),
            request: undefined,
            response: undefined,
          },
        }),
      )

      expect(
        diagnostics.filter(
          (entry) => entry.code === "InvalidHttpHandlerSchemaMode",
        ),
      ).toHaveLength(2)
    }),
  )
})
