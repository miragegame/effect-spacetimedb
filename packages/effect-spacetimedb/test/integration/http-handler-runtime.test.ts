// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - interop tests intentionally exercise raw STDB schema constructors
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Schema from "effect/Schema"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import type { SyncRunner } from "effect-spacetimedb/server"
import { Timestamp } from "spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
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

type UserRow = {
  readonly id: string
}

class MissingUser extends Schema.TaggedErrorClass<MissingUser>()(
  "MissingUser",
  { id: Schema.String },
  { httpApiStatus: 404 },
) {}

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
  const users: UserRow[] = []
  return {
    users,
    db: {
      user: {
        count: () => BigInt(users.length),
        iter: () => users.values(),
        insert: (row: UserRow) => {
          users.push(row)
          return row
        },
        delete: () => false,
        clear: () => 0n,
        id: {
          find: (id: string) => users.find((user) => user.id === id),
          delete: () => false,
          update: (row: UserRow) => row,
        },
      },
    },
  }
}

const makeRandom = () =>
  Object.assign(() => 0.5, {
    fill: <T>(array: T): T => array,
    uint32: () => 1,
    integerInRange: (min: number) => min,
    bigintInRange: (min: bigint) => min,
  })

const makeHttpCtx = (db: ReturnType<typeof makeDb>["db"]) => ({
  timestamp: new Timestamp(1000n),
  http: {
    fetch: () => new Stdb.SyncResponse("") as never,
  },
  databaseIdentity: "database" as never,
  random: makeRandom(),
  withTx: <A>(body: (ctx: { readonly db: typeof db }) => A) => body({ db }),
  newUuidV4: () => "uuid-v4" as never,
  newUuidV7: () => "uuid-v7" as never,
})

describe("HTTP handler runtime", (it) => {
  it.effect("binds raw, typed, void, and transaction-backed handlers", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
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
      expect(users).toEqual([{ id: "user-1" }])
    }),
  )

  it.effect("annotates HTTP handler logs without sender", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
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
      const server = StdbTesting.makeServer({
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
        makeHttpCtx({} as never) as never,
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
