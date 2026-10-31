import * as path from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpBody from "effect/http/HttpBody"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { normalizeIdentity } from "effect-spacetimedb"
import {
  makeDevServer,
  type PublishedDatabase,
  type PublishedModuleRuntime,
} from "effect-spacetimedb/dev-server"
import {
  buildModuleWithSpacetime,
  idcPairReceiverProject,
  idcPairSenderProject,
  packageRoot,
  requiredSpacetimeCliVersion,
} from "../../scripts/standalone-helpers.mjs"

// Inter-database calls between real databases: the `idc-pair` example's
// receiver and sender, published side by side on one standalone by the dev
// server. Every wait is on the databases' own state, read over owner SQL.

const { describe, expect, live } = EffectVitest

class IdcPairBundleError extends Data.TaggedError("IdcPairBundleError")<{
  readonly cause: unknown
}> {}

class IdcPairHttpError extends Data.TaggedError("IdcPairHttpError")<{
  readonly request: string
  readonly status: number
  readonly body: string
}> {}

class IdcPairWaitExpired extends Data.TaggedError("IdcPairWaitExpired")<{
  readonly awaiting: string
  readonly last: unknown
}> {}

class IdcPairIdentityDecodeError extends Data.TaggedError(
  "IdcPairIdentityDecodeError",
)<{
  readonly value: unknown
}> {}

// timeout-reason: a delivery and its settle run asynchronously after the
// sending commit; this bounds the wait for both on a loaded machine, far above
// the sub-second latency they take on an idle one.
const convergenceDurationMax = Duration.seconds(30)
const pollInterval = Duration.millis(100)
const pollAttemptsMax =
  Duration.toMillis(convergenceDurationMax) / Duration.toMillis(pollInterval)

// timeout-reason: the first case builds both modules (`spacetime build`,
// with a typecheck) before starting a standalone and publishing to it.
const testDurationMaxMs = 180_000

const zeroIdentity = "0".repeat(64)

let bundlesBuilt = false

/** Builds both example modules once per file; later calls reuse them. */
const ensureBundles = Effect.suspend(() =>
  bundlesBuilt
    ? Effect.void
    : Effect.try({
        try: () => {
          buildModuleWithSpacetime(idcPairReceiverProject)
          buildModuleWithSpacetime(idcPairSenderProject)
          bundlesBuilt = true
        },
        catch: (cause) => new IdcPairBundleError({ cause }),
      }),
)

type Pair = {
  /** The standalone, and the receiver: the runtime's first database. */
  readonly server: PublishedModuleRuntime
  readonly receiver: PublishedDatabase
  readonly sender: PublishedDatabase
}

const senderDatabaseName = "idc-pair-sender"

/**
 * Publishes the receiver, then the sender aimed at it, then tells the receiver
 * to trust the sender: each side learns the other's identity from its
 * environment, never from a call.
 */
const startPair = Effect.gen(function* () {
  yield* ensureBundles
  const server = yield* makeDevServer({
    bundlePath: idcPairReceiverProject.bundlePath,
    cwd: packageRoot,
    dbNamePrefix: idcPairReceiverProject.databaseNamePrefix,
    logDir: path.join(packageRoot, ".tmp", "effect-spacetimedb-idc"),
    versionRequirement: requiredSpacetimeCliVersion,
  })
  const sender = yield* publishSender(server, senderDatabaseName)
  yield* server.updateEnvironment({
    IDC_PAIR_TRUSTED_SENDER: sender.databaseIdentity,
  })
  const pair: Pair = { server, receiver: server, sender }
  return pair
})

const publishSender = (
  server: PublishedModuleRuntime,
  databaseName: string,
  receiverIdentity: string = server.databaseIdentity,
) =>
  server.publishDatabase({
    bundlePath: idcPairSenderProject.bundlePath,
    databaseName,
    environment: { IDC_PAIR_RECEIVER: receiverIdentity },
  })

// SpacetimeDB's own database HTTP routes (`/call`, `/sql`), with the owner
// token every database of the runtime shares. Reducer, table and column names
// are the modules' wire names, spelled out as a caller would.
const post = (
  server: PublishedModuleRuntime,
  database: PublishedDatabase,
  suffix: string,
  body: string,
  contentType: string,
) =>
  Effect.gen(function* () {
    const url = `${server.baseUrl}/v1/database/${encodeURIComponent(database.databaseName)}${suffix}`
    const response = yield* HttpClient.execute(
      HttpClientRequest.post(url).pipe(
        HttpClientRequest.bearerToken(server.token),
        HttpClientRequest.setBody(HttpBody.text(body, contentType)),
      ),
    )
    const text = yield* response.text
    if (response.status < 200 || response.status >= 300) {
      return yield* new IdcPairHttpError({
        request: `POST ${suffix}`,
        status: response.status,
        body: text,
      })
    }
    return text
  })

/** Calls the sender's `sendNote`, which commits one outbox row. */
const sendNote = (pair: Pair, sender: PublishedDatabase, note: string) =>
  post(
    pair.server,
    sender,
    "/call/send_note",
    JSON.stringify([note]),
    "application/json",
  )

const SqlResults = Schema.Struct({
  schema: Schema.Struct({
    elements: Schema.Array(
      Schema.Struct({ name: Schema.Struct({ some: Schema.String }) }),
    ),
  }),
  rows: Schema.Unknown.pipe(Schema.Array, Schema.Array),
}).pipe(Schema.Array, Schema.fromJsonString)

/** One query's column names and its rows keyed by them. */
const select = (pair: Pair, database: PublishedDatabase, query: string) =>
  post(pair.server, database, "/sql", query, "text/plain").pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(SqlResults)),
    Effect.map((results) => {
      const columns =
        results[0]?.schema.elements.map((element) => element.name.some) ?? []
      const rows = results.flatMap((result) =>
        result.rows.map((row) =>
          Object.fromEntries(
            columns.map((column, index) => [column, row[index]]),
          ),
        ),
      )
      return { columns, rows }
    }),
  )

// An identity column reads back as `["0x<hex>"]`, with leading zeros dropped.
const SqlIdentity = Schema.Tuple([Schema.String])

const identityHex = (value: unknown) =>
  Schema.decodeUnknownEffect(SqlIdentity)(value).pipe(
    Effect.flatMap(([hex]) => {
      const normalized = normalizeIdentity(BigInt(hex))
      return Result.isSuccess(normalized)
        ? Effect.succeed<string>(normalized.success)
        : Effect.fail(new IdcPairIdentityDecodeError({ value }))
    }),
  )

const ReceivedNoteRow = Schema.Struct({
  id: Schema.Finite,
  sender: Schema.Unknown,
  note: Schema.String,
})

/** The receiver's accepted notes, in arrival order. */
const receivedNotes = (pair: Pair) =>
  select(pair, pair.receiver, "SELECT * FROM receivedNote").pipe(
    Effect.flatMap(({ rows }) =>
      Effect.forEach(
        rows,
        (row) =>
          Schema.decodeUnknownEffect(ReceivedNoteRow)(row).pipe(
            Effect.flatMap((decoded) =>
              identityHex(decoded.sender).pipe(
                Effect.map((sender) => ({ ...decoded, sender })),
              ),
            ),
          ),
        { concurrency: 1 },
      ),
    ),
    Effect.map((rows) =>
      [...rows]
        .sort((left, right) => left.id - right.id)
        .map(({ sender, note }) => ({ sender, note })),
    ),
  )

const NoteDeliveryRow = Schema.Struct({
  msg_id: Schema.Finite,
  note: Schema.String,
  delivered: Schema.Boolean,
  message: Schema.String,
  settled_by: Schema.Unknown,
})

/** What a sender's settle reducer recorded, by outbox row. */
const deliveries = (pair: Pair, sender: PublishedDatabase) =>
  select(pair, sender, "SELECT * FROM noteDelivery").pipe(
    Effect.flatMap(({ rows }) =>
      Effect.forEach(
        rows,
        (row) =>
          Schema.decodeUnknownEffect(NoteDeliveryRow)(row).pipe(
            Effect.flatMap((decoded) =>
              identityHex(decoded.settled_by).pipe(
                Effect.map((settledBy) => ({
                  msgId: decoded.msg_id,
                  note: decoded.note,
                  delivered: decoded.delivered,
                  message: decoded.message,
                  settledBy,
                })),
              ),
            ),
          ),
        { concurrency: 1 },
      ),
    ),
    Effect.map((rows) =>
      [...rows].sort((left, right) => left.msgId - right.msgId),
    ),
  )

/** Outbox rows not yet settled; the host deletes each once it settles. */
const pendingNotes = (pair: Pair, sender: PublishedDatabase) =>
  select(pair, sender, "SELECT * FROM noteOutbox").pipe(
    Effect.map(({ rows }) => rows.length),
  )

const RefusalEnvelope = Schema.fromJsonString(
  Schema.Struct({ tag: Schema.String }),
)

/** The declared error a refusal message carries. */
const refusalTag = (message: string) =>
  Schema.decodeUnknownEffect(RefusalEnvelope)(message).pipe(
    Effect.map((envelope) => envelope.tag),
  )

const waitUntil = <A, E, R>(
  awaiting: string,
  read: Effect.Effect<A, E, R>,
  done: (value: A) => boolean,
) =>
  Effect.gen(function* () {
    let last: A | undefined
    for (let attempt = 0; attempt < pollAttemptsMax; attempt = attempt + 1) {
      last = yield* read
      if (done(last)) {
        return last
      }
      yield* Effect.sleep(pollInterval)
    }
    return yield* new IdcPairWaitExpired({ awaiting, last })
  })

const settledCount =
  (count: number) =>
  (rows: ReadonlyArray<unknown>): boolean =>
    rows.length >= count

const provide = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    NodeServices.NodeServices | HttpClient.HttpClient | Scope.Scope
  >,
) =>
  effect.pipe(
    Effect.scoped,
    Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  )

describe("inter-database calls between databases on one standalone", () => {
  live(
    "delivers a row once its transaction commits and settles it Delivered as the zero identity",
    () =>
      provide(
        Effect.gen(function* () {
          const pair = yield* startPair
          yield* sendNote(pair, pair.sender, "hello")

          const settled = yield* waitUntil(
            "the settle of the first note",
            deliveries(pair, pair.sender),
            settledCount(1),
          )
          // The host runs a settle reducer as the zero identity; the compiled
          // settle wrapper refuses any other sender, so this row exists only
          // because that held.
          expect(settled).toEqual([
            {
              msgId: 1,
              note: "hello",
              delivered: true,
              message: "",
              settledBy: zeroIdentity,
            },
          ])
          // The receiver saw the sending database's own identity.
          expect(yield* receivedNotes(pair)).toEqual([
            { sender: pair.sender.databaseIdentity, note: "hello" },
          ])
          // A settled row leaves the outbox.
          expect(yield* pendingNotes(pair, pair.sender)).toBe(0)
        }),
      ),
    testDurationMaxMs,
  )

  live(
    "settles a receiver's refusal as Refused with the declared error it failed with",
    () =>
      provide(
        Effect.gen(function* () {
          const pair = yield* startPair
          yield* sendNote(pair, pair.sender, "   ")

          const [settled] = yield* waitUntil(
            "the settle of the blank note",
            deliveries(pair, pair.sender),
            settledCount(1),
          )
          expect(settled?.delivered).toBe(false)
          expect(yield* refusalTag(settled?.message ?? "")).toBe(
            "IdcPairBlankNote",
          )
          expect(yield* receivedNotes(pair)).toEqual([])
          expect(yield* pendingNotes(pair, pair.sender)).toBe(0)
        }),
      ),
    testDurationMaxMs,
  )

  live(
    "delivers one stream in the order its rows were committed",
    () =>
      provide(
        Effect.gen(function* () {
          const pair = yield* startPair
          const notes = ["first", "second", "third", "fourth", "fifth"]
          // One reducer call after another: each commits before the next.
          yield* Effect.forEach(
            notes,
            (note) => sendNote(pair, pair.sender, note),
            { concurrency: 1, discard: true },
          )

          const settled = yield* waitUntil(
            "the settle of every note",
            deliveries(pair, pair.sender),
            settledCount(notes.length),
          )
          expect(settled.map((row) => [row.msgId, row.delivered])).toEqual(
            notes.map((_, index) => [index + 1, true]),
          )
          expect(
            (yield* receivedNotes(pair)).map((received) => received.note),
          ).toEqual(notes)
        }),
      ),
    testDurationMaxMs,
  )

  live(
    "the inbox guard refuses a database the receiver does not trust",
    () =>
      provide(
        Effect.gen(function* () {
          const pair = yield* startPair
          const intruder = yield* publishSender(
            pair.server,
            "idc-pair-intruder",
          )
          yield* sendNote(pair, intruder, "from the intruder")
          yield* sendNote(pair, pair.sender, "from the trusted sender")

          const [refused] = yield* waitUntil(
            "the settle of the intruder's note",
            deliveries(pair, intruder),
            settledCount(1),
          )
          expect(refused?.delivered).toBe(false)
          expect(yield* refusalTag(refused?.message ?? "")).toBe(
            "IdcPairUnknownSender",
          )
          yield* waitUntil(
            "the settle of the trusted note",
            deliveries(pair, pair.sender),
            settledCount(1),
          )
          expect(yield* receivedNotes(pair)).toEqual([
            {
              sender: pair.sender.databaseIdentity,
              note: "from the trusted sender",
            },
          ])
        }),
      ),
    testDurationMaxMs,
  )

  live(
    "databases reset together keep their identities and deliver on fresh streams",
    () =>
      provide(
        Effect.gen(function* () {
          const pair = yield* startPair
          yield* sendNote(pair, pair.sender, "before")
          yield* waitUntil(
            "the settle of the note before the reset",
            deliveries(pair, pair.sender),
            settledCount(1),
          )

          // A clearing publish (`--delete-data`) on both sides. Each reset
          // resupplies the stored environment, so the peers still name each
          // other.
          yield* pair.receiver.reset()
          yield* pair.sender.reset()
          expect((yield* pair.receiver.status()).databaseIdentity).toBe(
            pair.receiver.databaseIdentity,
          )
          expect((yield* pair.sender.status()).databaseIdentity).toBe(
            pair.sender.databaseIdentity,
          )
          expect(yield* receivedNotes(pair)).toEqual([])
          expect(yield* deliveries(pair, pair.sender)).toEqual([])

          // Both streams start over: the sender numbers its rows from one
          // again and the receiver has no record of the old stream.
          yield* sendNote(pair, pair.sender, "after")
          const settled = yield* waitUntil(
            "the settle of the note after the reset",
            deliveries(pair, pair.sender),
            settledCount(1),
          )
          expect(settled.map((row) => [row.msgId, row.delivered])).toEqual([
            [1, true],
          ])
          expect(yield* receivedNotes(pair)).toEqual([
            { sender: pair.sender.databaseIdentity, note: "after" },
          ])

          // Deleting a database keeps its name, so a publish under that name
          // recreates it with the same identity rather than a new one.
          yield* pair.sender.remove()
          expect((yield* pair.sender.status()).published).toBe(false)
          const recreated = yield* publishSender(
            pair.server,
            senderDatabaseName,
          )
          expect(recreated.databaseIdentity).toBe(pair.sender.databaseIdentity)
        }),
      ),
    testDurationMaxMs,
  )

  live(
    "keeps a call to a missing database in its outbox, its transport error readable by the owner",
    () =>
      provide(
        Effect.gen(function* () {
          const pair = yield* startPair
          // No database on the standalone has this identity, so the host
          // retries the delivery without end and never settles it.
          const stranded = yield* publishSender(
            pair.server,
            "idc-pair-stranded",
            "c2".repeat(32),
          )
          yield* sendNote(pair, stranded, "nowhere")

          const stream = yield* waitUntil(
            "a failed delivery attempt",
            select(pair, stranded, "SELECT * FROM st_outbound_msg"),
            ({ rows }) =>
              rows.some(
                (row) =>
                  typeof row.retry_count === "number" && row.retry_count > 0,
              ),
          )
          expect(stream.columns).toEqual(
            expect.arrayContaining(["retry_count", "last_transport_error"]),
          )
          // `last_transport_error` is an option, `[0, text]` when set.
          expect(JSON.stringify(stream.rows[0]?.last_transport_error)).toMatch(
            /No such database/u,
          )
          expect(yield* pendingNotes(pair, stranded)).toBe(1)
          expect(yield* deliveries(pair, stranded)).toEqual([])
        }),
      ),
    testDurationMaxMs,
  )
})
