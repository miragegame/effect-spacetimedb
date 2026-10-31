import * as Data from "effect/Data"
import { Identity } from "spacetimedb"
import type { AnyModuleSpec } from "../contract/module.ts"
import { OutboxResult } from "../contract/outbox-result.ts"
import {
  type OutboxMetadata,
  outboxMetadataOf,
  outboxResultMetadataOf,
} from "../contract/outbox-table.ts"
import { snakeCaseName } from "../contract/canonical-name.ts"
import { structFields } from "../contract/type.ts"
import { identityKey } from "../server/host-abi-runtime.ts"
import type { ServerSenderAuth } from "../server/runtime-types.ts"
import {
  TestHarnessOutboxRemove,
  type TestModuleHarness,
} from "./module-harness.ts"

type PumpCallable = {
  readonly invoke: (ctx: unknown, args?: unknown) => unknown
}

/** The part of a module harness the pump drives. */
type IdcPumpHarness = Pick<
  TestModuleHarness<AnyModuleSpec>,
  "databaseIdentity" | typeof TestHarnessOutboxRemove
> & {
  readonly makeMutationCtx: (overrides: {
    readonly sender: Identity
    readonly senderAuth: ServerSenderAuth
  }) => unknown
  readonly outboxRows: (key: never) => ReadonlyArray<object>
}

/** A database the pump drives: its contract, its harness and its callables. */
export type IdcPumpDatabase = {
  readonly module: AnyModuleSpec
  readonly harness: IdcPumpHarness
  /** From `bindCallables`, so each call runs in a harness transaction. */
  readonly callables: Readonly<Record<string, PumpCallable>>
}

/** A call a recording receiver took instead of running a module. */
export type IdcRecordedCall = {
  readonly sender: Identity
  readonly outbox: string
  /** The receiver's wire name, as the host would call it. */
  readonly reducer: string
  readonly args: Readonly<Record<string, unknown>>
}

/**
 * A stand-in receiver for a database the test does not simulate. Each call
 * routed to `databaseIdentity` goes to `answer`, which records it in `calls`
 * and decides its outcome.
 */
export type IdcPumpRecordingReceiver = {
  readonly kind: "recording"
  readonly databaseIdentity: Identity
  readonly calls: ReadonlyArray<IdcRecordedCall>
  readonly answer: (call: IdcRecordedCall) => OutboxResult
}

export type IdcPumpReceiver = IdcPumpDatabase | IdcPumpRecordingReceiver

/** One sending database and every database its outbox rows may target. */
export type IdcPumpLink = {
  readonly sender: IdcPumpDatabase
  readonly receivers: ReadonlyArray<IdcPumpReceiver>
}

/**
 * What one delivery did. `Settled`: the receiver ran (or refused), the settle
 * reducer ran as the zero identity, and the row is gone. `ConnectionRefused`:
 * the receiver's `clientConnected` refused the caller, which the host retries
 * forever, so the row stays at the head of its stream.
 */
export type IdcDelivery = Data.TaggedEnum<{
  readonly Settled: {
    readonly outbox: string
    readonly row: Readonly<Record<string, unknown>>
    readonly result: OutboxResult
  }
  readonly ConnectionRefused: {
    readonly outbox: string
    readonly row: Readonly<Record<string, unknown>>
    readonly message: string
  }
}>

export const IdcDelivery = Data.taggedEnum<IdcDelivery>()

export type IdcPump = {
  /** Pending rows of one outbox, oldest first, optionally of one stream. */
  readonly pending: (
    outbox: string,
    target?: Identity,
  ) => ReadonlyArray<Readonly<Record<string, unknown>>>
  /**
   * Delivers the head row of one stream: the oldest row of `outbox` to
   * `target`, or the oldest row of `outbox` at all. Throws when none waits.
   */
  readonly deliverNext: (outbox: string, target?: Identity) => IdcDelivery
  /**
   * Delivers oldest-first across every outbox until none waits, at most
   * `deliveriesMax` times. Stops at a refused connection, which would refuse
   * again. Use `deliverNext` to choose an interleaving.
   */
  readonly drain: (options: {
    readonly deliveriesMax: number
  }) => ReadonlyArray<IdcDelivery>
}

/** The auth the host gives every inter-database delivery and settle. */
const deliveryAuth: ServerSenderAuth = {
  isInternal: false,
  hasJWT: false,
  jwt: null,
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

type OutboxRoute = {
  readonly key: string
  readonly sender: IdcPumpDatabase
  readonly outbox: OutboxMetadata
  readonly settleKey: string | undefined
  readonly receivers: ReadonlyMap<string, IdcPumpReceiver>
}

const receiverIdentity = (receiver: IdcPumpReceiver): Identity =>
  "kind" in receiver
    ? receiver.databaseIdentity
    : receiver.harness.databaseIdentity

const keyOf = (identity: unknown, label: string): string => {
  const key = identityKey(identity)
  if (key === undefined) {
    throw new TypeError(`${label} is not an identity`)
  }
  return key
}

const routesOf = (
  links: ReadonlyArray<IdcPumpLink>,
): ReadonlyMap<string, OutboxRoute> => {
  const routes = new Map<string, OutboxRoute>()
  for (const link of links) {
    const receivers = new Map<string, IdcPumpReceiver>()
    for (const receiver of link.receivers) {
      receivers.set(keyOf(receiverIdentity(receiver), "receiver"), receiver)
    }

    for (const [key, table] of Object.entries(link.sender.module.tables)) {
      const outbox = outboxMetadataOf(table)
      if (outbox === undefined) {
        continue
      }
      if (routes.has(key)) {
        throw new TypeError(
          `Outbox ${key} belongs to more than one linked sender; give the pump one sender per outbox name`,
        )
      }
      const settleKey = Object.entries(link.sender.module.reducers).find(
        ([, reducer]) => outboxResultMetadataOf(reducer)?.table === table,
      )?.[0]
      routes.set(key, {
        key,
        sender: link.sender,
        outbox,
        settleKey,
        receivers,
      })
    }
  }
  return routes
}

/**
 * Deterministic in-memory delivery between module harnesses, as the host's
 * inter-database actor does it: one row at a time per (outbox, target) stream,
 * oldest first; the receiver runs as the sending database with no JWT; a throw
 * is a refusal; the settle reducer runs as the zero identity and the row is
 * deleted even if the settle fails. No clocks and no retries: the test picks
 * every delivery and so every interleaving across streams.
 */
export const makeIdcPump = (options: {
  readonly links: ReadonlyArray<IdcPumpLink>
}): IdcPump => {
  const routes = routesOf(options.links)

  const routeOf = (outbox: string): OutboxRoute => {
    const route = routes.get(outbox)
    if (route === undefined) {
      throw new TypeError(`No linked sender has an outbox named ${outbox}`)
    }
    return route
  }

  const pending = (outbox: string, target?: Identity) => {
    const route = routeOf(outbox)
    // The route was built from this harness's own outbox keys.
    const rows = route.sender.harness.outboxRows(
      outbox as never,
    ) as ReadonlyArray<Readonly<Record<string, unknown>>>
    if (target === undefined) {
      return rows
    }
    const targetKey = keyOf(target, "target")
    return rows.filter((row) => identityKey(row.target) === targetKey)
  }

  const receive = (
    route: OutboxRoute,
    receiver: IdcPumpReceiver,
    row: Readonly<Record<string, unknown>>,
  ): OutboxResult | { readonly connectionRefused: string } => {
    const sender = route.sender.harness.databaseIdentity
    const wireName = snakeCaseName(route.outbox.reducer)
    const declared = route.outbox.interface.receivers[route.outbox.reducer]
    if (declared === undefined) {
      throw new TypeError(
        `Outbox ${route.key} targets ${route.outbox.reducer}, which its interface does not declare`,
      )
    }
    // The wire body is the receiver's parameters only; local columns stay.
    const args = Object.fromEntries(
      Object.keys(structFields(declared.params) ?? {}).map((name) => [
        name,
        row[name],
      ]),
    )

    if ("kind" in receiver) {
      return receiver.answer({
        sender,
        outbox: route.key,
        reducer: wireName,
        args,
      })
    }

    const ctx = receiver.harness.makeMutationCtx({
      sender,
      senderAuth: deliveryAuth,
    })
    const connected = receiver.callables.clientConnected
    if (connected !== undefined) {
      try {
        connected.invoke(ctx)
      } catch (cause) {
        return { connectionRefused: messageOf(cause) }
      }
    }

    const reducer = receiver.callables[route.outbox.reducer]
    let result: OutboxResult
    if (reducer === undefined) {
      result = OutboxResult.Refused({
        message: `No such reducer ${wireName} in the receiving database`,
      })
    } else {
      try {
        reducer.invoke(ctx, args)
        result = OutboxResult.Delivered()
      } catch (cause) {
        result = OutboxResult.Refused({ message: messageOf(cause) })
      }
    }

    receiver.callables.clientDisconnected?.invoke(ctx)
    return result
  }

  const deliverNext = (outbox: string, target?: Identity): IdcDelivery => {
    const route = routeOf(outbox)
    const row = pending(outbox, target)[0]
    if (row === undefined) {
      throw new TypeError(
        target === undefined
          ? `Outbox ${outbox} has no pending row`
          : `Outbox ${outbox} has no pending row for ${keyOf(target, "target")}`,
      )
    }
    const receiver = route.receivers.get(keyOf(row.target, "row target"))
    if (receiver === undefined) {
      throw new TypeError(
        `Outbox ${outbox} row ${String(row.msgId)} targets ${keyOf(row.target, "row target")}, which no linked receiver is`,
      )
    }

    const answer = receive(route, receiver, row)
    if ("connectionRefused" in answer) {
      return IdcDelivery.ConnectionRefused({
        outbox,
        row,
        message: answer.connectionRefused,
      })
    }

    const settle =
      route.settleKey === undefined
        ? undefined
        : route.sender.callables[route.settleKey]
    try {
      settle?.invoke(
        route.sender.harness.makeMutationCtx({
          sender: Identity.zero(),
          senderAuth: deliveryAuth,
        }),
        { row, result: answer },
      )
    } finally {
      route.sender.harness[TestHarnessOutboxRemove](outbox, row.msgId as bigint)
    }
    return IdcDelivery.Settled({ outbox, row, result: answer })
  }

  const oldestHead = () =>
    [...routes.keys()]
      .flatMap((outbox) => {
        const head = pending(outbox)[0]
        return head === undefined ? [] : [{ outbox, head }]
      })
      .sort((left, right) =>
        (left.head.msgId as bigint) < (right.head.msgId as bigint) ? -1 : 1,
      )[0]

  const drain = (drainOptions: { readonly deliveriesMax: number }) => {
    const deliveries: Array<IdcDelivery> = []
    for (let next = oldestHead(); next !== undefined; next = oldestHead()) {
      if (deliveries.length >= drainOptions.deliveriesMax) {
        throw new RangeError(
          `IdcPump.drain delivered ${drainOptions.deliveriesMax} rows and rows still wait`,
        )
      }
      const delivery = deliverNext(next.outbox)
      deliveries.push(delivery)
      if (IdcDelivery.$is("ConnectionRefused")(delivery)) {
        break
      }
    }
    return deliveries
  }

  return { pending, deliverNext, drain }
}

/**
 * A receiver that records calls to `databaseIdentity` instead of running a
 * module, answering each with `answer` (default `Delivered`).
 */
export const recording = (options: {
  readonly databaseIdentity: Identity
  readonly answer?: (call: IdcRecordedCall) => OutboxResult
}): IdcPumpRecordingReceiver => {
  const calls: Array<IdcRecordedCall> = []
  const answer = options.answer ?? (() => OutboxResult.Delivered())
  return {
    kind: "recording",
    databaseIdentity: options.databaseIdentity,
    calls,
    answer: (call) => {
      calls.push(call)
      return answer(call)
    },
  }
}
