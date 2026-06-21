# Client Subscription Model: Native Query Sets and Stream Failure Propagation

Design rationale for the client subscription layer (`session-stream.ts`,
`ws-client.ts`, and `ws-subscription-adapter.ts`). The wrapper intentionally
matches the native SpacetimeDB TypeScript SDK: every subscribe call opens one
native subscription query set on the underlying connection.

## Native subscription behavior

Each typed subscription entrypoint resolves to a native SDK query source and
calls the adapter in `src/client/ws-subscription-adapter.ts`. The adapter builds
one native `connection.subscriptionBuilder()`, registers `onApplied` and
`onError`, then calls `subscribe(query)`. The typed client wraps the returned
native handle in a scoped finalizer that calls `unsubscribe()` when the Effect
scope closes; the adapter's own canceler covers interruption before apply.

This means:

- `session.subscribe(target)` opens one native subscription for that target.
- `tableGroup(keys).subscribe` opens one native subscription per table key.
- `streamTable`, `streamRows`, `streamTableWithContext`,
  `streamTableEvents`, and `streamEventTable` each open the subscription they
  need for that stream.
- `allPublicTables()` remains one native multi-query subscription.
- The wrapper does not add query-key APIs or client-side deduplication on top
  of the native SDK.

If two consumers subscribe to the same table or event table, they own two
native query sets. This is the native SDK model and the wrapper does not hide
that cost or change delivery semantics.

## Event tables

Event tables remain fully supported through projected targets and
`streamEventTable(key)`. They use native delivery semantics: an event is
delivered once for each live native query set that covers it. If an application
wants exactly one event-processing path, it should subscribe once at the app
state boundary and fan out from that Effect stream or Atom.

## Persistent table cache behavior

Persistent table subscriptions populate the native connection cache. The cache
merges row coverage across live query sets, so snapshot reads through
`cache.tables[key]`, `streamRows(key)`, and `tableGroup(keys).readSnapshot`
always read the connection-owned table state rather than a wrapper-local copy.

A transaction applies atomically before callbacks fire. The native SDK merges a
transaction's table updates into the cache and then dispatches row callbacks,
so snapshot reads taken from callbacks observe the post-transaction cache.

## Stream setup failures must reach the stream

`Stream.callback`'s setup effect is forked unobserved: effect v4's
`Channel.asyncQueue` runs it via `Effect.forkIn(...)` and never inspects the
fiber's exit. A setup effect that fails - subscription rejected, connection
invalidated, transport error - fails silently unless the callback explicitly
fails the queue.

`sessionStream` therefore routes setup failures into the queue with
`Queue.failCauseUnsafe`. Interrupt causes pass through untouched
(`Cause.hasInterruptsOnly`) because normal stream teardown interrupts the
forked setup fiber and must not surface as a stream failure.

## tableGroup emission granularity

`tableGroup(keys).changes` feeds all the group's table callbacks into one queue
and emits at most one snapshot per drained batch. Because the native SDK
dispatches a server message's callbacks synchronously, a transaction's burst
lands in one drain batch under normal pacing: one transaction usually produces
one snapshot. If the consumer falls behind, several bursts coalesce into one
later snapshot.

Every emission re-reads the post-apply cache, so emissions are always
transaction-consistent and dropped queue signals converge rather than lose
state.

## Follow-ups

- If a future native SDK yields between row callbacks, tableGroup coalescing
  degrades gracefully to more, still consistent, snapshots.
