import * as Cause from "effect/Cause"
import * as HttpClient from "effect/http/HttpClient"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Stdb from "effect-spacetimedb"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import * as Schema from "effect/Schema"
import { fixtureCallDurationMax } from "../helpers/transport-bounds"
const { expect } = EffectVitest
import { SenderError } from "spacetimedb"
import { ExampleErrors, FullModule, UserMissing } from "../fixtures/full-module"
import { makeMockHttpClientLayer } from "../helpers/mock-http-client"
import { encodeJson } from "../helpers/json"
import { TestLayer } from "../helpers/test-layer"
import { makeFullModuleWsConnection } from "../helpers/ws-fixtures"

const describe = EffectVitest.layer(TestLayer)

const noopWsConnection = makeFullModuleWsConnection()

const noopWsTransport = {
  callReducerWithParams: () => Promise.resolve(),
  callProcedureWithParams: () => Promise.resolve(undefined),
}

const HttpConfig = {
  uri: "http://stdb.test",
  databaseName: "full",
  token: "example-token",
  callDurationMax: fixtureCallDurationMax,
} as const

const exitSnapshot = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    }
  }

  if (Array.isArray(value)) {
    return value.map(exitSnapshot)
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, exitSnapshot(entry)]),
    )
  }

  return value
}

const expectSameExit = (
  actual: Exit.Exit<unknown, unknown>,
  expected: Exit.Exit<unknown, unknown>,
) => {
  expect(exitSnapshot(actual)).toEqual(exitSnapshot(expected))
}

const makeHttpClient = () =>
  StdbInternal.ClientHttp.make({
    module: FullModule,
    ...HttpConfig,
  })

const wsMake = (options?: {
  readonly callReducerWithParams?: (
    reducerName: string,
    paramsType: unknown,
    params: object,
  ) => Promise<void>
  readonly callProcedureWithParams?: (
    procedureName: string,
    paramsType: unknown,
    params: object,
    returnType: unknown,
  ) => Promise<unknown>
}) =>
  StdbInternal.ClientWs.make({
    module: FullModule,
    connection: noopWsConnection,
    transport: {
      ...noopWsTransport,
      ...(options?.callReducerWithParams != null
        ? { callReducerWithParams: options.callReducerWithParams }
        : {}),
      ...(options?.callProcedureWithParams != null
        ? { callProcedureWithParams: options.callProcedureWithParams }
        : {}),
    },
  })

const runHttpExit = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  handler: Parameters<typeof makeMockHttpClientLayer>[0],
) => Effect.exit(effect.pipe(Effect.provide(makeMockHttpClientLayer(handler))))

class SocketBoomError extends Data.TaggedError("SocketBoomError") {}

const encodeUnknownDeclaredErrorEnvelope = (
  declaredTag: string,
  payload: Record<string, unknown>,
) =>
  Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))({
    _effectSpacetimeDb: "DeclaredError",
    version: 1,
    tag: declaredTag,
    error: {
      _tag: declaredTag,
      ...payload,
    },
  })

const encodeMalformedDeclaredErrorEnvelope = (declaredTag: string) =>
  Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))({
    _effectSpacetimeDb: "DeclaredError",
    version: 1,
    tag: declaredTag,
    error: {
      _tag: declaredTag,
      userId: 123,
    },
  })

const encodeMismatchedDeclaredErrorEnvelope = (
  declaredTag: string,
  payloadTag: string,
) =>
  Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))({
    _effectSpacetimeDb: "DeclaredError",
    version: 1,
    tag: declaredTag,
    error: {
      _tag: payloadTag,
      userId: "user-1",
    },
  })

describe("shared client rpc", (it) => {
  it.effect(
    "projects public reducers, public procedures, and declared HTTP handlers",
    () =>
      Effect.gen(function* () {
        const http = makeHttpClient()
        const ws = wsMake()

        expect(Object.keys(http.reducers)).toEqual([
          "userRequire",
          "userUpsert",
        ])
        expect(Object.keys(http.procedures)).toEqual(["userGet"])
        expect(Object.keys(http.httpHandlers)).toEqual([
          "rotateToken",
          "stripeWebhook",
        ])
        expect(Object.keys(http)).toEqual([
          "reducers",
          "procedures",
          "httpHandlers",
          "groups",
        ])
        expect(Object.keys(http.groups.FullCallables.reducers)).toEqual([
          "userRequire",
          "userUpsert",
        ])
        expect(Object.keys(http.groups.FullCallables.procedures)).toEqual([
          "userGet",
        ])
        expect(Object.keys(http.groups.FullCallables.httpHandlers)).toEqual([])
        expect(Object.keys(http.groups.FullHttp.reducers)).toEqual([])
        expect(Object.keys(http.groups.FullHttp.procedures)).toEqual([])
        expect(Object.keys(http.groups.FullHttp.httpHandlers)).toEqual([
          "rotateToken",
          "stripeWebhook",
        ])
        expect(Object.keys(ws.reducers)).toEqual(["userRequire", "userUpsert"])
        expect(Object.keys(ws.procedures)).toEqual(["userGet"])
        expect(Object.keys(ws.groups)).toEqual(["FullCallables"])
        expect(ws.groups.FullCallables).toBe(ws.groups.FullCallables)
        expect(ws.groups.FullCallables.procedures.userGet).toBe(
          ws.procedures.userGet,
        )
        expect(ws.groups.FullCallables.reducers.userUpsert.raw).toBe(
          ws.reducers.userUpsert.raw,
        )
      }),
  )

  it.effect(
    "projects lazy group namespaces as complete identity-preserving partitions",
    () =>
      Effect.gen(function* () {
        const http = makeHttpClient()

        expect(Object.getPrototypeOf(http)).toBeNull()
        expect(http.groups.FullCallables).toBe(http.groups.FullCallables)
        expect(Object.getPrototypeOf(http.groups.FullCallables)).toBeNull()
        expect(
          Object.getPrototypeOf(http.groups.FullCallables.reducers),
        ).toBeNull()
        expect(http.groups.FullCallables.reducers.userRequire).toBe(
          http.reducers.userRequire,
        )
        expect(http.groups.FullCallables.reducers.userRequire.raw).toBe(
          http.reducers.userRequire.raw,
        )
        expect(http.groups.FullCallables.procedures.userGet).toBe(
          http.procedures.userGet,
        )
        expect(http.groups.FullHttp.httpHandlers.rotateToken).toBe(
          http.httpHandlers.rotateToken,
        )

        const groupIds = ["FullCallables", "FullHttp"] as const
        yield* Effect.forEach(
          ["reducers", "procedures", "httpHandlers"] as const,
          (kind) => {
            const groupedKeys = new Set(
              groupIds.flatMap((groupId) =>
                Object.keys(http.groups[groupId][kind]),
              ),
            )
            expect([...groupedKeys].sort()).toEqual(
              Object.keys(http[kind]).sort(),
            )
            return Effect.void
          },
          { discard: true },
        )
      }),
  )

  it.effect("constructs a single typed group and preserves call behavior", () =>
    Effect.gen(function* () {
      const group = Stdb.project(FullModule).client.http.group(
        "FullCallables",
        HttpConfig,
      )
      const flat = makeHttpClient()

      expect(Object.keys(group.reducers)).toEqual(["userRequire", "userUpsert"])
      expect(Object.keys(group.procedures)).toEqual(["userGet"])

      const encoded = Schema.encodeSync(
        StdbInternal.procedureEnvelope(
          FullModule.procedures.userGet.returns,
          FullModule.procedures.userGet.errors!,
        ).schema,
      )({ tag: "ok", value: undefined })
      const groupedExit = yield* runHttpExit(
        group.procedures.userGet({ userId: "user-1" as never }),
        () => Effect.succeed({ body: encodeJson(encoded) }),
      )
      const flatExit = yield* runHttpExit(
        flat.procedures.userGet({ userId: "user-1" as never }),
        () => Effect.succeed({ body: encodeJson(encoded) }),
      )
      expectSameExit(groupedExit, flatExit)
    }),
  )

  it.effect(
    "keeps hand-defined endpoint specs flat when group maps are empty",
    () =>
      Effect.gen(function* () {
        const HandDefinedModule = {
          ...FullModule,
          name: "hand_defined",
          reducerGroups: {},
          procedureGroups: {},
          httpGroups: {},
        } as const
        const http = StdbInternal.ClientHttp.make({
          module: HandDefinedModule,
          ...HttpConfig,
        })

        expect(Object.keys(http)).toEqual([
          "reducers",
          "procedures",
          "httpHandlers",
          "groups",
        ])
        expect(Object.keys(http.reducers)).toEqual([
          "userRequire",
          "userUpsert",
        ])
        expect(Object.keys(http.procedures)).toEqual(["userGet"])
        expect(Object.keys(http.httpHandlers)).toEqual([
          "rotateToken",
          "stripeWebhook",
        ])
      }),
  )

  it("separates group names from session and transport members", () => {
    const module = {
      ...FullModule,
      reducerGroups: { userUpsert: "cache", userRequire: "groups" },
      procedureGroups: { userGet: "identity" },
    } as const
    const ws = StdbInternal.ClientWs.make<typeof module, unknown, unknown>({
      module,
      connection: {
        db: noopWsConnection.db,
        subscriptionBuilder: () => {
          throw new Error("Unexpected subscription")
        },
      },
      transport: noopWsTransport,
    })
    const http = StdbInternal.ClientHttp.make({ module, ...HttpConfig })
    expect(ws.groups.cache.reducers.userUpsert).toBe(ws.reducers.userUpsert)
    expect(ws.groups.groups.reducers.userRequire).toBe(ws.reducers.userRequire)
    expect(http.groups.identity.procedures.userGet).toBe(
      http.procedures.userGet,
    )
  })

  it.effect(
    "shares declared procedure domain-error lowering across http and ws",
    () =>
      Effect.gen(function* () {
        const encoded = yield* StdbInternal.ContractError.encodeString(
          ExampleErrors,
          UserMissing.make({ userId: "missing" as never }),
        )
        const encodedEnvelope = Schema.encodeSync(
          StdbInternal.procedureEnvelope(
            FullModule.procedures.userGet.returns,
            FullModule.procedures.userGet.errors!,
          ).schema,
        )({
          tag: "err",
          value: encoded,
        })

        expect(typeof encoded).toBe("string")

        const http = makeHttpClient()
        const ws = wsMake({
          callProcedureWithParams: () => Promise.resolve(encodedEnvelope),
        })

        const httpExit = yield* runHttpExit(
          http.procedures.userGet({
            userId: "missing" as never,
          }),
          () =>
            Effect.succeed({
              body: encodeJson(encodedEnvelope),
            }),
        )
        const wsExit = yield* Effect.exit(
          ws.procedures.userGet({
            userId: "missing" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
      }),
  )

  it.effect(
    "shares declared reducer domain-error lowering across http and ws",
    () =>
      Effect.gen(function* () {
        const encoded = yield* StdbInternal.ContractError.encodeString(
          ExampleErrors,
          UserMissing.make({ userId: "missing" as never }),
        )

        const http = makeHttpClient()
        const ws = wsMake({
          callReducerWithParams: () => Promise.reject(new SenderError(encoded)),
        })

        const httpExit = yield* runHttpExit(
          http.reducers.userRequire({
            userId: "missing" as never,
          }),
          () =>
            Effect.succeed({
              status: 500,
              body: encoded,
            }),
        )
        const wsExit = yield* Effect.exit(
          ws.reducers.userRequire({
            userId: "missing" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
      }),
  )

  it.effect(
    "shares reducer local argument decode failures across http and ws",
    () =>
      Effect.gen(function* () {
        const http = makeHttpClient()
        const ws = wsMake()

        const httpExit = yield* runHttpExit(
          http.reducers.userUpsert({
            userId: 123 as never,
            name: "Ada" as never,
          }),
          () => Effect.succeed({}),
        )
        const wsExit = yield* Effect.exit(
          ws.reducers.userUpsert({
            userId: 123 as never,
            name: "Ada" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
      }),
  )

  it.effect(
    "shares procedure local argument decode failures across http and ws",
    () =>
      Effect.gen(function* () {
        const http = makeHttpClient()
        const ws = wsMake()

        const httpExit = yield* runHttpExit(
          http.procedures.userGet({
            userId: 123 as never,
          }),
          () => Effect.succeed({}),
        )
        const wsExit = yield* Effect.exit(
          ws.procedures.userGet({
            userId: 123 as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
      }),
  )

  it.effect("shares raw reducer rejection lowering across http and ws", () =>
    Effect.gen(function* () {
      const http = makeHttpClient()
      const ws = wsMake({
        callReducerWithParams: () => Promise.reject("transport boom"),
      })

      const httpExit = yield* runHttpExit(
        http.reducers.userRequire({
          userId: "user-1" as never,
        }),
        () =>
          Effect.succeed({
            status: 500,
            body: "transport boom",
          }),
      )
      const wsExit = yield* Effect.exit(
        ws.reducers.userRequire({
          userId: "user-1" as never,
        }),
      )

      expectSameExit(httpExit, wsExit)
    }),
  )

  it.effect(
    "separates transport failures from remote rejections across reducer clients",
    () =>
      Effect.gen(function* () {
        const http = makeHttpClient()
        const ws = wsMake({
          callReducerWithParams: () => Promise.reject(new SocketBoomError()),
        })

        const httpExit = yield* runHttpExit(
          http.reducers.userRequire({
            userId: "user-1" as never,
          }),
          () => Effect.fail(new SocketBoomError()),
        )
        const wsExit = yield* Effect.exit(
          ws.reducers.userRequire({
            userId: "user-1" as never,
          }),
        )

        expect(Exit.isFailure(httpExit)).toBe(true)
        expect(Exit.isFailure(wsExit)).toBe(true)

        if (Exit.isFailure(httpExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).toBeInstanceOf(StdbInternal.TransportError)
        }

        if (Exit.isFailure(wsExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(wsExit.cause)),
          ).toBeInstanceOf(StdbInternal.TransportError)
        }
      }),
  )

  it.effect(
    "shares procedure remote-rejection lowering across http and ws",
    () =>
      Effect.gen(function* () {
        const http = makeHttpClient()
        const ws = wsMake({
          callProcedureWithParams: () =>
            Promise.reject("not-a-declared-domain-error"),
        })

        const httpExit = yield* runHttpExit(
          http.procedures.userGet({
            userId: "user-1" as never,
          }),
          () =>
            Effect.succeed({
              status: 500,
              body: "not-a-declared-domain-error",
            }),
        )
        const wsExit = yield* Effect.exit(
          ws.procedures.userGet({
            userId: "user-1" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
      }),
  )

  it.effect(
    "keeps unknown declared reducer tags on remote rejections across http and ws",
    () =>
      Effect.gen(function* () {
        const encodedUnknown = encodeUnknownDeclaredErrorEnvelope(
          "LegacyUserMissing",
          {
            userId: "user-1",
          },
        )
        const http = makeHttpClient()
        const ws = wsMake({
          callReducerWithParams: () =>
            Promise.reject(new SenderError(encodedUnknown)),
        })

        const httpExit = yield* runHttpExit(
          http.reducers.userRequire({
            userId: "user-1" as never,
          }),
          () =>
            Effect.succeed({
              status: 500,
              body: encodedUnknown,
            }),
        )
        const wsExit = yield* Effect.exit(
          ws.reducers.userRequire({
            userId: "user-1" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
        if (Exit.isFailure(httpExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).toMatchObject({
            _tag: "RemoteRejectedError",
            raw: encodedUnknown,
            declaredTag: "LegacyUserMissing",
          })
        }
      }),
  )

  it.effect(
    "treats raw tagged JSON without the declared-error envelope as a remote rejection",
    () =>
      Effect.gen(function* () {
        const legacyTaggedJson = Schema.encodeSync(
          Schema.fromJsonString(Schema.Unknown),
        )({
          _tag: "UserMissing",
          userId: "user-1",
        })
        const http = makeHttpClient()
        const ws = wsMake({
          callReducerWithParams: () =>
            Promise.reject(new SenderError(legacyTaggedJson)),
        })

        const httpExit = yield* runHttpExit(
          http.reducers.userRequire({
            userId: "user-1" as never,
          }),
          () =>
            Effect.succeed({
              status: 500,
              body: legacyTaggedJson,
            }),
        )
        const wsExit = yield* Effect.exit(
          ws.reducers.userRequire({
            userId: "user-1" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
        if (Exit.isFailure(httpExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).toEqual(
            expect.objectContaining({
              _tag: "RemoteRejectedError",
              raw: legacyTaggedJson,
            }),
          )
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).not.toHaveProperty("declaredTag")
        }
      }),
  )

  it.effect(
    "surfaces malformed known reducer declared errors as decode failures across http and ws",
    () =>
      Effect.gen(function* () {
        const encodedMalformed =
          encodeMalformedDeclaredErrorEnvelope("UserMissing")
        const http = makeHttpClient()
        const ws = wsMake({
          callReducerWithParams: () =>
            Promise.reject(new SenderError(encodedMalformed)),
        })

        const httpExit = yield* runHttpExit(
          http.reducers.userRequire({
            userId: "user-1" as never,
          }),
          () =>
            Effect.succeed({
              status: 500,
              body: encodedMalformed,
            }),
        )
        const wsExit = yield* Effect.exit(
          ws.reducers.userRequire({
            userId: "user-1" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
        if (Exit.isFailure(httpExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).toBeInstanceOf(StdbInternal.StdbDecodeError)
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).toMatchObject({
            phase: "declaredError",
            declaredTag: "UserMissing",
          })
        }
      }),
  )

  it.effect(
    "surfaces mismatched reducer declared envelope tags as decode failures",
    () =>
      Effect.gen(function* () {
        const encodedMismatch = encodeMismatchedDeclaredErrorEnvelope(
          "MissingAuth",
          "UserMissing",
        )
        const http = makeHttpClient()
        const ws = wsMake({
          callReducerWithParams: () =>
            Promise.reject(new SenderError(encodedMismatch)),
        })

        const httpExit = yield* runHttpExit(
          http.reducers.userRequire({
            userId: "user-1" as never,
          }),
          () =>
            Effect.succeed({
              status: 500,
              body: encodedMismatch,
            }),
        )
        const wsExit = yield* Effect.exit(
          ws.reducers.userRequire({
            userId: "user-1" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
        if (Exit.isFailure(httpExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).toMatchObject({
            phase: "declaredError",
            declaredTag: "MissingAuth",
          })
        }
      }),
  )

  it.effect(
    "keeps unknown declared procedure tags on result-envelope rejections across http and ws",
    () =>
      Effect.gen(function* () {
        const encodedUnknown = encodeUnknownDeclaredErrorEnvelope(
          "LegacyUserMissing",
          {
            userId: "user-1",
          },
        )
        const encodedEnvelope = Schema.encodeSync(
          StdbInternal.procedureEnvelope(
            FullModule.procedures.userGet.returns,
            FullModule.procedures.userGet.errors!,
          ).schema,
        )({
          tag: "err",
          value: encodedUnknown,
        })
        const http = makeHttpClient()
        const ws = wsMake({
          callProcedureWithParams: () => Promise.resolve(encodedEnvelope),
        })

        const httpExit = yield* runHttpExit(
          http.procedures.userGet({
            userId: "user-1" as never,
          }),
          () =>
            Effect.succeed({
              body: encodeJson(encodedEnvelope),
            }),
        )
        const wsExit = yield* Effect.exit(
          ws.procedures.userGet({
            userId: "user-1" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
        if (Exit.isFailure(httpExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).toMatchObject({
            _tag: "RemoteRejectedError",
            raw: encodedUnknown,
            declaredTag: "LegacyUserMissing",
          })
        }
      }),
  )

  it.effect(
    "surfaces malformed known procedure declared errors as decode failures across http and ws",
    () =>
      Effect.gen(function* () {
        const encodedMalformed =
          encodeMalformedDeclaredErrorEnvelope("UserMissing")
        const encodedEnvelope = Schema.encodeSync(
          StdbInternal.procedureEnvelope(
            FullModule.procedures.userGet.returns,
            FullModule.procedures.userGet.errors!,
          ).schema,
        )({
          tag: "err",
          value: encodedMalformed,
        })
        const http = makeHttpClient()
        const ws = wsMake({
          callProcedureWithParams: () => Promise.resolve(encodedEnvelope),
        })

        const httpExit = yield* runHttpExit(
          http.procedures.userGet({
            userId: "user-1" as never,
          }),
          () =>
            Effect.succeed({
              body: encodeJson(encodedEnvelope),
            }),
        )
        const wsExit = yield* Effect.exit(
          ws.procedures.userGet({
            userId: "user-1" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
        if (Exit.isFailure(httpExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).toBeInstanceOf(StdbInternal.StdbDecodeError)
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).toMatchObject({
            phase: "declaredError",
            declaredTag: "UserMissing",
          })
        }
      }),
  )

  it.effect(
    "surfaces mismatched procedure declared envelope tags as decode failures",
    () =>
      Effect.gen(function* () {
        const encodedMismatch = encodeMismatchedDeclaredErrorEnvelope(
          "MissingAuth",
          "UserMissing",
        )
        const encodedEnvelope = Schema.encodeSync(
          StdbInternal.procedureEnvelope(
            FullModule.procedures.userGet.returns,
            FullModule.procedures.userGet.errors!,
          ).schema,
        )({
          tag: "err",
          value: encodedMismatch,
        })
        const http = makeHttpClient()
        const ws = wsMake({
          callProcedureWithParams: () => Promise.resolve(encodedEnvelope),
        })

        const httpExit = yield* runHttpExit(
          http.procedures.userGet({
            userId: "user-1" as never,
          }),
          () =>
            Effect.succeed({
              body: encodeJson(encodedEnvelope),
            }),
        )
        const wsExit = yield* Effect.exit(
          ws.procedures.userGet({
            userId: "user-1" as never,
          }),
        )

        expectSameExit(httpExit, wsExit)
        if (Exit.isFailure(httpExit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(httpExit.cause)),
          ).toMatchObject({
            phase: "declaredError",
            declaredTag: "MissingAuth",
          })
        }
      }),
  )

  it.effect(
    "keeps unknown declared procedure tags on SenderError-backed remote rejections",
    () =>
      Effect.gen(function* () {
        const encodedUnknown = encodeUnknownDeclaredErrorEnvelope(
          "LegacyUserMissing",
          {
            userId: "user-1",
          },
        )
        const ws = wsMake({
          callProcedureWithParams: () =>
            Promise.reject(new SenderError(encodedUnknown)),
        })

        const exit = yield* Effect.exit(
          ws.procedures.userGet({
            userId: "user-1" as never,
          }),
        )

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
          ).toMatchObject({
            _tag: "RemoteRejectedError",
            raw: encodedUnknown,
            declaredTag: "LegacyUserMissing",
          })
        }
      }),
  )

  it.effect(
    "adds callable context to ws callable argument decode failures",
    () =>
      Effect.gen(function* () {
        const ws = wsMake({
          callProcedureWithParams: (_name, _paramsType, params) =>
            Promise.resolve(params),
        })

        const reducerExit = yield* Effect.exit(
          ws.reducers.userRequire("not-an-object" as never),
        )
        const procedureExit = yield* Effect.exit(
          ws.procedures.userGet("not-an-object" as never),
        )

        expect(Exit.isFailure(reducerExit)).toBe(true)
        expect(Exit.isFailure(procedureExit)).toBe(true)

        if (Exit.isFailure(reducerExit)) {
          const failure = Option.getOrUndefined(
            reducerExit.cause.pipe(Cause.findErrorOption),
          )
          expect(failure).toBeInstanceOf(StdbInternal.StdbDecodeError)
          expect(String(failure)).toContain("callable=user_require")
          expect(String(failure)).toContain("op=encodeArgs")
        }

        if (Exit.isFailure(procedureExit)) {
          const failure = Option.getOrUndefined(
            procedureExit.cause.pipe(Cause.findErrorOption),
          )
          expect(failure).toBeInstanceOf(StdbInternal.StdbDecodeError)
          expect(String(failure)).toContain("callable=user_get")
          expect(String(failure)).toContain("op=encodeArgs")
        }
      }),
  )
})
