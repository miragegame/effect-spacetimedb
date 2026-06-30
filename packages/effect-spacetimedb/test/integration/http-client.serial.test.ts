import { testEffectCallbackError } from "../helpers/effect-errors"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
  ConnectionId,
  Identity,
  TimeDuration,
  Timestamp,
  Uuid,
} from "spacetimedb"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { ExampleErrors, FullModule, UserMissing } from "../fixtures/full-module"
import { MinimalModule } from "../fixtures/minimal-module"
import { encodeJson } from "../helpers/json"
import {
  moduleFromSections,
  rawProcedureSpec,
  rawReducerSpec,
} from "../helpers/module-builders"
import { makeMockHttpClientLayer } from "../helpers/mock-http-client"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const HttpConfig = {
  uri: "http://stdb.test",
  databaseName: "full",
  token: "example-token",
} as const
const JsonDate = new Date("2026-04-24T00:00:00.000Z")
const MinI64 = -9223372036854775808n
const WideU64 = 18446744073709551615n
const MinI128 = -170141183460469231731687303715884105728n
const WideValue = 340282366920938463463374607431768211455n

const BigIntHttpModule = moduleFromSections({
  name: "bigint_http",
  reducers: {
    countSet: rawReducerSpec({
      params: Stdb.struct({
        count: Stdb.u64(),
        at: Stdb.custom(Schema.instanceOf(Date), {
          type: Stdb.string(),
        }),
      }),
    }),
  },
})

const NestedBulkHttpModule = moduleFromSections({
  name: "nested_bulk_http",
  reducers: {
    artifactBulkUpsert: rawReducerSpec({
      params: Stdb.struct({
        entries: Stdb.array(
          Stdb.struct({
            artifactId: Stdb.string(),
            gameClientBuildId: Stdb.option(Stdb.string()),
            createdAt: Stdb.string(),
          }),
        ),
      }),
    }),
    artifactAnnotate: rawReducerSpec({
      params: Stdb.struct({
        artifactId: Stdb.string(),
        metadata: Stdb.struct({
          buildLabel: Stdb.string(),
          retryCount: Stdb.u32(),
        }).optional(),
        extraTags: Stdb.array(Stdb.string()).optional(),
      }),
    }),
  },
  procedures: {
    artifactManifestGet: rawProcedureSpec({
      params: Stdb.struct({
        filter: Stdb.option(
          Stdb.struct({
            artifactIds: Stdb.array(Stdb.string()),
            includeDeleted: Stdb.option(Stdb.bool()),
          }),
        ),
      }),
      returns: Stdb.struct({
        entries: Stdb.array(
          Stdb.struct({
            artifactId: Stdb.string(),
            gameClientBuildId: Stdb.option(Stdb.string()),
            createdAt: Stdb.string(),
          }),
        ),
        selected: Stdb.option(
          Stdb.struct({
            artifactId: Stdb.string(),
            tags: Stdb.array(Stdb.string()),
          }),
        ),
      }),
    }),
  },
})

const WireTypeHttpModule = moduleFromSections({
  name: "wire_type_http",
  reducers: {
    wireSet: rawReducerSpec({
      params: Stdb.struct({
        count: Stdb.u64(),
        wide: Stdb.u128(),
        signed: Stdb.i64(),
        signedWide: Stdb.i128(),
        at: Stdb.timestamp(),
        duration: Stdb.timeDuration(),
        identity: Stdb.identity(),
        connection: Stdb.connectionId(),
        uuid: Stdb.uuid(),
      }),
    }),
  },
  procedures: {
    wireGet: rawProcedureSpec({
      params: Stdb.struct({}),
      returns: Stdb.struct({
        count: Stdb.u64(),
        wide: Stdb.u128(),
        signed: Stdb.i64(),
        signedWide: Stdb.i128(),
        at: Stdb.timestamp(),
        duration: Stdb.timeDuration(),
        identity: Stdb.identity(),
        connection: Stdb.connectionId(),
        uuid: Stdb.uuid(),
      }),
    }),
    maybeCount: rawProcedureSpec({
      params: Stdb.struct({}),
      returns: Stdb.option(Stdb.u64()),
    }),
    maybeCounter: rawProcedureSpec({
      params: Stdb.struct({}),
      returns: Stdb.option(
        Stdb.struct({
          count: Stdb.u64(),
        }),
      ),
    }),
    declaredMaybeCounter: rawProcedureSpec({
      params: Stdb.struct({}),
      returns: Stdb.option(
        Stdb.struct({
          count: Stdb.u64(),
        }),
      ),
      errors: ExampleErrors,
    }),
    done: rawProcedureSpec({
      params: Stdb.struct({}),
      returns: Stdb.unit(),
    }),
    declaredDone: rawProcedureSpec({
      params: Stdb.struct({}),
      returns: Stdb.unit(),
      errors: ExampleErrors,
    }),
  },
})

class ResponseBodyReadAfterClose extends Data.TaggedError(
  "ResponseBodyReadAfterClose",
) {}

const makeScopedBodyHttpClientLayer = (body: string) =>
  Layer.effect(
    HttpClient.HttpClient,
    Ref.make(false).pipe(
      Effect.map((closed) =>
        HttpClient.make(
          (request) =>
            Effect.acquireRelease(
              Effect.succeed({
                request,
                headers: {},
                remoteAddress: Option.none(),
                cookies: {},
                status: 200,
                text: Ref.get(closed).pipe(
                  Effect.flatMap((isClosed) =>
                    isClosed
                      ? Effect.fail(new ResponseBodyReadAfterClose())
                      : Effect.succeed(body),
                  ),
                ),
                json: Effect.fail(new ResponseBodyReadAfterClose()),
                urlParamsBody: Effect.fail(new ResponseBodyReadAfterClose()),
                arrayBuffer: Effect.fail(new ResponseBodyReadAfterClose()),
                stream: Stream.fail(new ResponseBodyReadAfterClose()),
              } as never),
              () => Ref.set(closed, true),
            ) as never,
        ),
      ),
    ),
  )

const okGlobalFetch = Effect.acquireRelease(
  Effect.try({
    try: () => {
      const original = globalThis.fetch
      const fetchOk = Object.assign(
        (..._args: Parameters<typeof fetch>): ReturnType<typeof fetch> =>
          Promise.resolve(new Response(undefined, { status: 200 })),
        { preconnect: original.preconnect },
      )
      globalThis.fetch = fetchOk as typeof fetch
      return original
    },
    catch: testEffectCallbackError(
      "interop/effect-spacetimedb/integration/http-client",
    ),
  }),
  (original) =>
    Effect.try({
      try: () => {
        globalThis.fetch = original
      },
      catch: testEffectCallbackError(
        "interop/effect-spacetimedb/integration/http-client",
      ),
    }).pipe(Effect.orDie),
)

describe("http client", (it) => {
  it.effect("projects public callables and declared HTTP handlers", () => {
    const Full = Stdb.project(FullModule)
    const httpLayer = Full.client.http.layer(HttpConfig)

    return Effect.gen(function* () {
      const Http = Full.client.http.Tag
      const client = yield* Http

      expect(Object.keys(client.reducers)).toEqual([
        "userRequire",
        "userUpsert",
      ])
      expect(Object.keys(client.procedures)).toEqual(["userGet"])
      expect(Object.keys(client.httpHandlers)).toEqual([
        "rotateToken",
        "stripeWebhook",
      ])
    }).pipe(Effect.provide(httpLayer))
  })

  it.effect("layerFetch supplies the fetch HTTP transport for calls", () =>
    okGlobalFetch.pipe(
      Effect.flatMap(() => {
        const Full = Stdb.project(FullModule)
        const httpLayer = Full.client.http.layerFetch({
          uri: "http://stdb.test",
          databaseName: "full",
          token: "example-token",
        })

        return Effect.gen(function* () {
          const client = yield* Full.client.http.Tag
          yield* client.reducers.userUpsert({
            userId: "user-1" as never,
            name: "Ada" as never,
          })
        }).pipe(Effect.provide(httpLayer))
      }),
      Effect.scoped,
    ),
  )

  it.effect("scopes projected HTTP tags per module", () =>
    Effect.gen(function* () {
      const full = Stdb.project(FullModule)
      const minimal = Stdb.project(MinimalModule)

      expect(full.client.http.Tag).toBe(full.client.http.Tag)
      expect(full.client.http.Tag).not.toBe(minimal.client.http.Tag)
    }),
  )

  it.effect(
    "preserves local reducer argument decode failures as StdbDecodeError",
    () => {
      const Full = Stdb.project(FullModule)
      const httpLayer = Full.client.http.layer(HttpConfig)

      return Effect.gen(function* () {
        const Http = Full.client.http.Tag
        const client = yield* Http

        const exit = yield* Effect.exit(
          client.reducers
            .userUpsert({
              userId: 123 as never,
              name: "Ada" as never,
            })
            .pipe(
              Effect.provide(makeMockHttpClientLayer(() => Effect.succeed({}))),
            ),
        )

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
          )

          expect(failure).toBeInstanceOf(StdbTesting.StdbDecodeError)
          expect(failure).toEqual(
            expect.objectContaining({
              phase: "args",
            }),
          )
        }
      }).pipe(Effect.provide(httpLayer))
    },
  )

  it.effect(
    "lowers struct payloads to ordered STDB call arrays by authored field order",
    () => {
      const Full = Stdb.project(FullModule)
      const httpLayer = Full.client.http.layer(HttpConfig)

      return Effect.gen(function* () {
        let capturedReducerArgs: ReadonlyArray<unknown> | undefined
        let capturedProcedureArgs: ReadonlyArray<unknown> | undefined
        let capturedReducerUrl: string | undefined
        let capturedProcedureUrl: string | undefined

        const Http = Full.client.http.Tag
        const client = yield* Http

        yield* client.reducers
          .userUpsert({
            name: "Ada" as never,
            userId: "user-1" as never,
          })
          .pipe(
            Effect.provide(
              makeMockHttpClientLayer((request) =>
                Effect.try({
                  try: () => {
                    capturedReducerArgs = request.body as ReadonlyArray<unknown>
                    capturedReducerUrl = request.url.toString()
                    return {}
                  },
                  catch: testEffectCallbackError(
                    "interop/effect-spacetimedb/integration/http-client",
                  ),
                }),
              ),
            ),
          )

        yield* client.procedures
          .userGet({
            userId: "user-1" as never,
          })
          .pipe(
            Effect.provide(
              makeMockHttpClientLayer((request) =>
                Effect.try({
                  try: () => {
                    capturedProcedureArgs =
                      request.body as ReadonlyArray<unknown>
                    capturedProcedureUrl = request.url.toString()
                    return {
                      body: encodeJson({
                        tag: "ok",
                        value: {
                          id: "user-1",
                          name: "Ada",
                        },
                      }),
                    }
                  },
                  catch: testEffectCallbackError(
                    "interop/effect-spacetimedb/integration/http-client",
                  ),
                }),
              ),
            ),
          )

        expect(capturedReducerArgs).toEqual(["user-1", "Ada"])
        expect(capturedProcedureArgs).toEqual(["user-1"])
        expect(capturedReducerUrl).toBe(
          "http://stdb.test/v1/database/full/call/user_upsert",
        )
        expect(capturedProcedureUrl).toBe(
          "http://stdb.test/v1/database/full/call/user_get",
        )
      }).pipe(Effect.provide(httpLayer))
    },
  )

  it.effect(
    "normalizes trailing slashes in reducer and procedure call URLs",
    () => {
      const Full = Stdb.project(FullModule)
      const httpLayer = Full.client.http.layer({
        ...HttpConfig,
        uri: "http://stdb.test/",
      })

      return Effect.gen(function* () {
        let capturedReducerUrl: string | undefined
        let capturedProcedureUrl: string | undefined
        const Http = Full.client.http.Tag
        const client = yield* Http

        yield* client.reducers
          .userUpsert({
            userId: "user-1" as never,
            name: "Ada" as never,
          })
          .pipe(
            Effect.provide(
              makeMockHttpClientLayer((request) =>
                Effect.try({
                  try: () => {
                    capturedReducerUrl = request.url.toString()
                    return {}
                  },
                  catch: testEffectCallbackError(
                    "interop/effect-spacetimedb/integration/http-client",
                  ),
                }),
              ),
            ),
          )

        yield* client.procedures
          .userGet({
            userId: "user-1" as never,
          })
          .pipe(
            Effect.provide(
              makeMockHttpClientLayer((request) =>
                Effect.try({
                  try: () => {
                    capturedProcedureUrl = request.url.toString()
                    return {
                      body: encodeJson({
                        tag: "ok",
                        value: {
                          id: "user-1",
                          name: "Ada",
                        },
                      }),
                    }
                  },
                  catch: testEffectCallbackError(
                    "interop/effect-spacetimedb/integration/http-client",
                  ),
                }),
              ),
            ),
          )

        expect(capturedReducerUrl).toBe(
          "http://stdb.test/v1/database/full/call/user_upsert",
        )
        expect(capturedProcedureUrl).toBe(
          "http://stdb.test/v1/database/full/call/user_get",
        )
      }).pipe(Effect.provide(httpLayer))
    },
  )

  it.effect("encodes nested struct array fields with STDB JSON names", () => {
    const NestedBulkHttp = Stdb.project(NestedBulkHttpModule)
    const httpLayer = NestedBulkHttp.client.http.layer({
      ...HttpConfig,
      databaseName: "nested_bulk_http",
    })

    return Effect.gen(function* () {
      let capturedArgs: unknown
      const Http = NestedBulkHttp.client.http.Tag
      const client = yield* Http

      yield* client.reducers
        .artifactBulkUpsert({
          entries: [
            {
              artifactId: "artifact-1",
              gameClientBuildId: "build-1",
              createdAt: "2026-06-11T00:00:00.000Z",
            },
            {
              artifactId: "artifact-2",
              gameClientBuildId: undefined,
              createdAt: "2026-06-11T00:00:01.000Z",
            },
          ],
        })
        .pipe(
          Effect.provide(
            makeMockHttpClientLayer((request) =>
              Effect.try({
                try: () => {
                  capturedArgs = request.body
                  return {}
                },
                catch: testEffectCallbackError(
                  "interop/effect-spacetimedb/http-client",
                ),
              }),
            ),
          ),
        )

      expect(capturedArgs).toEqual([
        [
          {
            artifact_id: "artifact-1",
            game_client_build_id: { some: "build-1" },
            created_at: "2026-06-11T00:00:00.000Z",
          },
          {
            artifact_id: "artifact-2",
            game_client_build_id: { none: {} },
            created_at: "2026-06-11T00:00:01.000Z",
          },
        ],
      ])
    }).pipe(Effect.provide(httpLayer))
  })

  it.effect(
    "preserves optional nested struct and array fields when encoding args",
    () => {
      const NestedBulkHttp = Stdb.project(NestedBulkHttpModule)
      const httpLayer = NestedBulkHttp.client.http.layer({
        ...HttpConfig,
        databaseName: "nested_bulk_http",
      })

      return Effect.gen(function* () {
        const captured: Array<unknown> = []
        const Http = NestedBulkHttp.client.http.Tag
        const client = yield* Http
        const mockLayer = makeMockHttpClientLayer((request) =>
          Effect.try({
            try: () => {
              captured.push(request.body)
              return {}
            },
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/http-client",
            ),
          }),
        )

        yield* client.reducers
          .artifactAnnotate({
            artifactId: "artifact-1",
            metadata: {
              buildLabel: "build-7",
              retryCount: 2,
            },
            extraTags: ["alpha", "beta"],
          })
          .pipe(Effect.provide(mockLayer))

        yield* client.reducers
          .artifactAnnotate({
            artifactId: "artifact-2",
          })
          .pipe(Effect.provide(mockLayer))

        expect(captured).toEqual([
          [
            "artifact-1",
            {
              some: {
                build_label: "build-7",
                retry_count: 2,
              },
            },
            { some: ["alpha", "beta"] },
          ],
          ["artifact-2", { none: {} }, { none: {} }],
        ])
      }).pipe(Effect.provide(httpLayer))
    },
  )

  it.effect(
    "round-trips nested struct option array procedure values over HTTP JSON",
    () => {
      const NestedBulkHttp = Stdb.project(NestedBulkHttpModule)
      const httpLayer = NestedBulkHttp.client.http.layer({
        ...HttpConfig,
        databaseName: "nested_bulk_http",
      })

      return Effect.gen(function* () {
        let capturedArgs: unknown
        const Http = NestedBulkHttp.client.http.Tag
        const client = yield* Http

        const result = yield* client.procedures
          .artifactManifestGet({
            filter: {
              artifactIds: ["artifact-1", "artifact-2"],
              includeDeleted: true,
            },
          })
          .pipe(
            Effect.provide(
              makeMockHttpClientLayer((request) =>
                Effect.try({
                  try: () => {
                    capturedArgs = request.body
                    return {
                      body: encodeJson([
                        [
                          [
                            "artifact-1",
                            [0, "build-1"],
                            "2026-06-11T00:00:00.000Z",
                          ],
                          ["artifact-2", [1, []], "2026-06-11T00:00:01.000Z"],
                        ],
                        [0, ["artifact-1", ["stable", "candidate"]]],
                      ]),
                    }
                  },
                  catch: testEffectCallbackError(
                    "interop/effect-spacetimedb/http-client",
                  ),
                }),
              ),
            ),
          )

        expect(capturedArgs).toEqual([
          {
            some: {
              artifact_ids: ["artifact-1", "artifact-2"],
              include_deleted: { some: true },
            },
          },
        ])
        expect(result).toEqual({
          entries: [
            {
              artifactId: "artifact-1",
              gameClientBuildId: "build-1",
              createdAt: "2026-06-11T00:00:00.000Z",
            },
            {
              artifactId: "artifact-2",
              gameClientBuildId: undefined,
              createdAt: "2026-06-11T00:00:01.000Z",
            },
          ],
          selected: {
            artifactId: "artifact-1",
            tags: ["stable", "candidate"],
          },
        })
      }).pipe(Effect.provide(httpLayer))
    },
  )

  it.effect("encodes bigint call arguments as SATS JSON integers", () => {
    const BigIntHttp = Stdb.project(BigIntHttpModule)
    const httpLayer = BigIntHttp.client.http.layer({
      ...HttpConfig,
      databaseName: "bigint_http",
    })

    return Effect.gen(function* () {
      let capturedArgs: unknown
      const Http = BigIntHttp.client.http.Tag
      const client = yield* Http

      yield* client.reducers
        .countSet({
          count: 42n,
          at: JsonDate,
        })
        .pipe(
          Effect.provide(
            makeMockHttpClientLayer((request) =>
              Effect.try({
                try: () => {
                  capturedArgs = request.body
                  return {}
                },
                catch: testEffectCallbackError(
                  "interop/effect-spacetimedb/integration/http-client",
                ),
              }),
            ),
          ),
        )

      expect(capturedArgs).toEqual([42, "2026-04-24T00:00:00.000Z"])
    }).pipe(Effect.provide(httpLayer))
  })

  it.effect(
    "encodes and decodes SpaceTimeDB integer and wrapper values over HTTP JSON",
    () => {
      const WireTypeHttp = Stdb.project(WireTypeHttpModule)
      const httpLayer = WireTypeHttp.client.http.layer({
        ...HttpConfig,
        databaseName: "wire_type_http",
      })

      return Effect.gen(function* () {
        let capturedBodyText: string | undefined
        const Http = WireTypeHttp.client.http.Tag
        const client = yield* Http

        yield* client.reducers
          .wireSet({
            count: 42n,
            wide: WideValue,
            signed: MinI64,
            signedWide: MinI128,
            at: new Timestamp(1234n),
            duration: TimeDuration.fromMillis(5),
            identity: Identity.zero(),
            connection: new ConnectionId(17n),
            uuid: new Uuid(18n),
          })
          .pipe(
            Effect.provide(
              makeMockHttpClientLayer((request) =>
                Effect.try({
                  try: () => {
                    capturedBodyText = request.bodyText
                    return {}
                  },
                  catch: testEffectCallbackError(
                    "interop/effect-spacetimedb/integration/http-client",
                  ),
                }),
              ),
            ),
          )

        expect(capturedBodyText).toContain(WideValue.toString())
        expect(capturedBodyText).not.toContain(`"${WideValue.toString()}"`)
        expect(capturedBodyText).toContain(MinI64.toString())
        expect(capturedBodyText).not.toContain(`"${MinI64.toString()}"`)
        expect(capturedBodyText).toContain(MinI128.toString())
        expect(capturedBodyText).not.toContain(`"${MinI128.toString()}"`)
        expect(capturedBodyText).toContain(
          `"__timestamp_micros_since_unix_epoch__":1234`,
        )
        expect(capturedBodyText).toContain(`"__time_duration_micros__":5000`)
        expect(capturedBodyText).toContain(`"__identity__":0`)
        expect(capturedBodyText).toContain(`"__connection_id__":17`)
        expect(capturedBodyText).toContain(`"__uuid__":18`)

        const result = yield* client.procedures.wireGet({}).pipe(
          Effect.provide(
            makeMockHttpClientLayer(() =>
              Effect.succeed({
                body: `[42,${WideValue},${MinI64},${MinI128},[1234],[5000],[0],[17],[18]]`,
              }),
            ),
          ),
        )

        expect(result.count).toBe(42n)
        expect(result.wide).toBe(WideValue)
        expect(result.signed).toBe(MinI64)
        expect(result.signedWide).toBe(MinI128)
        expect(result.at.microsSinceUnixEpoch).toBe(1234n)
        expect(result.duration.micros).toBe(5000n)
        expect(result.identity.equals(Identity.zero())).toBe(true)
        expect(result.connection.equals(new ConnectionId(17n))).toBe(true)
        expect(result.uuid.asBigInt()).toBe(18n)

        const maybeCount = yield* client.procedures.maybeCount({}).pipe(
          Effect.provide(
            makeMockHttpClientLayer(() =>
              Effect.succeed({
                body: `[0,${WideU64}]`,
              }),
            ),
          ),
        )
        expect(maybeCount).toBe(WideU64)

        const maybeNone = yield* client.procedures.maybeCount({}).pipe(
          Effect.provide(
            makeMockHttpClientLayer(() =>
              Effect.succeed({
                body: "[1,[]]",
              }),
            ),
          ),
        )
        expect(maybeNone).toBeUndefined()

        const maybeCounter = yield* client.procedures.maybeCounter({}).pipe(
          Effect.provide(
            makeMockHttpClientLayer(() =>
              Effect.succeed({
                body: `[0,[${WideU64}]]`,
              }),
            ),
          ),
        )
        expect(maybeCounter).toEqual({ count: WideU64 })

        const declaredMaybeCounter = yield* client.procedures
          .declaredMaybeCounter({})
          .pipe(
            Effect.provide(
              makeMockHttpClientLayer(() =>
                Effect.succeed({
                  body: `[0,[0,[${WideU64}]]]`,
                }),
              ),
            ),
          )
        expect(declaredMaybeCounter).toEqual({ count: WideU64 })

        const done = yield* client.procedures.done({}).pipe(
          Effect.provide(
            makeMockHttpClientLayer(() =>
              Effect.succeed({
                body: "[]",
              }),
            ),
          ),
        )
        expect(done).toBeUndefined()

        const declaredDone = yield* client.procedures.declaredDone({}).pipe(
          Effect.provide(
            makeMockHttpClientLayer(() =>
              Effect.succeed({
                body: "[0,[]]",
              }),
            ),
          ),
        )
        expect(declaredDone).toBeUndefined()

        const encodedError = yield* StdbTesting.ContractError.encodeString(
          ExampleErrors,
          UserMissing.make({ userId: "user-1" as never }),
        )
        const declaredErrorExit = yield* Effect.exit(
          client.procedures.declaredDone({}).pipe(
            Effect.provide(
              makeMockHttpClientLayer(() =>
                Effect.succeed({
                  body: `[1,${encodeJson(encodedError)}]`,
                }),
              ),
            ),
          ),
        )
        expect(Exit.isFailure(declaredErrorExit)).toBe(true)
        if (Exit.isFailure(declaredErrorExit)) {
          const failure = declaredErrorExit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
          )

          expect(failure).toBeInstanceOf(UserMissing)
        }

        const recovered = yield* client.procedures.declaredDone({}).pipe(
          Effect.catchTags({
            UserMissing: (error) => Effect.succeed(error.userId),
          }),
          Effect.provide(
            makeMockHttpClientLayer(() =>
              Effect.succeed({
                body: `[1,${encodeJson(encodedError)}]`,
              }),
            ),
          ),
        )
        expect(recovered).toBe("user-1")
      }).pipe(Effect.provide(httpLayer))
    },
  )

  it.effect(
    "reads successful response bodies before closing response scope",
    () => {
      const WireTypeHttp = Stdb.project(WireTypeHttpModule)
      const httpLayer = WireTypeHttp.client.http.layer({
        ...HttpConfig,
        databaseName: "wire_type_http",
      })

      return Effect.gen(function* () {
        const Http = WireTypeHttp.client.http.Tag
        const client = yield* Http

        const result = yield* client.procedures
          .maybeCount({})
          .pipe(Effect.provide(makeScopedBodyHttpClientLayer(`[0,${WideU64}]`)))

        expect(result).toBe(WideU64)
      }).pipe(Effect.provide(httpLayer))
    },
  )

  it.effect(
    "classifies successful procedure body read failures as transport",
    () => {
      const Full = Stdb.project(FullModule)
      const httpLayer = Full.client.http.layer(HttpConfig)

      return Effect.gen(function* () {
        const Http = Full.client.http.Tag
        const client = yield* Http

        const exit = yield* Effect.exit(
          client.procedures
            .userGet({
              userId: "user-1" as never,
            })
            .pipe(
              Effect.provide(
                makeMockHttpClientLayer(() =>
                  Effect.succeed({
                    textError: new Error("body read failed"),
                  }),
                ),
              ),
            ),
        )

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(
            Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
          ).toBeInstanceOf(StdbTesting.TransportError)
        }
      }).pipe(Effect.provide(httpLayer))
    },
  )

  it.effect("classifies malformed successful procedure JSON as decode", () => {
    const Full = Stdb.project(FullModule)
    const httpLayer = Full.client.http.layer(HttpConfig)

    return Effect.gen(function* () {
      const Http = Full.client.http.Tag
      const client = yield* Http

      const exit = yield* Effect.exit(
        client.procedures
          .userGet({
            userId: "user-1" as never,
          })
          .pipe(
            Effect.provide(
              makeMockHttpClientLayer(() =>
                Effect.succeed({
                  body: "{not-json",
                }),
              ),
            ),
          ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(
          Option.getOrUndefined(Cause.findErrorOption(exit.cause)),
        ).toBeInstanceOf(StdbTesting.StdbDecodeError)
      }
    }).pipe(Effect.provide(httpLayer))
  })
})
