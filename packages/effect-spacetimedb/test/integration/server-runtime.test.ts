
import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Console from "effect/Console"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Random from "effect/Random"
import * as References from "effect/References"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { compileModule } from "effect-spacetimedb/server-compiler"
import { ConnectionId, Identity, Timestamp, Uuid } from "spacetimedb"
import { SyncResponse as NativeSyncResponse } from "spacetimedb/server"
import {
  testEffectCallbackError,
  unwrapTestEffectCallbackError,
} from "../helpers/effect-errors"

const { expect } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import type * as Server from "effect-spacetimedb/server"
import {
  type ConstrainedServerRuntimeMode,
  provideConstrainedServerRuntime,
  provideConstrainedServerSupport,
  ReducerAsyncNotAllowedError,
  ReducerGlobalRandomNotAllowedError,
  StdbDecodeError,
  StdbUniqueAlreadyExistsError,
} from "effect-spacetimedb/server"
import * as StdbTesting from "effect-spacetimedb/testing"
import { makeServerRandom } from "../../src/server/runtime-layer.ts"
import {
  ExampleErrors,
  FullModule,
  FullStdbModule,
  UserId,
  UserMissing,
  UserName,
} from "../fixtures/full-module"
import { encodeJson } from "../helpers/json"
import { makeMockHttpClientLayer } from "../helpers/mock-http-client"
import {
  assertHostBoundaryThrow,
  type CapturedLog,
  hostCause,
  logWithCapturedLogger,
} from "../helpers/server-runtime"
import * as SpacetimeServerStub from "../helpers/spacetimedb-server"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"
import { makeFullModuleWsDb } from "../helpers/ws-fixtures"

const describe = EffectVitest.layer(TestLayer)

type UserRow = StdbTesting.TableRow<typeof FullModule.tables.user>
type PresenceEventRow = StdbTesting.TableRow<
  typeof FullModule.tables.presenceEvent
>
type ReminderRow = StdbTesting.TableRow<typeof FullModule.tables.reminder>

const reminderFireArgs = (id: bigint) => ({
  data: {
    scheduledId: 0n,
    scheduledAt: Stdb.ScheduleAt.interval("1 second"),
    id,
  },
})

type CombinedRuntimeDefectKind = "declared-procedure" | "transaction"

const combinedRuntimeDefectMessage = (
  kind: CombinedRuntimeDefectKind,
): "combined declared defect" | "combined tx defect" =>
  Match.value(kind).pipe(
    Match.when("declared-procedure", () => "combined declared defect" as const),
    Match.when("transaction", () => "combined tx defect" as const),
    Match.exhaustive,
  )

class CombinedRuntimeDefect extends Data.TaggedError("CombinedRuntimeDefect")<{
  readonly kind: CombinedRuntimeDefectKind
}> {
  override readonly message = combinedRuntimeDefectMessage(this.kind)
}

const decodeUserId = Schema.decodeUnknownSync(UserId)
const decodeUserName = Schema.decodeUnknownSync(UserName)
const CompilerGuardId = Schema.BigInt.pipe(Schema.brand("CompilerGuardId"))

const makeUserRow = (id: string, name: string): UserRow => ({
  id: decodeUserId(id),
  name: decodeUserName(name),
})

const makeRandom = (value = 0.25) =>
  Object.assign(() => value, {
    fill: <T>(array: T): T => array,
    uint32: () => 1,
    integerInRange: (min: number) => min,
    bigintInRange: (min: bigint) => min,
  })

const makeRandomSequence = (values: ReadonlyArray<number>) => {
  let index = 0
  const calls: Array<number> = []
  const random = Object.assign(
    () => {
      const fallback = values[values.length - 1] ?? 0
      const value = values[index] ?? fallback
      index = index + 1
      calls.push(value)
      return value
    },
    {
      fill: <T>(array: T): T => array,
      uint32: () => 1,
      integerInRange: (min: number) => min,
      bigintInRange: (min: bigint) => min,
    },
  )

  return { calls, random }
}

const makeRandomSurfaceSequence = (options: {
  readonly doubles: ReadonlyArray<number>
  readonly integers: ReadonlyArray<bigint>
}) => {
  let doubleIndex = 0
  let bigintIndex = 0
  const doubleCalls: Array<number> = []
  const bigintCalls: Array<{ readonly min: bigint; readonly max: bigint }> = []
  const random = Object.assign(
    () => {
      const fallback = options.doubles[options.doubles.length - 1] ?? 0
      const value = options.doubles[doubleIndex] ?? fallback
      doubleIndex = doubleIndex + 1
      doubleCalls.push(value)
      return value
    },
    {
      fill: <T>(array: T): T => array,
      uint32: () => 1,
      integerInRange: (min: number) => min,
      bigintInRange: (min: bigint, max: bigint) => {
        const fallback = options.integers[options.integers.length - 1] ?? min
        const value = options.integers[bigintIndex] ?? fallback
        bigintIndex = bigintIndex + 1
        bigintCalls.push({ min, max })
        return value
      },
    },
  )

  return { bigintCalls, doubleCalls, random }
}

const installMathRandomScoped = (random: () => number) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        const original = Object.getOwnPropertyDescriptor(Math, "random")

        Object.defineProperty(Math, "random", {
          configurable: true,
          enumerable: original?.enumerable ?? false,
          writable: true,
          value: random,
        })

        return original
      },
      catch: testEffectCallbackError(
        "interop/effect-spacetimedb/integration/server-runtime",
      ),
    }).pipe(Effect.orDie),
    (original) =>
      Effect.try({
        try: () => {
          if (original != null) {
            Object.defineProperty(Math, "random", original)
          } else {
            Reflect.deleteProperty(Math, "random")
          }
        },
        catch: testEffectCallbackError(
          "interop/effect-spacetimedb/integration/server-runtime",
        ),
      }).pipe(Effect.orDie),
  )

const withMathRandom = <A, E, R>(
  random: () => number,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  installMathRandomScoped(random).pipe(Effect.andThen(effect), Effect.scoped)

const DevGuardGlobalTargets = [
  { owner: globalThis, propertyKey: "setTimeout" },
  { owner: globalThis, propertyKey: "setInterval" },
  { owner: globalThis, propertyKey: "queueMicrotask" },
  { owner: Math, propertyKey: "random" },
] as const

const withRestoredDevGuardGlobals = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireRelease(
    Effect.try({
      try: () => ({
        defineProperty: Object.defineProperty,
        descriptors: DevGuardGlobalTargets.map((target) => ({
          target,
          descriptor: Object.getOwnPropertyDescriptor(
            target.owner,
            target.propertyKey,
          ),
        })),
      }),
      catch: testEffectCallbackError(
        "interop/effect-spacetimedb/integration/server-runtime",
      ),
    }).pipe(Effect.orDie),
    (snapshot) =>
      Effect.try({
        try: () => {
          snapshot.defineProperty(Object, "defineProperty", {
            configurable: true,
            writable: true,
            value: snapshot.defineProperty,
          })

          for (const { target, descriptor } of snapshot.descriptors) {
            if (descriptor != null) {
              snapshot.defineProperty(
                target.owner,
                target.propertyKey,
                descriptor,
              )
            } else {
              Reflect.deleteProperty(target.owner, target.propertyKey)
            }
          }
        },
        catch: testEffectCallbackError(
          "interop/effect-spacetimedb/integration/server-runtime",
        ),
      }).pipe(Effect.orDie),
  ).pipe(Effect.andThen(effect), Effect.scoped)

type RecordedConsoleMethod =
  | "log"
  | "info"
  | "error"
  | "warn"
  | "debug"
  | "trace"

type RecordedConsoleCall = {
  readonly method: RecordedConsoleMethod
  readonly args: ReadonlyArray<unknown>
}

const makeRecordingConsole = (
  calls: Array<RecordedConsoleCall>,
  baseConsole: typeof globalThis.console,
): typeof globalThis.console => ({
  ...baseConsole,
  log: (...args) => {
    calls.push({ method: "log", args })
  },
  info: (...args) => {
    calls.push({ method: "info", args })
  },
  error: (...args) => {
    calls.push({ method: "error", args })
  },
  warn: (...args) => {
    calls.push({ method: "warn", args })
  },
  debug: (...args) => {
    calls.push({ method: "debug", args })
  },
  trace: (...args) => {
    calls.push({ method: "trace", args })
  },
})

const makeRecordingSyncRunner = (
  calls: Array<RecordedConsoleCall>,
): Server.SyncRunner => {
  const recordingConsole = makeRecordingConsole(calls, globalThis.console)
  const withRecordingConsole = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, Console.Console, recordingConsole)

  return {
    runSync: (effect) => effect.pipe(withRecordingConsole, Effect.runSync),
    runSyncExit: (effect) =>
      effect.pipe(withRecordingConsole, Effect.runSyncExit),
  }
}

const hasConsoleCall = (
  calls: ReadonlyArray<RecordedConsoleCall>,
  methods: ReadonlyArray<RecordedConsoleMethod>,
  text: string,
): boolean =>
  calls.some(
    (call) =>
      methods.includes(call.method) &&
      call.args.some((arg) => String(arg).includes(text)),
  )

const makeFakeDb = (initialUsers: ReadonlyArray<UserRow>) => {
  const users = [...initialUsers]
  const insertCallbacks = new Set<(ctx: unknown, row: UserRow) => void>()
  const deleteCallbacks = new Set<(ctx: unknown, row: UserRow) => void>()
  const updateCallbacks = new Set<
    (ctx: unknown, oldRow: UserRow, newRow: UserRow) => void
  >()

  const userTable = {
    count: () => BigInt(users.length),
    iter: () => users.values(),
    insert: (row: UserRow) => {
      users.push(row)
      insertCallbacks.forEach((callback) => callback({}, row))
      return row
    },
    delete: (row: UserRow) => {
      const index = users.findIndex((candidate) => candidate.id === row.id)
      if (index >= 0) {
        const [removed] = users.splice(index, 1)
        if (removed != null) {
          deleteCallbacks.forEach((callback) => callback({}, removed))
        }
        return true
      }
      return false
    },
    clear: () => {
      const deleted = BigInt(users.length)
      users.splice(0, users.length)
      return deleted
    },
    update: (oldRow: UserRow, newRow: UserRow) => {
      const index = users.findIndex((candidate) => candidate.id === oldRow.id)
      if (index >= 0) {
        users[index] = newRow
        updateCallbacks.forEach((callback) => callback({}, oldRow, newRow))
      }
    },
    onInsert: (callback: (ctx: unknown, row: UserRow) => void) => {
      insertCallbacks.add(callback)
    },
    removeOnInsert: (callback: (ctx: unknown, row: UserRow) => void) => {
      insertCallbacks.delete(callback)
    },
    onDelete: (callback: (ctx: unknown, row: UserRow) => void) => {
      deleteCallbacks.add(callback)
    },
    removeOnDelete: (callback: (ctx: unknown, row: UserRow) => void) => {
      deleteCallbacks.delete(callback)
    },
    onUpdate: (
      callback: (ctx: unknown, oldRow: UserRow, newRow: UserRow) => void,
    ) => {
      updateCallbacks.add(callback)
    },
    removeOnUpdate: (
      callback: (ctx: unknown, oldRow: UserRow, newRow: UserRow) => void,
    ) => {
      updateCallbacks.delete(callback)
    },
    id: {
      find: (id: string) => users.find((user) => user.id === id),
      delete: (id: string) => {
        const index = users.findIndex((user) => user.id === id)
        if (index >= 0) {
          users.splice(index, 1)
          return true
        }
        return false
      },
      update: (row: UserRow) => {
        const index = users.findIndex((user) => user.id === row.id)
        if (index >= 0) {
          users[index] = row
        }
        return row
      },
      upsert: (row: UserRow) => {
        const index = users.findIndex((user) => user.id === row.id)
        if (index >= 0) {
          users[index] = row
        } else {
          users.push(row)
        }
        return row
      },
    },
  }

  const presenceEvent = {
    count: () => 0n,
    iter: () => ([] as ReadonlyArray<PresenceEventRow>).values(),
    insert: (row: PresenceEventRow) => row,
    delete: () => false,
    clear: () => 0n,
    update: () => undefined,
    onInsert: () => undefined,
    removeOnInsert: () => undefined,
    onDelete: () => undefined,
    removeOnDelete: () => undefined,
    onUpdate: () => undefined,
    removeOnUpdate: () => undefined,
  }

  const reminder = {
    count: () => 0n,
    iter: () => ([] as ReadonlyArray<ReminderRow>).values(),
    insert: (row: ReminderRow) => row,
    delete: () => false,
    clear: () => 0n,
    scheduledId: {
      find: () => undefined,
      delete: () => false,
      update: (row: ReminderRow) => row,
      upsert: (row: ReminderRow) => row,
    },
  }

  return {
    user: userTable,
    presenceEvent,
    reminder,
    snapshotUsers: () => [...users],
    restoreUsers: (snapshot: ReadonlyArray<UserRow>) => {
      users.splice(0, users.length, ...snapshot)
    },
  }
}

const makeProcedureCtx = (db: ReturnType<typeof makeFakeDb>) => ({
  sender: "sender",
  identity: "sender",
  timestamp: {
    microsSinceUnixEpoch: 1000n,
  },
  connectionId: "connection-1",
  newUuidV4: () => "uuid-v4",
  newUuidV7: () => "uuid-v7",
  random: makeRandom(),
  http: {
    fetch: () => ({
      text: () => "",
      json: () => ({}),
      bytes: () => new Uint8Array(),
    }),
  },
  db,
  withTx: <A>(body: (ctx: ReturnType<typeof makeReducerCtx>) => A) =>
    body(makeReducerCtx(db)),
})

const makeReducerCtx = (db: ReturnType<typeof makeFakeDb>) => ({
  sender: "sender",
  identity: "sender",
  timestamp: {
    microsSinceUnixEpoch: 1000n,
  },
  connectionId: "connection-1",
  senderAuth: {
    isInternal: false,
    hasJWT: false,
    jwt: null,
  },
  newUuidV4: () => "uuid-v4",
  newUuidV7: () => "uuid-v7",
  random: makeRandom(),
  db,
})

const makeNativeReducerCtx = (
  db: ReturnType<typeof makeFakeDb>,
): Server.ServerReducerCtx<typeof FullModule> => ({
  sender: new Identity(1n),
  identity: new Identity(1n),
  timestamp: new Timestamp(1000n),
  connectionId: new ConnectionId(3n),
  senderAuth: {
    isInternal: false,
    hasJWT: false,
    jwt: null,
  },
  newUuidV4: () => new Uuid(4n),
  newUuidV7: () => new Uuid(7n),
  random: makeRandom(),
  db,
})

const makeNativeProcedureCtx = (
  db: ReturnType<typeof makeFakeDb>,
): Server.ServerProcedureCtx<typeof FullModule> => ({
  sender: new Identity(1n),
  identity: new Identity(1n),
  timestamp: new Timestamp(1000n),
  connectionId: new ConnectionId(3n),
  newUuidV4: () => new Uuid(4n),
  newUuidV7: () => new Uuid(7n),
  random: makeRandom(),
  http: {
    fetch: () => new NativeSyncResponse(""),
  },
  withTx: (body) => {
    const snapshot = db.snapshotUsers()
    try {
      return body(makeNativeReducerCtx(db))
    } catch (cause) {
      db.restoreUsers(snapshot)
      throw cause
    }
  },
})

describe("server runtime", (it) => {
  it.effect(
    "encodes unit declared procedure successes with an ok result envelope",
    () =>
      Effect.gen(function* () {
        const UnitProcedures = Stdb.StdbGroup.make("UnitProcedures").add(
          Stdb.StdbFn.procedure("declaredDone", {
            params: Stdb.struct({}),
            returns: Stdb.unit(),
            errors: ExampleErrors,
          }),
        )
        const UnitModule = Stdb.StdbModule.make("unit_declared", {}).add(
          UnitProcedures,
        ).spec
        const server = StdbTesting.makeServer({
          module: UnitModule,
          runtime: TestSyncRunner,
        })
        const boundProcedures = server.procedures({
          declaredDone: server.procedure(
            Effect.fn(function* (_input: Record<string, never>) {
              return undefined
            }),
          ) as never,
        })

        const procedure = boundProcedures.declaredDone!
        const result = procedure.invoke(
          makeProcedureCtx(makeFakeDb([])) as never,
          {},
        )
        expect(result).toEqual({
          ok: undefined,
        })

        const Envelope = StdbTesting.procedureEnvelope(
          UnitModule.procedures.declaredDone.returns,
          UnitModule.procedures.declaredDone.errors,
        )
        const host = StdbTesting.encodeHostValue(Envelope, result)
        expect(host).toEqual({
          ok: {},
        })
        expect(
          yield* StdbTesting.ClientValueCodec.httpJson.decodeOutput(
            Envelope,
            encodeJson(host),
          ),
        ).toEqual({
          tag: "ok",
        })
      }),
  )

  it.effect(
    "lowers declared procedure errors into result envelopes and decodes them over HTTP",
    () =>
      Effect.gen(function* () {
        type FullDb = Server.DbService<typeof FullModule>
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })

        const boundProcedures = server.procedures({
          userGet: server.procedure(
            Effect.fn(function* ({ userId }: { readonly userId: string }) {
              const user = yield* server.withTx(
                Effect.gen(function* () {
                  const db = yield* server.db
                  return yield* db.user.id.find(userId as never)
                }),
              )

              if (user == null) {
                return yield* UserMissing.make({ userId: userId as never })
              }

              return user
            }),
          ) as never,
        })

        const db = makeFakeDb([makeUserRow("user-1", "Ada")])
        const procedure = boundProcedures.userGet!

        expect(
          procedure.invoke(makeProcedureCtx(db) as never, {
            userId: "user-1" as never,
          }),
        ).toEqual({
          ok: {
            id: "user-1",
            name: "Ada",
          },
        })

        const http = StdbTesting.ClientHttp.make({
          module: FullModule,
          uri: "http://stdb.test",
          databaseName: "full",
        })
        const UserGetEnvelope = StdbTesting.procedureEnvelope(
          FullModule.procedures.userGet.returns,
          FullModule.procedures.userGet.errors!,
        )

        const result = yield* http.procedures
          .userGet({
            userId: "user-1" as never,
          })
          .pipe(
            Effect.provide(
              makeMockHttpClientLayer((request) =>
                Effect.try({
                  try: () => ({
                    body: encodeJson(
                      StdbTesting.encodeHostValue(
                        UserGetEnvelope,
                        procedure.invoke(makeProcedureCtx(db) as never, {
                          userId: (
                            request.body as ReadonlyArray<unknown>
                          )[0] as never,
                        }),
                      ),
                    ),
                  }),
                  catch: testEffectCallbackError(
                    "interop/effect-spacetimedb/integration/server-runtime",
                  ),
                }),
              ),
            ),
          )
        expect(result).toEqual({
          id: "user-1",
          name: "Ada",
        })

        const exit = yield* Effect.exit(
          http.procedures.userGet({ userId: "missing" as never }).pipe(
            Effect.provide(
              makeMockHttpClientLayer((request) =>
                Effect.try({
                  try: () => ({
                    body: encodeJson(
                      StdbTesting.encodeHostValue(
                        UserGetEnvelope,
                        procedure.invoke(makeProcedureCtx(db) as never, {
                          userId: (
                            request.body as ReadonlyArray<unknown>
                          )[0] as never,
                        }),
                      ),
                    ),
                  }),
                  catch: testEffectCallbackError(
                    "interop/effect-spacetimedb/integration/server-runtime",
                  ),
                }),
              ),
            ),
          ),
        )
        expect(Exit.isFailure(exit)).toBe(true)
      }),
  )

  it.effect("preserves declared withTx failures for procedure envelopes", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      const boundProcedures = server.procedures({
        userGet: server.procedure(
          Effect.fn(function* ({ userId }: { readonly userId: string }) {
            return yield* server.withTx(
              UserMissing.make({ userId: userId as never }),
            )
          }),
        ) as never,
      })

      const db = makeFakeDb([])
      const procedure = boundProcedures.userGet!
      const encodedMissing = yield* StdbTesting.ContractError.encodeString(
        FullModule.procedures.userGet.errors!,
        UserMissing.make({ userId: "missing" as never }),
      )

      expect(
        procedure.invoke(makeProcedureCtx(db) as never, {
          userId: "missing" as never,
        }),
      ).toEqual({
        err: encodedMissing,
      })

      const http = StdbTesting.ClientHttp.make({
        module: FullModule,
        uri: "http://stdb.test",
        databaseName: "full",
      })
      const UserGetEnvelope = StdbTesting.procedureEnvelope(
        FullModule.procedures.userGet.returns,
        FullModule.procedures.userGet.errors!,
      )

      const exit = yield* Effect.exit(
        http.procedures.userGet({ userId: "missing" as never }).pipe(
          Effect.provide(
            makeMockHttpClientLayer((request) =>
              Effect.try({
                try: () => ({
                  body: encodeJson(
                    StdbTesting.encodeHostValue(
                      UserGetEnvelope,
                      procedure.invoke(makeProcedureCtx(db) as never, {
                        userId: (
                          request.body as ReadonlyArray<unknown>
                        )[0] as never,
                      }),
                    ),
                  ),
                }),
                catch: testEffectCallbackError(
                  "interop/effect-spacetimedb/integration/server-runtime",
                ),
              }),
            ),
          ),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Option.getOrUndefined(Exit.getCause(exit))).toBeDefined()
      }
    }),
  )

  it.effect(
    "runs static withTx accessor procedure bodies inside transactions",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })

        const procedures = server.procedures({
          userGet: server.procedure(
            Effect.fn(function* ({ userId }: { readonly userId: UserId }) {
              return yield* FullStdbModule.withTx(
                Effect.gen(function* () {
                  const db = yield* FullStdbModule.Db
                  yield* db.user.insert(makeUserRow(userId, "Ada"))
                  return yield* db.user.id.find(userId)
                }),
              )
            }),
          ),
        })

        const db = makeFakeDb([])
        const userId = decodeUserId("user-1")

        expect(
          procedures.userGet!.invoke(makeNativeProcedureCtx(db), {
            userId,
          }),
        ).toEqual({
          ok: {
            id: "user-1",
            name: "Ada",
          },
        })
      }),
  )

  it.effect("surfaces static withTx accessor body failures", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      const procedures = server.procedures({
        userGet: server.procedure(
          Effect.fn(function* ({ userId }: { readonly userId: UserId }) {
            return yield* FullStdbModule.withTx(
              Effect.gen(function* () {
                const db = yield* FullStdbModule.Db
                yield* db.user.insert(makeUserRow(userId, "Ada"))
                return yield* UserMissing.make({ userId })
              }),
            )
          }),
        ),
      })

      const db = makeFakeDb([])
      const userId = decodeUserId("missing")
      const encodedMissing = yield* StdbTesting.ContractError.encodeString(
        FullModule.procedures.userGet.errors!,
        UserMissing.make({ userId }),
      )

      expect(
        procedures.userGet!.invoke(makeNativeProcedureCtx(db), {
          userId,
        }),
      ).toEqual({
        err: encodedMissing,
      })
      expect(db.user.id.find(userId)).toBeUndefined()
    }),
  )

  it.effect(
    "exposes scoped server context helpers without raw ctx plumbing",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })
        const seen = {} as Record<string, unknown>
        const db = makeFakeDb([])

        const reducers = server.reducers({
          userUpsert: server.reducer(
            Effect.fn(function* () {
              seen.reducerSender = yield* server.ctx.reducer.sender
              seen.reducerSenderAuth = yield* server.ctx.reducer.senderAuth
              seen.reducerUuid = yield* server.ctx.reducer.newUuidV4
              const random = yield* server.ctx.reducer.random
              seen.reducerRandom = random()
            }),
          ) as never,
        })
        const procedures = server.procedures({
          reminderFire: server.procedure(
            Effect.fn(function* () {
              seen.procedureSender = yield* server.ctx.procedure.sender
              seen.procedureUuid = yield* server.ctx.procedure.newUuidV7
              const txSender = yield* server.withTx(
                Effect.gen(function* () {
                  seen.txSenderAuth = yield* server.ctx.tx.senderAuth
                  return yield* server.ctx.tx.sender
                }),
              )
              seen.txSender = txSender
            }),
          ) as never,
        })

        reducers.userUpsert!.invoke(makeReducerCtx(db) as never, {
          userId: "user-1" as never,
          name: "Ada" as never,
        })
        procedures.reminderFire!.invoke(
          makeProcedureCtx(db) as never,
          reminderFireArgs(1n) as never,
        )

        expect(seen).toEqual({
          reducerSender: "sender",
          reducerSenderAuth: {
            isInternal: false,
            hasJWT: false,
            jwt: null,
          },
          reducerUuid: "uuid-v4",
          reducerRandom: 0.25,
          procedureSender: "sender",
          procedureUuid: "uuid-v7",
          txSender: "sender",
          txSenderAuth: {
            isInternal: false,
            hasJWT: false,
            jwt: null,
          },
        })
      }),
  )

  it.effect(
    "annotates reducer logs with module, handler, kind, and sender",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })
        const records: Array<CapturedLog> = []
        const reducers = server.reducers({
          userUpsert: server.reducer(
            Effect.fn(function* () {
              yield* logWithCapturedLogger(records, "reducer log")
            }),
          ) as never,
        })

        reducers.userUpsert!.invoke(makeReducerCtx(makeFakeDb([])) as never, {
          userId: "user-1" as never,
          name: "Ada" as never,
        })

        expect(records).toHaveLength(1)
        expect(records[0]?.annotations).toEqual({
          module: "example",
          handler: "userUpsert",
          kind: "reducer",
          sender: "sender",
        })
      }),
  )

  it.effect(
    "maps callable host failures before handler boundary marshalling",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })
        const cause = hostCause("UniqueAlreadyExists")
        let seen: unknown

        const reducers = server.reducers({
          userUpsert: server.reducer(
            Effect.fn(function* () {
              seen = yield* server.ctx.reducer.newUuidV4.pipe(
                Effect.catchTag("StdbUniqueAlreadyExistsError", (error) =>
                  Effect.succeed(error),
                ),
              )
            }),
          ) as never,
        })

        reducers.userUpsert!.invoke(
          {
            ...makeReducerCtx(makeFakeDb([])),
            newUuidV4: () => {
              throw cause
            },
          } as never,
          {
            userId: "user-1" as never,
            name: "Ada" as never,
          },
        )

        expect(seen).toBeInstanceOf(StdbUniqueAlreadyExistsError)
        expect((seen as StdbUniqueAlreadyExistsError).op).toBe(
          "reducerCtx.newUuidV4",
        )
        expect((seen as StdbUniqueAlreadyExistsError).cause).toBe(cause)
      }),
  )

  it.effect("formats widened reducer host failures at the host boundary", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })
      const cause = hostCause("UniqueAlreadyExists")
      const reducers = server.reducers({
        userUpsert: server.reducer(
          Effect.fn(function* () {
            return yield* new StdbUniqueAlreadyExistsError({
              op: "db.user.insert",
              cause,
            })
          }),
        ) as never,
      })

      const failure = yield* Effect.flip(
        Effect.try({
          try: () =>
            reducers.userUpsert!.invoke(
              makeReducerCtx(makeFakeDb([])) as never,
              {
                userId: "user-1" as never,
                name: "Ada" as never,
              },
            ),
          catch: testEffectCallbackError(
            "interop/effect-spacetimedb/integration/server-runtime",
          ),
        }),
      )

      assertHostBoundaryThrow(
        unwrapTestEffectCallbackError(failure),
        "db.user.insert",
        cause,
      )
    }),
  )

  it.effect(
    "formats widened procedure host failures at the host boundary",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })
        const cause = hostCause("UniqueAlreadyExists")
        const procedures = server.procedures({
          userGet: server.procedure(
            Effect.fn(function* () {
              return yield* new StdbUniqueAlreadyExistsError({
                op: "db.user.insert",
                cause,
              })
            }),
          ) as never,
        })

        const failure = yield* Effect.flip(
          Effect.try({
            try: () =>
              procedures.userGet!.invoke(
                makeProcedureCtx(makeFakeDb([])) as never,
                {
                  userId: "missing" as never,
                },
              ),
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/integration/server-runtime",
            ),
          }),
        )

        assertHostBoundaryThrow(
          unwrapTestEffectCallbackError(failure),
          "db.user.insert",
          cause,
        )
      }),
  )

  it.effect("rejects external calls to scheduled compiler exports", () =>
    Effect.gen(function* () {
      const compilerGuardSchedule = Stdb.scheduledTable(
        "compilerGuardSchedule",
        {
          columns: {
            id: Stdb.u64(CompilerGuardId),
          },
        },
      )
      const compilerGuardGroup = Stdb.StdbGroup.make("CompilerGuard").add(
        Stdb.StdbFn.scheduledProcedure("compilerGuardFire", {
          table: compilerGuardSchedule,
        }),
      )
      const compilerGuardModule = Stdb.StdbModule.make("compiler_guard", {})
        .addTables(compilerGuardSchedule)
        .add(compilerGuardGroup).spec
      const server = StdbTesting.makeServer({
        module: compilerGuardModule,
        runtime: TestSyncRunner,
      })
      let invoked = false
      const handlers = server.handlers({
        procedures: {
          compilerGuardFire: server.procedure(
            Effect.fn(function* ({ data }) {
              invoked = true
              void data.id
            }),
          ),
        },
      })
      const compiled = compileModule({
        server,
        handlers,
      })
      const externalCtx = {
        ...makeNativeProcedureCtx(makeFakeDb([])),
        sender: new Identity(2n),
        identity: new Identity(1n),
      }
      const rawArgs = {
        data: {
          scheduledId: 0n,
          scheduledAt: Stdb.ScheduleAt.interval("1 second"),
          id: 1n,
        },
      }
      const compilerGuardExport = compiled.exports.compiler_guard_fire

      expect(compilerGuardExport).toBeDefined()
      expect(compiled.exports.compilerGuardFire).toBeUndefined()

      expect(() =>
        SpacetimeServerStub.invokeModuleExport(
          compilerGuardExport,
          externalCtx,
          rawArgs,
        ),
      ).toThrow(
        "Scheduled target compilerGuardFire is only invocable by the scheduler",
      )
      expect(invoked).toBe(false)

      const unrecognizedIdentityCtx = {
        ...makeNativeProcedureCtx(makeFakeDb([])),
        sender: { value: 1n },
        identity: { value: 1n },
      }

      expect(() =>
        SpacetimeServerStub.invokeModuleExport(
          compilerGuardExport,
          unrecognizedIdentityCtx as never,
          rawArgs,
        ),
      ).toThrow(
        "Scheduled target compilerGuardFire is only invocable by the scheduler",
      )
      expect(invoked).toBe(false)

      const schedulerCtx = {
        ...makeNativeProcedureCtx(makeFakeDb([])),
        sender: new Identity(2n),
        identity: new Identity(1n),
        connectionId: null,
      }

      expect(() =>
        SpacetimeServerStub.invokeModuleExport(
          compilerGuardExport,
          schedulerCtx as never,
          rawArgs,
        ),
      ).not.toThrow()
      expect(invoked).toBe(true)

      invoked = false
      expect(() =>
        SpacetimeServerStub.invokeModuleExport(
          compilerGuardExport,
          schedulerCtx as never,
          rawArgs.data,
        ),
      ).not.toThrow()
      expect(invoked).toBe(true)
    }),
  )

  it.effect("adds callable context to compiled procedure decode failures", () =>
    Effect.gen(function* () {
      const ProcedureGroup = Stdb.StdbGroup.make("CompilerDecode").add(
        Stdb.StdbFn.procedure("decodeProcedure", {
          params: Stdb.struct({
            id: Stdb.string(UserId),
          }),
          returns: Stdb.struct({
            ok: Stdb.bool(),
          }),
        }),
      )
      const ProcedureModule = Stdb.StdbModule.make("compiler_decode", {}).add(
        ProcedureGroup,
      ).spec
      const server = StdbTesting.makeServer({
        module: ProcedureModule,
        runtime: TestSyncRunner,
      })

      const validHandlers = server.handlers({
        procedures: {
          decodeProcedure: server.procedure(
            Effect.fn(function* (_input: { readonly id: string }) {
              return { ok: true }
            }),
          ),
        },
      })
      const compiledValid = compileModule({
        server,
        handlers: validHandlers,
      })
      const argsFailure = yield* Effect.flip(
        Effect.try({
          try: (): void => {
            SpacetimeServerStub.invokeModuleExport(
              compiledValid.exports.decode_procedure,
              makeNativeProcedureCtx(makeFakeDb([])),
              { id: 1 },
            )
          },
          catch: testEffectCallbackError(
            "interop/effect-spacetimedb/integration/server-runtime",
          ),
        }),
      )
      const argsCause = unwrapTestEffectCallbackError(argsFailure)

      expect(argsCause).toBeInstanceOf(StdbDecodeError)
      if (argsCause instanceof StdbDecodeError) {
        expect(argsCause.phase).toBe("args")
        expect(argsCause.callable).toBe("decodeProcedure")
        expect(argsCause.op).toBe("procedures.decodeProcedure.params")
      }

      const invalidResultHandlers = server.handlers({
        procedures: {
          decodeProcedure: server.procedure(
            Effect.fn(function* (_input: { readonly id: string }) {
              return { ok: "not-bool" } as never
            }),
          ),
        },
      })
      const compiledInvalidResult = compileModule({
        server,
        handlers: invalidResultHandlers,
      })
      const resultFailure = yield* Effect.flip(
        Effect.try({
          try: (): void => {
            SpacetimeServerStub.invokeModuleExport(
              compiledInvalidResult.exports.decode_procedure,
              makeNativeProcedureCtx(makeFakeDb([])),
              { id: "user-1" },
            )
          },
          catch: testEffectCallbackError(
            "interop/effect-spacetimedb/integration/server-runtime",
          ),
        }),
      )
      const resultCause = unwrapTestEffectCallbackError(resultFailure)

      expect(resultCause).toBeInstanceOf(StdbDecodeError)
      if (resultCause instanceof StdbDecodeError) {
        expect(resultCause.phase).toBe("ok")
        expect(resultCause.callable).toBe("decodeProcedure")
        expect(resultCause.op).toBe("procedures.decodeProcedure.returns")
      }
    }),
  )

  it.effect(
    "does not use global Math.random for Effect.fn or Effect.withSpan",
    () =>
      Effect.gen(function* () {
        const db = makeFakeDb([])
        let randomCalls = 0
        const reducerBody = Effect.fn("randomless-traced-reducer")(
          function* () {
            yield* Effect.withSpan(Effect.void, "manual-span")
            return "ok"
          },
        )

        const result = yield* withMathRandom(
          () => {
            randomCalls = randomCalls + 1
            return 0.125
          },
          provideConstrainedServerRuntime(
            reducerBody(),
            makeReducerCtx(db),
            "runtime",
          ),
        )

        expect(result).toBe("ok")
        expect(randomCalls).toBe(0)
      }),
  )

  it.effect("uses ctx.random for Effect.Random in both runtime modes", () =>
    Effect.gen(function* () {
      const runRandomProgram = Effect.fn("run-random-program")(function* (
        mode: ConstrainedServerRuntimeMode,
      ) {
        const sequence = makeRandomSequence([0.25, 0.7, 0, 0.5])
        const ctx = {
          ...makeReducerCtx(makeFakeDb([])),
          random: sequence.random,
        }

        const result = yield* provideConstrainedServerRuntime(
          Effect.gen(function* () {
            const next = yield* Random.next
            const int = yield* Random.nextIntBetween(10, 20)
            const shuffled = yield* Random.shuffle(["a", "b", "c"])

            return {
              int,
              next,
              shuffled,
            }
          }),
          ctx,
          mode,
        )

        return {
          calls: sequence.calls,
          result,
        }
      })

      expect(yield* runRandomProgram("runtime")).toEqual({
        calls: [0.25, 0.7, 0, 0.5],
        result: {
          int: 17,
          next: 0.25,
          shuffled: ["c", "b", "a"],
        },
      })
      expect(yield* runRandomProgram("dev-guarded")).toEqual({
        calls: [0.25, 0.7, 0, 0.5],
        result: {
          int: 17,
          next: 0.25,
          shuffled: ["c", "b", "a"],
        },
      })
    }),
  )

  it.effect(
    "backs Effect.Random.nextInt with the host full-range integer draw",
    () =>
      Effect.gen(function* () {
        const runRandomProgram = Effect.fn("run-full-range-random-program")(
          function* (mode: ConstrainedServerRuntimeMode) {
            const sequence = makeRandomSurfaceSequence({
              doubles: [0.625],
              integers: [
                BigInt(Number.MIN_SAFE_INTEGER),
                -42n,
                BigInt(Number.MAX_SAFE_INTEGER),
              ],
            })
            const ctx = {
              ...makeReducerCtx(makeFakeDb([])),
              random: sequence.random,
            }
            const randomService = makeServerRandom(ctx)
            const directMin = randomService.nextIntUnsafe()

            const result = yield* provideConstrainedServerRuntime(
              Effect.gen(function* () {
                const negative = yield* Random.nextInt
                const double = yield* Random.next
                const upper = yield* Random.nextInt

                return {
                  double,
                  negative,
                  upper,
                }
              }),
              ctx,
              mode,
            )

            return {
              directMin,
              bigintCalls: sequence.bigintCalls,
              doubleCalls: sequence.doubleCalls,
              result,
              serviceKeys: Object.keys(randomService).sort(),
            }
          },
        )

        const expected = {
          directMin: Number.MIN_SAFE_INTEGER,
          bigintCalls: [
            {
              min: BigInt(Number.MIN_SAFE_INTEGER),
              max: BigInt(Number.MAX_SAFE_INTEGER),
            },
            {
              min: BigInt(Number.MIN_SAFE_INTEGER),
              max: BigInt(Number.MAX_SAFE_INTEGER),
            },
            {
              min: BigInt(Number.MIN_SAFE_INTEGER),
              max: BigInt(Number.MAX_SAFE_INTEGER),
            },
          ],
          doubleCalls: [0.625],
          result: {
            double: 0.625,
            negative: -42,
            upper: Number.MAX_SAFE_INTEGER,
          },
          serviceKeys: ["nextDoubleUnsafe", "nextIntUnsafe"],
        }

        expect(yield* runRandomProgram("runtime")).toEqual(expected)
        expect(yield* runRandomProgram("runtime")).toEqual(expected)
        expect(yield* runRandomProgram("dev-guarded")).toEqual(expected)
      }),
  )

  it.effect("rejects global Math.random inside dev-guarded reducers", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })
      const reducers = server.reducers({
        userUpsert: server.reducer(
          Effect.fn(function* () {
            Math.random()
          }),
        ) as never,
      })

      expect(() =>
        reducers.userUpsert!.invoke(makeReducerCtx(makeFakeDb([])) as never, {
          userId: decodeUserId("user-1"),
          name: decodeUserName("Ada"),
        }),
      ).toThrow(ReducerGlobalRandomNotAllowedError)

      const restoredValue = Math.random()
      expect(restoredValue).toBeGreaterThanOrEqual(0)
      expect(restoredValue).toBeLessThan(1)
    }),
  )

  it.effect(
    "continues restoring reducer dev guards after one target fails",
    () =>
      Effect.gen(function* () {
        const calls: Array<RecordedConsoleCall> = []
        const recordingConsole = makeRecordingConsole(calls, globalThis.console)
        const originalSetTimeout = globalThis.setTimeout
        const originalQueueMicrotask = globalThis.queueMicrotask
        const originalMathRandom = Math.random
        const originalDefineProperty = Object.defineProperty
        const forcedRestoreFailure = new Error(
          "forced setInterval restore failure",
        )

        const firstRun = yield* withRestoredDevGuardGlobals(
          Effect.gen(function* () {
            const exit = yield* provideConstrainedServerSupport(
              Effect.try({
                try: () => {
                  Object.defineProperty = ((
                    target: object,
                    propertyKey: PropertyKey,
                    descriptor: PropertyDescriptor,
                  ) => {
                    if (
                      target === globalThis &&
                      propertyKey === "setInterval"
                    ) {
                      throw forcedRestoreFailure
                    }

                    return originalDefineProperty(
                      target,
                      propertyKey,
                      descriptor,
                    )
                  }) as typeof Object.defineProperty
                },
                catch: testEffectCallbackError(
                  "interop/effect-spacetimedb/integration/server-runtime",
                ),
              }),
              "dev-guarded",
            ).pipe(Effect.exit)

            return {
              exit,
              mathRandomRestored: Math.random === originalMathRandom,
              queueMicrotaskRestored:
                globalThis.queueMicrotask === originalQueueMicrotask,
              setTimeoutRestored: globalThis.setTimeout === originalSetTimeout,
            }
          }).pipe(Effect.provideService(Console.Console, recordingConsole)),
        )

        expect(Exit.isSuccess(firstRun.exit)).toBe(true)
        expect(firstRun.mathRandomRestored).toBe(true)
        expect(firstRun.queueMicrotaskRestored).toBe(true)
        expect(firstRun.setTimeoutRestored).toBe(true)
        expect(
          hasConsoleCall(
            calls,
            ["warn"],
            "Failed to restore one or more reducer dev guards",
          ),
        ).toBe(true)

        const secondExit = yield* provideConstrainedServerSupport(
          Effect.try({
            try: () => Math.random(),
            catch: (cause) =>
              cause instanceof ReducerGlobalRandomNotAllowedError
                ? cause
                : testEffectCallbackError(
                    "interop/effect-spacetimedb/integration/server-runtime",
                  )(cause),
          }),
          "dev-guarded",
        ).pipe(Effect.exit)

        expect(Exit.isFailure(secondExit)).toBe(true)
        if (Exit.isFailure(secondExit)) {
          const failure = secondExit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
          )
          expect(failure).toBeInstanceOf(ReducerGlobalRandomNotAllowedError)
        }
      }),
  )

  it.effect("keeps global Math.random callable in runtime mode", () =>
    Effect.gen(function* () {
      const result = yield* provideConstrainedServerRuntime(
        Effect.try({
          try: () => Math.random(),
          catch: testEffectCallbackError(
            "interop/effect-spacetimedb/integration/server-runtime",
          ),
        }),
        makeReducerCtx(makeFakeDb([])),
        "runtime",
      )

      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThan(1)
    }),
  )

  it.effect("preserves declared procedure defects as defects", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      const boundProcedures = server.procedures({
        userGet: server.procedure(
          Effect.fn(function* ({ userId }: { readonly userId: string }) {
            return yield* Effect.die(
              UserMissing.make({ userId: userId as never }),
            )
          }),
        ) as never,
      })

      const procedure = boundProcedures.userGet!
      expect(() =>
        procedure.invoke(makeProcedureCtx(makeFakeDb([])) as never, {
          userId: "missing" as never,
        }),
      ).toThrow(UserMissing)
    }),
  )

  it.effect(
    "preserves defects when a declared procedure failure is combined with a defect",
    () =>
      Effect.gen(function* () {
        const combinedCause = Cause.combine(
          Cause.fail(UserMissing.make({ userId: decodeUserId("missing") })),
          Cause.die(
            new CombinedRuntimeDefect({
              kind: "declared-procedure",
            }),
          ),
        )
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })

        const boundProcedures = server.procedures({
          userGet: server.procedure(
            Effect.fn(function* (_args: { readonly userId: string }) {
              return yield* Effect.failCause(combinedCause)
            }),
          ) as never,
        })

        expect(() =>
          boundProcedures.userGet!.invoke(
            makeProcedureCtx(makeFakeDb([])) as never,
            {
              userId: "missing" as never,
            },
          ),
        ).toThrow("combined declared defect")
      }),
  )

  it.effect("preserves transaction body defects as defects", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })

      const procedures = server.procedures({
        reminderFire: server.procedure(
          Effect.fn(function* () {
            const txBody = Effect.die(
              UserMissing.make({ userId: "tx-defect" as never }),
            ) as Effect.Effect<void, Server.StdbHostCallError>
            return yield* server.withTx(
              txBody.pipe(
                Effect.catchTag("StdbHostCallError", () => Effect.void),
              ),
            )
          }),
        ) as never,
      })

      expect(() =>
        procedures.reminderFire!.invoke(
          makeProcedureCtx(makeFakeDb([])) as never,
          reminderFireArgs(1n) as never,
        ),
      ).toThrow(UserMissing)
    }),
  )

  it.effect(
    "preserves transaction body defects when combined with declared failures",
    () =>
      Effect.gen(function* () {
        const combinedCause = Cause.combine(
          Cause.fail(UserMissing.make({ userId: decodeUserId("tx-missing") })),
          Cause.die(
            new CombinedRuntimeDefect({
              kind: "transaction",
            }),
          ),
        )
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })

        const procedures = server.procedures({
          reminderFire: server.procedure(
            Effect.fn(function* () {
              return yield* server.withTx(Effect.failCause(combinedCause))
            }),
          ) as never,
        })

        expect(() =>
          procedures.reminderFire!.invoke(
            makeProcedureCtx(makeFakeDb([])) as never,
            reminderFireArgs(1n) as never,
          ),
        ).toThrow("combined tx defect")
      }),
  )

  it.effect(
    "preserves malformed declared procedure failures instead of replacing them with StdbDecodeError",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })
        const malformedMissing = Object.assign(
          new Error("malformed declared"),
          {
            _tag: "UserMissing",
            userId: 123,
          },
        )
        const procedures = server.procedures({
          userGet: server.procedure(((_args: { readonly userId: string }) =>
            Effect.fail(malformedMissing)) as never) as never,
        })

        const invoke = () =>
          procedures.userGet!.invoke(
            makeProcedureCtx(makeFakeDb([])) as never,
            {
              userId: "missing" as never,
            },
          )

        expect(invoke).toThrow(Error)

        const thrownExit = yield* Effect.exit(
          Effect.try({
            try: invoke,
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/integration/server-runtime",
            ),
          }),
        )

        expect(Exit.isFailure(thrownExit)).toBe(true)
        if (Exit.isFailure(thrownExit)) {
          const failure = thrownExit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
            unwrapTestEffectCallbackError,
          )
          expect(failure).not.toBeInstanceOf(StdbDecodeError)
          expect(failure).toEqual(
            expect.objectContaining({
              message: malformedMissing.message,
              _tag: "UserMissing",
              userId: 123,
            }),
          )
        }
      }),
  )

  it.effect(
    "encodes declared reducer failures into SenderError envelopes",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })
        const reducers = server.reducers({
          userRequire: server.reducer(
            Effect.fn(function* ({ userId }) {
              return yield* UserMissing.make({ userId })
            }),
          ),
        })

        const invokeUserRequire = () =>
          reducers.userRequire!.invoke(
            makeReducerCtx(makeFakeDb([])) as never,
            {
              userId: "user-2" as never,
            },
          )

        const thrownExit = yield* Effect.exit(
          Effect.try({
            try: invokeUserRequire,
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/integration/server-runtime",
            ),
          }),
        )

        expect(Exit.isFailure(thrownExit)).toBe(true)
        if (Exit.isFailure(thrownExit)) {
          const error = thrownExit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
            unwrapTestEffectCallbackError,
          )

          expect(error).toBeInstanceOf(Error)
          expect(error).toEqual(
            expect.objectContaining({
              name: "SenderError",
            }),
          )

          const senderError = error as Error
          const decoded = yield* StdbTesting.ContractError.decodeString(
            FullModule.reducers.userRequire.errors!,
            senderError.message,
          )

          expect(decoded).toBeInstanceOf(UserMissing)
          expect(decoded).toMatchObject({
            userId: "user-2",
          })
        }
      }),
  )

  it.effect("preserves declared reducer defects as defects", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })
      const reducers = server.reducers({
        userRequire: server.reducer(
          Effect.fn(function* ({ userId }) {
            return yield* Effect.die(UserMissing.make({ userId }))
          }),
        ),
      })

      const invokeUserRequire = () =>
        reducers.userRequire!.invoke(makeReducerCtx(makeFakeDb([])) as never, {
          userId: "user-2" as never,
        })

      expect(invokeUserRequire).toThrow(UserMissing)

      const thrownExit = yield* Effect.exit(
        Effect.try({
          try: invokeUserRequire,
          catch: testEffectCallbackError(
            "interop/effect-spacetimedb/integration/server-runtime",
          ),
        }),
      )

      expect(Exit.isFailure(thrownExit)).toBe(true)
      if (Exit.isFailure(thrownExit)) {
        const error = thrownExit.cause.pipe(
          Cause.findErrorOption,
          Option.getOrUndefined,
          unwrapTestEffectCallbackError,
        )

        expect(error).toBeInstanceOf(UserMissing)
        expect(error).toMatchObject({
          userId: "user-2",
        })
      }
    }),
  )

  it.effect(
    "preserves malformed declared reducer failures instead of replacing them with StdbDecodeError",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })
        const malformedMissing = Object.assign(
          new Error("malformed declared"),
          {
            _tag: "UserMissing",
            userId: 123,
          },
        )
        const reducers = server.reducers({
          userRequire: server.reducer(((_args: { readonly userId: string }) =>
            Effect.fail(malformedMissing)) as never),
        })

        const invoke = () =>
          reducers.userRequire!.invoke(
            makeReducerCtx(makeFakeDb([])) as never,
            {
              userId: "user-2" as never,
            },
          )

        expect(invoke).toThrow(Error)

        const thrownExit = yield* Effect.exit(
          Effect.try({
            try: invoke,
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/integration/server-runtime",
            ),
          }),
        )

        expect(Exit.isFailure(thrownExit)).toBe(true)
        if (Exit.isFailure(thrownExit)) {
          const failure = thrownExit.cause.pipe(
            Cause.findErrorOption,
            Option.getOrUndefined,
            unwrapTestEffectCallbackError,
          )
          expect(failure).not.toBeInstanceOf(StdbDecodeError)
          expect(failure).toEqual(
            expect.objectContaining({
              message: malformedMissing.message,
              _tag: "UserMissing",
              userId: 123,
            }),
          )
        }
      }),
  )

  it.effect(
    "surfaces row decode failures from withTx iterators as StdbDecodeError",
    () =>
      Effect.gen(function* () {
        const server = StdbTesting.makeServer({
          module: FullModule,
          runtime: TestSyncRunner,
        })
        const procedures = server.procedures({
          userGet: server.procedure(
            Effect.fn(function* ({ userId }: { readonly userId: string }) {
              return yield* server.withTx(
                Effect.gen(function* () {
                  const db = yield* server.db
                  yield* db.user.toArray()
                  return yield* db.user.id.find(userId as never)
                }),
              )
            }),
          ) as never,
        })
        const db = makeFakeDb([]) as ReturnType<typeof makeFakeDb> & {
          readonly user: {
            readonly iter: () => Iterator<Record<string, unknown>>
          }
        }

        Object.assign(db.user, {
          iter: () =>
            [
              {
                id: "user-1",
              },
            ].values(),
        })

        const invoke = () =>
          procedures.userGet!.invoke(makeProcedureCtx(db) as never, {
            userId: "user-1" as never,
          })

        const failure = yield* Effect.flip(
          Effect.try({
            try: invoke,
            catch: testEffectCallbackError(
              "interop/effect-spacetimedb/integration/server-runtime",
            ),
          }),
        )
        const cause = unwrapTestEffectCallbackError(failure)

        expect(cause).toBeInstanceOf(StdbDecodeError)
        if (cause instanceof StdbDecodeError) {
          expect(cause.phase).toBe("row")
          expect(cause.table).toBe("user")
          expect(cause.op).toBe("db.user.iter")
          expect(cause.message).toContain("table=user")
          expect(cause.message).toContain("op=db.user.iter")
        }
      }),
  )

  it.effect("still throws undeclared reducer failures directly", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })
      const reducers = server.reducers({
        userUpsert: server.reducer(
          Effect.fn(function* () {
            return yield* UserMissing.make({ userId: "user-2" as never })
          }),
        ) as never,
      })

      expect(() =>
        reducers.userUpsert!.invoke(makeReducerCtx(makeFakeDb([])) as never, {
          userId: "user-2" as never,
          name: "Grace" as never,
        }),
      ).toThrow(UserMissing)
    }),
  )

  it.effect("rejects Effect.sleep inside constrained procedures", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })
      const procedures = server.procedures({
        reminderFire: server.procedure(
          Effect.fn(function* () {
            yield* Effect.sleep(Duration.millis(1))
          }),
        ) as never,
      })

      expect(() =>
        procedures.reminderFire!.invoke(
          makeProcedureCtx(makeFakeDb([])) as never,
          reminderFireArgs(1n) as never,
        ),
      ).toThrow(ReducerAsyncNotAllowedError)
    }),
  )

  it.effect("rejects promise suspension inside constrained reducers", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })
      const reducers = server.reducers({
        userUpsert: server.reducer(
          Effect.fn(function* () {
            yield* Effect.promise(() => Promise.resolve(1))
          }),
        ) as never,
      })

      expect(() =>
        reducers.userUpsert!.invoke(makeReducerCtx(makeFakeDb([])) as never, {
          userId: "user-1" as never,
          name: "Ada" as never,
        }),
      ).toThrow(ReducerAsyncNotAllowedError)
    }),
  )

  it.effect("interrupts rejected suspended reducer fibers", () =>
    Effect.gen(function* () {
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: TestSyncRunner,
      })
      let interrupted = false
      const reducerInterrupted = Deferred.makeUnsafe<void>()
      const reducers = server.reducers({
        userUpsert: server.reducer(
          Effect.fn(function* () {
            return yield* Effect.callback<never>(() =>
              Effect.try({
                try: () => {
                  interrupted = true
                  Deferred.doneUnsafe(reducerInterrupted, Effect.void)
                },
                catch: testEffectCallbackError(
                  "interop/effect-spacetimedb/integration/server-runtime",
                ),
              }).pipe(Effect.orDie),
            )
          }),
        ) as never,
      })

      expect(() =>
        reducers.userUpsert!.invoke(makeReducerCtx(makeFakeDb([])) as never, {
          userId: "user-1" as never,
          name: "Ada" as never,
        }),
      ).toThrow(ReducerAsyncNotAllowedError)

      yield* Deferred.await(reducerInterrupted)
      expect(interrupted).toBe(true)
    }),
  )

  it.effect("routes handler logs to host console methods", () =>
    Effect.gen(function* () {
      const calls: Array<RecordedConsoleCall> = []
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: makeRecordingSyncRunner(calls),
      })
      const reducers = server.reducers({
        userUpsert: server.reducer(
          Effect.fn(function* () {
            yield* Effect.gen(function* () {
              yield* Effect.log("hello")
              yield* Effect.logFatal("fatal")
              yield* Effect.logError("boom")
              yield* Effect.logWarning("careful")
              yield* Effect.logDebug("inspect")
              yield* Effect.logTrace("trace")
            }).pipe(Effect.provideService(References.MinimumLogLevel, "Trace"))
          }),
        ) as never,
      })

      reducers.userUpsert!.invoke(makeReducerCtx(makeFakeDb([])) as never, {
        userId: "user-1" as never,
        name: "Ada" as never,
      })

      expect(hasConsoleCall(calls, ["info"], "hello")).toBe(true)
      expect(hasConsoleCall(calls, ["error"], "fatal")).toBe(true)
      expect(hasConsoleCall(calls, ["error"], "boom")).toBe(true)
      expect(hasConsoleCall(calls, ["warn"], "careful")).toBe(true)
      expect(hasConsoleCall(calls, ["debug"], "inspect")).toBe(true)
      expect(hasConsoleCall(calls, ["trace"], "trace")).toBe(true)
    }),
  )

  it.effect("routes handler logs through the runner console ref", () =>
    Effect.gen(function* () {
      const calls: Array<RecordedConsoleCall> = []
      const server = StdbTesting.makeServer({
        module: FullModule,
        runtime: makeRecordingSyncRunner(calls),
      })
      const reducers = server.reducers({
        userUpsert: server.reducer(
          Effect.fn(function* () {
            yield* Effect.log("late-console")
          }),
        ) as never,
      })

      reducers.userUpsert!.invoke(makeReducerCtx(makeFakeDb([])) as never, {
        userId: "user-1" as never,
        name: "Ada" as never,
      })

      expect(hasConsoleCall(calls, ["info"], "late-console")).toBe(true)
    }),
  )

  it.effect("uses connection-owned cache and onApplied-only WS readiness", () =>
    Effect.gen(function* () {
      const relation = makeFakeDb([makeUserRow("user-1", "Ada")]).user
      const appliedCallbackRegistered = Deferred.makeUnsafe<() => void>()
      let unsubscribed = false
      const builder = {
        onApplied(callback: () => void) {
          Deferred.doneUnsafe(
            appliedCallbackRegistered,
            Effect.succeed(callback),
          )
          return builder
        },
        onError: () => builder,
        subscribe: () => ({
          isEnded: () => unsubscribed,
          unsubscribe: () => {
            unsubscribed = true
          },
        }),
      }

      const session = StdbTesting.ClientWs.make({
        module: FullModule,
        connection: {
          db: makeFullModuleWsDb({
            user: relation,
          }),
          subscriptionBuilder: () => builder,
        },
      })

      const fiber = yield* session.streamTable("user").pipe(
        Stream.runForEach(() => Effect.void),
        Effect.forkDetach({ startImmediately: true }),
      )
      const appliedCallback = yield* Deferred.await(appliedCallbackRegistered)
      yield* Effect.yieldNow

      expect(yield* session.cache.tables.user.toArray()).toEqual([
        {
          id: "user-1",
          name: "Ada",
        },
      ])
      expect(fiber.pollUnsafe() === undefined).toBe(true)

      appliedCallback()
      yield* Effect.yieldNow
      expect(unsubscribed).toBe(false)

      expect("eventTables" in (session.cache as object)).toBe(false)
      yield* Fiber.interrupt(fiber)
      expect(unsubscribed).toBe(true)
    }).pipe(Effect.scoped),
  )
})
