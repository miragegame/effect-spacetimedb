import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import * as StdbServer from "effect-spacetimedb/server"
import { build } from "effect-spacetimedb/server-compiler"
import type { Identity } from "spacetimedb"
import { IdcFixtureInbox } from "../fixtures/idc/inbox"
import { IdcFixtureInboxInterface } from "../fixtures/idc/interface"
import idcFixtureInboxBinding from "../fixtures/idc/remote/idc_fixture_inbox/index.js"
import { IdcSenderModule, pingOutbox } from "../fixtures/idc/sender/contract"
import { IdcSenderSendsLive } from "../fixtures/idc/sender/live"
import type { Assert, ErrorOf, IsEqual } from "./helpers"

class SettleProbeError extends Data.TaggedError("SettleProbeError") {}

const { Db } = IdcSenderModule

// A settle handler reads the outbox row and its outcome, and may not fail.
const SettlesLive = Stdb.StdbBuilder.group(
  IdcSenderModule,
  "IdcSenderSettles",
  {
    pingSettled: ({ row, result }) => {
      const msgId: bigint = row.msgId
      const requestId: string = row.requestId
      const note: string = row.note
      const target: Identity = row.target
      void msgId
      void requestId
      void note
      void target
      return StdbServer.OutboxResult.$match(result, {
        Delivered: () => Effect.void,
        Refused: ({ message }) => Effect.logWarning(message),
      })
    },
    detailsSettled: () => Effect.void,
  },
)

export type SettleArgs = Assert<
  IsEqual<
    Stdb.ReducerArgsFor<typeof IdcSenderModule, "pingSettled">["result"],
    StdbServer.OutboxResult
  >
>
export type SettleErrorsAreNever = Assert<
  IsEqual<Stdb.ReducerErrorsFor<typeof IdcSenderModule, "pingSettled">, never>
>

void build(IdcSenderModule, [IdcSenderSendsLive, SettlesLive])

// @ts-expect-error a settle handler may not fail, not even with a declared error
void Stdb.StdbBuilder.group(IdcSenderModule, "IdcSenderSettles", {
  pingSettled: () => Effect.fail(new SettleProbeError()),
  detailsSettled: () => Effect.void,
})

// @ts-expect-error a failed write is a defect in a settle handler: handle it
void Stdb.StdbBuilder.group(IdcSenderModule, "IdcSenderSettles", {
  pingSettled: ({ row }) =>
    Effect.gen(function* () {
      const db = yield* Db
      yield* db.settlement.insert({
        id: 0n,
        outbox: "pingOutbox",
        msgId: row.msgId,
        requestId: row.requestId,
        outcome: "delivered",
      })
    }),
  detailsSettled: () => Effect.void,
})

// Inserts take a peer of the outbox's own interface; the handle fills the rest.
const OtherInboxInterface = Stdb.RemoteInterface.make({
  name: "other_inbox",
  group: IdcFixtureInbox,
})

// The interface carries no binding; the module entry binds one.
// @ts-expect-error a contract interface does not reach its binding
void IdcFixtureInboxInterface.binding
void Stdb.RemoteInterface.bind(OtherInboxInterface, idcFixtureInboxBinding)
declare const pingOnlyBinding: Stdb.RemoteModuleBinding & {
  readonly reducers: { readonly receivePing: Stdb.RemoteReducerBinding }
}
// @ts-expect-error the binding's declaration must name every receiver
void Stdb.RemoteInterface.bind(OtherInboxInterface, pingOnlyBinding)
// @ts-expect-error a binding with no declared receivers covers none of them
void Stdb.RemoteInterface.bind(OtherInboxInterface, {
  reducers: {},
  identity: () => undefined,
})

declare const db: StdbServer.DbService<typeof IdcSenderModule.spec>
declare const peer: Stdb.PeerIdentity<typeof IdcFixtureInboxInterface>
declare const otherPeer: Stdb.PeerIdentity<typeof OtherInboxInterface>
declare const plainIdentity: Identity

const inserted = db.pingOutbox.insert({
  target: peer,
  note: "n",
  requestId: "r",
})
export type InsertFailsOnlyWithBoundOrHost = Assert<
  IsEqual<
    ErrorOf<typeof inserted>,
    StdbServer.OutboxRowTooLarge | StdbServer.DbFailure
  >
>
// An over-size row is a typed failure the sender handles or declares.
const UndeclaredSendsModule = Stdb.StdbModule.make("undeclared_sends", {})
  .addTables(pingOutbox)
  .add(Stdb.StdbGroup.make("Sends").add(Stdb.StdbFn.reducer("send", {})))
  .add(
    Stdb.StdbGroup.make("Settles").add(
      Stdb.StdbFn.outboxResult("pingSettled", { table: pingOutbox }),
    ),
  )
// @ts-expect-error OutboxRowTooLarge is neither handled nor declared
void Stdb.StdbBuilder.group(UndeclaredSendsModule, "Sends", {
  send: () =>
    Effect.gen(function* () {
      const sendsDb = yield* UndeclaredSendsModule.Db
      yield* sendsDb.pingOutbox.insert({
        target: peer,
        note: "n",
        requestId: "r",
      })
    }),
})

// @ts-expect-error a target must be a peer minted for this interface
void db.pingOutbox.insert({ target: plainIdentity, note: "n", requestId: "r" })
// @ts-expect-error a peer of another interface is not a peer of this one
void db.pingOutbox.insert({ target: otherPeer, note: "n", requestId: "r" })
// @ts-expect-error receiver parameters are required
void db.pingOutbox.insert({ target: peer, requestId: "r" })
// @ts-expect-error an outbox row cannot be deleted
void db.pingOutbox.delete
// @ts-expect-error an outbox cannot be cleared
void db.pingOutbox.clear
// @ts-expect-error outbox lookups are read-only
void db.pingOutbox.msgId.delete

void build(
  Stdb.StdbModule.make("unsettled_outbox", {}).addTables(
    Stdb.outboxTable("unsettledOutbox", {
      interface: IdcFixtureInboxInterface,
      reducer: "receivePing",
    }),
  ),
  // @ts-expect-error an outbox needs a settle reducer before the module builds
  [],
)

// @ts-expect-error local columns cannot reuse an outbox metadata name
void Stdb.outboxTable("collidingOutbox", {
  interface: IdcFixtureInboxInterface,
  reducer: "receivePing",
  columns: { msgId: Stdb.u64() },
})

void Stdb.outboxTable("unknownReceiverOutbox", {
  interface: IdcFixtureInboxInterface,
  // @ts-expect-error an outbox targets a receiver its interface declares
  reducer: "receiveNothing",
})

// `RemoteInterfaceOf` names exactly what `make` returns, for packages that
// annotate an exported interface so their declaration emit can name it.
export type RemoteInterfaceOfNamesMake = Assert<
  IsEqual<
    Stdb.RemoteInterfaceOf<"idc_fixture_inbox", typeof IdcFixtureInbox>,
    typeof IdcFixtureInboxInterface
  >
>
