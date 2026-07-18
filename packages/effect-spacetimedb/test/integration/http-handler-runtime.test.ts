
import { make as makeServer } from "../../src/server/bind.ts"
import * as EffectVitest from "@effect/vitest"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

const { expect } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import type { SyncRunner } from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { Timestamp } from "spacetimedb"
import {
  type CompilerHttpHandlerHostCtx,
  toCompilerHttpHandlerCtx,
} from "../../src/server/compiler-interop"
import {
  moduleFromSections,
  rawHttpHandlerSpec,
} from "../helpers/module-builders"
import {
  type CapturedLog,
  logWithCapturedLogger,
} from "../helpers/server-runtime"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)
const decodeJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown),
)

class MissingUser extends Schema.TaggedErrorClass<MissingUser>()(
  "MissingUser",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

class CompilerHttpHandlerBindingTestError extends Data.TaggedError(
  "CompilerHttpHandlerBindingTestError",
)<{
  readonly cause: unknown
}> {}

class HttpHandlerRuntimeDefect extends Error {}

const RuntimeErrors = Stdb.errors(MissingUser)

const RuntimeModule = moduleFromSections({
  name: "http_runtime",
  tables: {
    user: Stdb.table("user", {
      columns: {
        id: Stdb.string().primaryKey(),
      },
    }),
  },
  httpHandlers: {
    raw: rawHttpHandlerSpec({ method: "post", path: "/raw" }),
    rawThrow: rawHttpHandlerSpec({ method: "post", path: "/raw-throw" }),
    bigintValue: rawHttpHandlerSpec({
      method: "post",
      path: "/bigint",
      request: Schema.Struct({ value: Schema.BigInt }),
      response: Schema.Struct({ value: Schema.BigInt }),
    }),
    voidRequest: rawHttpHandlerSpec({
      method: "post",
      path: "/void-request",
      request: Schema.Void,
      response: Schema.Struct({ ok: Schema.Boolean }),
    }),
    undefinedRequest: rawHttpHandlerSpec({
      method: "post",
      path: "/undefined-request",
      request: Schema.Undefined,
      response: Schema.Struct({ ok: Schema.Boolean }),
    }),
    voidResponse: rawHttpHandlerSpec({
      method: "post",
      path: "/void-response",
      request: Schema.Struct({ ok: Schema.Boolean }),
      response: Schema.Void,
    }),
    undefinedResponse: rawHttpHandlerSpec({
      method: "post",
      path: "/undefined-response",
      request: Schema.Struct({ ok: Schema.Boolean }),
      response: Schema.Undefined,
    }),
    invalidResponse: rawHttpHandlerSpec({
      method: "post",
      path: "/invalid-response",
      request: Schema.Void,
      response: Schema.Struct({ ok: Schema.Boolean }),
    }),
    declaredError: rawHttpHandlerSpec({
      method: "post",
      path: "/declared-error",
      request: Schema.Void,
      response: Schema.Void,
      errors: RuntimeErrors,
    }),
    mutate: rawHttpHandlerSpec({
      method: "post",
      path: "/mutate",
      request: Schema.Struct({ id: Schema.String }),
      response: Schema.Struct({ ok: Schema.Boolean }),
    }),
  },
})

const BoundaryModule = moduleFromSections({
  name: "http_boundary",
  httpHandlers: {
    boundary: rawHttpHandlerSpec({ method: "get", path: "/boundary" }),
  },
})

type RecordedConsoleCall = {
  readonly method: "error"
  readonly args: ReadonlyArray<unknown>
}

const makeBoundaryThrowingSyncRunner = (
  calls: Array<RecordedConsoleCall>,
): SyncRunner => {
  const recordingConsole = {
    ...globalThis.console,
    error: (...args: ReadonlyArray<unknown>) => {
      calls.push({ method: "error", args })
    },
  }
  const withRecordingConsole = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, Console.Console, recordingConsole)

  return {
    runSync: (effect) => effect.pipe(withRecordingConsole, Effect.runSync),
    runSyncExit: () => {
      throw new Error("runSyncExit exploded")
    },
  }
}

const makeDb = () => {
  const harness = StdbTesting.makeTestModuleHarness(RuntimeModule)
  harnessByDb.set(harness.db, harness)
  return {
    db: harness.db,
    users: () => [...harness.db.user.iter()],
  }
}

const harnessByDb = new WeakMap<
  object,
  StdbTesting.TestModuleHarness<typeof RuntimeModule>
>()

const makeHttpCtx = (db: ReturnType<typeof makeDb>["db"]) =>
  harnessByDb.get(db)!.makeHttpHandlerCtx({
    timestamp: new Timestamp(1000n),
    databaseIdentity: "database" as never,
  })

const makeRandom = () =>
  StdbTesting.makeTestModuleHarness(BoundaryModule).makeHttpHandlerCtx().random

class ThisDependentCompilerHttpHostCtx implements CompilerHttpHandlerHostCtx {
  readonly timestamp = new Timestamp(1000n)
  readonly http = {
    fetch: () => ({
      bytes: () => new Uint8Array(),
      json: () => ({}),
      text: () => "",
    }),
  }
  readonly identity = "database" as never
  readonly random = makeRandom()
  readonly db = { marker: "bound-db" }
  readonly uuidV4 = "uuid-v4" as never
  readonly uuidV7 = "uuid-v7" as never

  withTx<A>(body: (ctx: { readonly db: unknown }) => A): A {
    return body({ db: this.db })
  }

  newUuidV4() {
    return this.uuidV4
  }

  newUuidV7() {
    return this.uuidV7
  }
}

describe("HTTP handler runtime", (it) => {
  it("logs 500 causes inside the handler runtime but not 400 decode faults", () => {
    const calls: Array<ReadonlyArray<unknown>> = []
    const originalError = globalThis.console.error
    globalThis.console.error = (...args: ReadonlyArray<unknown>) => {
      calls.push(args)
    }
    try {
      const server = makeServer({ module: RuntimeModule })
      const handlers = server.httpHandlers({
        raw: server.httpHandler(
          Effect.fn(function* () {
            return yield* new CompilerHttpHandlerBindingTestError({
              cause: "undeclared failure",
            })
          }),
        ) as never,
        rawThrow: server.httpHandler(
          Effect.fn(function* () {
            return yield* Effect.die(
              new HttpHandlerRuntimeDefect("handler defect"),
            )
          }),
        ) as never,
        invalidResponse: server.httpHandler(
          Effect.fn(function* () {
            return { ok: "bad" } as unknown as { readonly ok: boolean }
          }),
        ),
        voidRequest: server.httpHandler(
          Effect.fn(function* () {
            return { ok: true }
          }),
        ),
      })
      const ctx = makeHttpCtx(makeDb().db)
      const invalid = handlers.invalidResponse.invoke(
        ctx,
        new Stdb.Request("http://module/invalid", { method: "POST" }),
      )
      expect(invalid.status).toBe(500)
      expect(invalid.text()).toBe("")
      expect(calls.flat().map(String).join(" ")).toContain("invalidResponse")
      expect(calls.flat().map(String).join(" ")).toContain(
        "HttpResponseEncodeError",
      )

      calls.splice(0, calls.length)
      const failed = handlers.raw.invoke(
        ctx,
        new Stdb.Request("http://module/raw", { method: "POST" }),
      )
      expect(failed.status).toBe(500)
      expect(failed.text()).toBe("")
      expect(calls.flat().map(String).join(" ")).toContain(
        "CompilerHttpHandlerBindingTestError",
      )

      calls.splice(0, calls.length)
      const defect = handlers.rawThrow.invoke(
        ctx,
        new Stdb.Request("http://module/raw-throw", { method: "POST" }),
      )
      expect(defect.status).toBe(500)
      expect(defect.text()).toBe("")
      expect(calls.flat().map(String).join(" ")).toContain("handler defect")

      calls.splice(0, calls.length)
      const decoded = handlers.voidRequest.invoke(
        ctx,
        new Stdb.Request("http://module/void", {
          method: "POST",
          body: "not-json",
        }),
      )
      expect(decoded.status).toBe(400)
      expect(calls).toEqual([])
    } finally {
      globalThis.console.error = originalError
    }
  })

  it.effect("keeps compiler HTTP transaction context bound to the host", () =>
    Effect.try({
      try: () => {
        const hostCtx = new ThisDependentCompilerHttpHostCtx()
        const ctx = toCompilerHttpHandlerCtx<typeof RuntimeModule>(hostCtx)

        expect(ctx.withTx(({ db }) => db)).toBe(hostCtx.db)
        expect(ctx.newUuidV4()).toBe(hostCtx.uuidV4)
        expect(ctx.newUuidV7()).toBe(hostCtx.uuidV7)
      },
      catch: (cause) => new CompilerHttpHandlerBindingTestError({ cause }),
    }),
  )

  it.effect("binds raw, typed, void, and transaction-backed handlers", () =>
    Effect.gen(function* () {
      const server = makeServer({
        module: RuntimeModule,
        runtime: TestSyncRunner,
      })
      const handlers = server.httpHandlers({
        raw: server.httpHandler(
          Effect.fn(function* (req: Stdb.Request) {
            return new Stdb.SyncResponse(req.text(), { status: 201 })
          }),
        ),
        rawThrow: server.httpHandler(
          Effect.fn(function* (req: Stdb.Request) {
            void req.json()
            return new Stdb.SyncResponse("unreachable")
          }),
        ),
        bigintValue: server.httpHandler(
          Effect.fn(function* (input: { readonly value: bigint }) {
            return { value: input.value + 1n }
          }),
        ),
        voidRequest: server.httpHandler(
          Effect.fn(function* (_input: void) {
            return { ok: true }
          }),
        ),
        undefinedRequest: server.httpHandler(
          Effect.fn(function* (_input: undefined) {
            return { ok: true }
          }),
        ),
        voidResponse: server.httpHandler(
          Effect.fn(function* (_input: { readonly ok: boolean }) {
            return undefined
          }),
        ),
        undefinedResponse: server.httpHandler(
          Effect.fn(function* (_input: { readonly ok: boolean }) {
            return undefined
          }),
        ),
        invalidResponse: server.httpHandler(
          Effect.fn(function* () {
            return { ok: "not-bool" } as unknown as { readonly ok: boolean }
          }),
        ),
        declaredError: server.httpHandler(
          Effect.fn(function* () {
            return yield* MissingUser.make({ id: "missing" })
          }),
        ),
        mutate: server.httpHandler(
          Effect.fn(function* (input: { readonly id: string }) {
            yield* server.httpTransaction(({ db }) => db.user.insert(input))
            return { ok: true }
          }),
        ),
      })
      const { db, users } = makeDb()
      const ctx = makeHttpCtx(db)

      const raw = handlers.raw.invoke(
        ctx,
        new Stdb.Request("http://module/raw", {
          method: "POST",
          body: "hello",
        }),
      )
      expect(raw.status).toBe(201)
      expect(raw.text()).toBe("hello")

      const rawThrow = handlers.rawThrow.invoke(
        ctx,
        new Stdb.Request("http://module/raw-throw", {
          method: "POST",
          body: "not-json",
        }),
      )
      expect(rawThrow.status).toBe(500)
      expect(rawThrow.text()).toBe("")

      const bigint = handlers.bigintValue.invoke(
        ctx,
        new Stdb.Request("http://module/bigint", {
          method: "POST",
          body: `{"value":"41"}`,
        }),
      )
      expect(typeof bigint.text()).toBe("string")
      expect(decodeJson(bigint.text())).toEqual({ value: "42" })

      const voidRequest = handlers.voidRequest.invoke(
        ctx,
        new Stdb.Request("http://module/void-request", { method: "POST" }),
      )
      expect(voidRequest.status).toBe(200)
      expect(decodeJson(voidRequest.text())).toEqual({ ok: true })

      const undefinedRequest = handlers.undefinedRequest.invoke(
        ctx,
        new Stdb.Request("http://module/undefined-request", {
          method: "POST",
        }),
      )
      expect(undefinedRequest.status).toBe(200)
      expect(decodeJson(undefinedRequest.text())).toEqual({ ok: true })

      const voidResponse = handlers.voidResponse.invoke(
        ctx,
        new Stdb.Request("http://module/void-response", {
          method: "POST",
          body: `{"ok":true}`,
        }),
      )
      expect(voidResponse.status).toBe(200)
      expect(voidResponse.text()).toBe("")
      expect(voidResponse.headers.get("content-type")).toBe(null)

      const undefinedResponse = handlers.undefinedResponse.invoke(
        ctx,
        new Stdb.Request("http://module/undefined-response", {
          method: "POST",
          body: `{"ok":true}`,
        }),
      )
      expect(undefinedResponse.status).toBe(200)
      expect(undefinedResponse.text()).toBe("")
      expect(undefinedResponse.headers.get("content-type")).toBe(null)

      const emptyNonVoid = handlers.bigintValue.invoke(
        ctx,
        new Stdb.Request("http://module/bigint", { method: "POST" }),
      )
      expect(emptyNonVoid.status).toBe(400)

      const invalidResponse = handlers.invalidResponse.invoke(
        ctx,
        new Stdb.Request("http://module/invalid-response", { method: "POST" }),
      )
      expect(invalidResponse.status).toBe(500)

      const declaredError = handlers.declaredError.invoke(
        ctx,
        new Stdb.Request("http://module/declared-error", { method: "POST" }),
      )
      expect(declaredError.status).toBe(404)
      expect(declaredError.headers.get("content-type")).toBe("application/json")
      expect(decodeJson(declaredError.text())).toEqual({
        _tag: "MissingUser",
        id: "missing",
      })

      const mutated = handlers.mutate.invoke(
        ctx,
        new Stdb.Request("http://module/mutate", {
          method: "POST",
          body: `{"id":"user-1"}`,
        }),
      )
      expect(mutated.status).toBe(200)
      expect(users()).toEqual([{ id: "user-1" }])
    }),
  )

  it.effect("annotates HTTP handler logs without sender", () =>
    Effect.gen(function* () {
      const server = makeServer({
        module: RuntimeModule,
        runtime: TestSyncRunner,
      })
      const records: Array<CapturedLog> = []
      const handlers = server.httpHandlers({
        raw: server.httpHandler(
          Effect.fn(function* (_req: Stdb.Request) {
            yield* logWithCapturedLogger(records, "http log")
            return new Stdb.SyncResponse("ok")
          }),
        ),
      })

      const { db } = makeDb()
      const response = handlers.raw.invoke(
        makeHttpCtx(db),
        new Stdb.Request("http://module/raw", { method: "POST" }),
      )

      expect(response.status).toBe(200)
      expect(records).toHaveLength(1)
      expect(records[0]?.annotations).toEqual({
        module: "http_runtime",
        handler: "raw",
        kind: "httpHandler",
      })
    }),
  )

  it.effect("logs uncaught host-boundary failures before returning 500", () =>
    Effect.gen(function* () {
      const calls: Array<RecordedConsoleCall> = []
      const server = makeServer({
        module: BoundaryModule,
        runtime: makeBoundaryThrowingSyncRunner(calls),
      })
      const handlers = server.httpHandlers({
        boundary: server.httpHandler(
          Effect.fn(function* (_req: Stdb.Request) {
            return new Stdb.SyncResponse("unreachable")
          }),
        ),
      })

      const response = handlers.boundary.invoke(
        StdbTesting.makeTestModuleHarness(BoundaryModule).makeHttpHandlerCtx(),
        new Stdb.Request("http://module/boundary", { method: "GET" }),
      )

      expect(response.status).toBe(500)
      expect(response.text()).toBe("")
      expect(
        calls.some((call) =>
          call.args.some((arg) => {
            const text = String(arg)
            return (
              text.includes("boundary") &&
              text.includes("GET /boundary") &&
              text.includes("runSyncExit exploded")
            )
          }),
        ),
      ).toBe(true)
    }),
  )
})
