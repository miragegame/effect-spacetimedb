import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { rawHttpHandlerSpec } from "../helpers/module-builders"
import { transform } from "../helpers/schema-transform"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)
const decodeJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown),
)

class MissingThing extends Schema.TaggedErrorClass<MissingThing>()(
  "MissingThing",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

const HttpErrors = Stdb.errors(MissingThing)
const httpHandler = (options: {
  readonly method: Stdb.HttpHandlerMethod
  readonly path: string
  readonly request?: Schema.Top
  readonly response?: Schema.Top
  readonly errors?: Stdb.AnyErrorDefinition
}) => rawHttpHandlerSpec(options)

class DeclaredEncodeBroken extends Schema.TaggedErrorClass<DeclaredEncodeBroken>()(
  "DeclaredEncodeBroken",
  { code: Schema.String },
  { httpApiStatus: 409 },
) {}

const DeclaredEncodeBrokenBaseErrors = Stdb.errors(DeclaredEncodeBroken)
const DeclaredEncodeBrokenErrors = {
  ...DeclaredEncodeBrokenBaseErrors,
  schema: transform(
    Schema.TaggedStruct("DeclaredEncodeBroken", {
      code: Schema.String,
    }),
    DeclaredEncodeBroken,
    {
      decode: ({ code }) => DeclaredEncodeBroken.make({ code }),
      encode: (_error) => ({
        _tag: "DeclaredEncodeBroken" as const,
        code: 1 as never,
      }),
    },
  ),
} as Stdb.AnyErrorDefinition

describe("HTTP handler response projection", (it) => {
  it.effect("passes raw SyncResponse values through unchanged", () =>
    Effect.gen(function* () {
      const spec = httpHandler({ method: "post", path: "/raw" })
      const raw = new Stdb.SyncResponse("ok", { status: 202 })
      const response = Effect.succeed(raw).pipe(
        StdbTesting.encodeHttpResult(spec),
        Effect.runSyncExit,
        StdbTesting.toHttpResponse,
      )

      expect(response).toBe(raw)
      expect(response.status).toBe(202)
      expect(response.text()).toBe("ok")
    }),
  )

  it.effect("maps malformed raw success values to empty 500 responses", () =>
    Effect.gen(function* () {
      const spec = httpHandler({ method: "post", path: "/raw" })
      const response = Effect.succeed({
        status: 200,
      } as unknown as Stdb.SyncResponse).pipe(
        StdbTesting.encodeHttpResult(spec),
        Effect.runSyncExit,
        StdbTesting.toHttpResponse,
      )

      expect(response.status).toBe(500)
      expect(response.text()).toBe("")
    }),
  )

  it.effect("encodes typed success bodies as bare JSON strings", () =>
    Effect.gen(function* () {
      const spec = httpHandler({
        method: "post",
        path: "/typed",
        request: Schema.Void,
        response: Schema.Struct({
          count: Schema.BigInt,
        }),
      })

      const response = Effect.succeed({ count: 42n }).pipe(
        StdbTesting.encodeHttpResult(spec),
        Effect.runSyncExit,
        StdbTesting.toHttpResponse,
      )

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("application/json")
      expect(typeof response.text()).toBe("string")
      expect(decodeJson(response.text())).toEqual({ count: "42" })
    }),
  )

  it.effect("encodes undefined success responses as empty bodies", () =>
    Effect.gen(function* () {
      const spec = httpHandler({
        method: "post",
        path: "/undefined-response",
        request: Schema.Void,
        response: Schema.Undefined,
      })

      const response = Effect.void.pipe(
        StdbTesting.encodeHttpResult(spec),
        Effect.runSyncExit,
        StdbTesting.toHttpResponse,
      )

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe(null)
      expect(response.text()).toBe("")
    }),
  )

  it.effect(
    "validates undefined success responses before omitting bodies",
    () =>
      Effect.gen(function* () {
        const spec = httpHandler({
          method: "post",
          path: "/invalid-undefined-response",
          request: Schema.Void,
          response: Schema.Undefined,
        })

        const exit = Effect.succeed("unexpected" as unknown as undefined).pipe(
          StdbTesting.encodeHttpResult(spec),
          Effect.runSyncExit,
        )
        const response = StdbTesting.toHttpResponse(exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
          )
          expect(failure).toBeInstanceOf(StdbTesting.HttpResponseEncodeError)
          expect(failure).toEqual(
            expect.objectContaining({
              phase: "success",
            }),
          )
        }
        expect(response.status).toBe(500)
        expect(response.text()).toBe("")
      }),
  )

  it.effect(
    "encodes declared errors with definition status and bare JSON body",
    () =>
      Effect.gen(function* () {
        const spec = httpHandler({
          method: "post",
          path: "/declared",
          request: Schema.Void,
          response: Schema.Void,
          errors: HttpErrors,
        })

        const response = MissingThing.make({ id: "missing" }).pipe(
          Effect.fail,
          StdbTesting.encodeHttpResult(spec),
          Effect.runSyncExit,
          StdbTesting.toHttpResponse,
        )

        expect(response.status).toBe(404)
        expect(response.headers.get("content-type")).toBe("application/json")
        expect(decodeJson(response.text())).toEqual({
          _tag: "MissingThing",
          id: "missing",
        })
      }),
  )

  it.effect("maps request decode errors to empty 400 responses", () =>
    Effect.gen(function* () {
      const response = new StdbTesting.HttpRequestDecodeError({
        cause: "bad json",
      }).pipe(Effect.fail, Effect.runSyncExit, StdbTesting.toHttpResponse)

      expect(response.status).toBe(400)
      expect(response.text()).toBe("")
    }),
  )

  it.effect(
    "maps encode failures, async, and defects to empty 500 responses",
    () =>
      Effect.gen(function* () {
        const spec = httpHandler({
          method: "post",
          path: "/typed",
          request: Schema.Void,
          response: Schema.Struct({
            value: Schema.String,
          }),
        })

        const encodeFailureExit = Effect.succeed({ value: 1 } as unknown as {
          value: string
        }).pipe(StdbTesting.encodeHttpResult(spec), Effect.runSyncExit)
        const encodeFailure = StdbTesting.toHttpResponse(encodeFailureExit)
        const asyncFailure = Effect.promise(() =>
          Promise.resolve({ value: "late" }),
        ).pipe(
          StdbTesting.encodeHttpResult(spec),
          Effect.runSyncExit,
          StdbTesting.toHttpResponse,
        )
        const defect = StdbTesting.toHttpResponse(Exit.die("boom"))

        expect(Exit.isFailure(encodeFailureExit)).toBe(true)
        if (Exit.isFailure(encodeFailureExit)) {
          const failure = encodeFailureExit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
          )
          expect(failure).toBeInstanceOf(StdbTesting.HttpResponseEncodeError)
          expect(failure).toEqual(
            expect.objectContaining({
              phase: "success",
            }),
          )
        }
        expect(encodeFailure.status).toBe(500)
        expect(encodeFailure.text()).toBe("")
        expect(asyncFailure.status).toBe(500)
        expect(asyncFailure.text()).toBe("")
        expect(defect.status).toBe(500)
        expect(defect.text()).toBe("")
      }),
  )

  it.effect("keeps declared error response encode failures typed", () =>
    Effect.gen(function* () {
      const spec = httpHandler({
        method: "post",
        path: "/declared-encode-failure",
        request: Schema.Void,
        response: Schema.Void,
        errors: DeclaredEncodeBrokenErrors,
      })

      const exit = DeclaredEncodeBroken.make({ code: "bad-encode" }).pipe(
        Effect.fail,
        StdbTesting.encodeHttpResult(spec),
        Effect.runSyncExit,
      )
      const response = StdbTesting.toHttpResponse(exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.pipe(
          Cause.findErrorOption,
          Option.getOrUndefined,
        )
        expect(failure).toBeInstanceOf(StdbTesting.HttpResponseEncodeError)
        expect(failure).toEqual(
          expect.objectContaining({
            phase: "declaredError",
          }),
        )
      }
      expect(response.status).toBe(500)
      expect(response.text()).toBe("")
    }),
  )

  it.effect(
    "preserves the original cause when declared error classification fails",
    () =>
      Effect.gen(function* () {
        const spec = httpHandler({
          method: "post",
          path: "/malformed-declared",
          request: Schema.Void,
          response: Schema.Void,
          errors: HttpErrors,
        })
        const malformedDeclaredError = {
          _tag: "MissingThing",
          id: 123,
        }

        const exit = Effect.fail(malformedDeclaredError).pipe(
          StdbTesting.encodeHttpResult(spec),
          Effect.runSyncExit,
        )
        const response = StdbTesting.toHttpResponse(exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
          )
          expect(failure).toBe(malformedDeclaredError)
        }
        expect(response.status).toBe(500)
        expect(response.text()).toBe("")
      }),
  )
})
