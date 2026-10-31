import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import * as StdbServer from "effect-spacetimedb/server"
import { Identity } from "spacetimedb"
import { IdcFixtureInboxInterface } from "../interface.ts"
import { FixturePingTooLarge, IdcSenderModule } from "./contract.ts"

const { Db, Env } = IdcSenderModule

/** The module's peer resolver: the receiving database named by its environment. */
export const resolveFixturePeer = Effect.gen(function* () {
  const env = yield* Env
  const hex = yield* env.IDC_FIXTURE_PEER
  return Stdb.RemoteInterface.peer(IdcFixtureInboxInterface, new Identity(hex))
})

// An over-size row is caller input the sender refuses, with its own error.
const refuseTooLarge = <A>(
  send: Effect.Effect<A, Stdb.OutboxRowTooLarge | StdbServer.DbFailure>,
) =>
  send.pipe(
    Effect.catchTag("OutboxRowTooLarge", (tooLarge) =>
      Effect.fail(FixturePingTooLarge.make({ rowBytes: tooLarge.rowBytes })),
    ),
  )

export const IdcSenderSendsLive = Stdb.StdbBuilder.group(
  IdcSenderModule,
  "IdcSenderSends",
  {
    sendPing: Effect.fn(function* ({ note, requestId }) {
      const target = yield* resolveFixturePeer
      const db = yield* Db
      yield* db.pingOutbox
        .insert({ target, note, requestId })
        .pipe(refuseTooLarge)
    }),
    sendDetails: Effect.fn(function* ({ body, labels }) {
      const target = yield* resolveFixturePeer
      const db = yield* Db
      yield* db.detailsOutbox
        .insert({ target, body, details: { labels, state: "ready" } })
        .pipe(refuseTooLarge)
    }),
  },
)

const outcomeText = (result: StdbServer.OutboxResult): string =>
  StdbServer.OutboxResult.$match(result, {
    Delivered: () => "delivered",
    Refused: ({ message }) => `refused: ${message}`,
  })

// A settle reducer may not fail: a failed write here is a bug in this module,
// so it dies, and the host rolls it back and still deletes the row.
const recordSettlement = (row: {
  readonly outbox: string
  readonly msgId: bigint
  readonly requestId: string
  readonly outcome: string
}) =>
  Effect.gen(function* () {
    const db = yield* Db
    yield* db.settlement.insert({ id: 0n, ...row })
  }).pipe(Effect.orDie)

export const IdcSenderSettlesLive = Stdb.StdbBuilder.group(
  IdcSenderModule,
  "IdcSenderSettles",
  {
    pingSettled: ({ row, result }) =>
      recordSettlement({
        outbox: "pingOutbox",
        msgId: row.msgId,
        requestId: row.requestId,
        outcome: outcomeText(result),
      }),
    detailsSettled: ({ row, result }) =>
      recordSettlement({
        outbox: "detailsOutbox",
        msgId: row.msgId,
        requestId: "",
        outcome: outcomeText(result),
      }),
  },
)
