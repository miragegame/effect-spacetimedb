import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type { AnyModuleSpec } from "../contract/module.ts"
import type {
  PublicViewKeys,
  ViewRowOf,
  WsViewRowOf,
} from "../module-projection.ts"
import type {
  ProjectedSubscriptionTargets,
  SubscriptionTarget,
  ViewSubscriptionTarget,
} from "../subscription-target.ts"
import { typedFromEntries } from "../utils.ts"
import type { StdbDecodeError } from "./call-errors.ts"
import type { WsConnectionState } from "./connection-state.ts"
import type { RelationHandle } from "./relation.ts"
import {
  streamTableGroupChanges,
  streamTableSnapshotSignals,
} from "./session-stream.ts"
import { WaitUntilTimeoutError } from "./wait-until.ts"
import type {
  PublicViewCache,
  ViewGroup,
  ViewGroupOptionsParam,
  ViewGroupSnapshot,
  ViewRowsOptionsParam,
  WaitUntilViewOptionsParam,
  WsStreamOptions,
} from "./websocket-contract.ts"
import type { SubscriptionFailure } from "./ws-subscription.ts"
import type { SubscriptionHandleLike } from "./ws-subscription-adapter.ts"

/**
 * A session's view reads: one view's rows, a group of views, and a wait for
 * a matching row. A view with params is subscribed through one call, its
 * arguments taken from the caller's options; its cache holds the union of
 * every call the connection subscribes.
 */
export const makeWsViewReads = <
  Module extends AnyModuleSpec,
  RelationContext,
>(options: {
  readonly connectionState: WsConnectionState
  readonly targets: ProjectedSubscriptionTargets<Module>["views"]
  readonly views: PublicViewCache<Module>
  readonly viewRelation: <Key extends PublicViewKeys<Module>>(
    key: Key,
  ) => RelationHandle<WsViewRowOf<Module["views"][Key]>, RelationContext>
  readonly subscribe: (
    target: SubscriptionTarget<Module>,
    onAppliedError?: (failure: SubscriptionFailure) => void,
  ) => Effect.Effect<SubscriptionHandleLike, SubscriptionFailure, Scope.Scope>
}) => {
  // The projected target is the target itself for a view without params and a
  // call building one for a view with them; `args` is the caller's, checked
  // against the view by the public signatures.
  const viewTarget = <Key extends PublicViewKeys<Module>>(
    key: Key,
    args: unknown,
  ): ViewSubscriptionTarget<Module, Key> => {
    const projected: unknown = options.targets[key]
    return (
      typeof projected === "function" ? projected(args) : projected
    ) as ViewSubscriptionTarget<Module, Key>
  }

  const subscribeViewTarget = <Key extends PublicViewKeys<Module>>(
    key: Key,
    args: unknown,
    onAppliedError?: (failure: SubscriptionFailure) => void,
  ) => options.subscribe(viewTarget(key, args), onAppliedError)

  const viewCallArgs = (callOptions: object | undefined): unknown =>
    callOptions !== undefined && "args" in callOptions
      ? callOptions.args
      : undefined

  /**
   * The view's cached rows on every change. For a view with params the cache
   * holds the union of every call this connection subscribes, so a reader of
   * one call's rows filters them by the columns that carry its arguments.
   */
  function streamViewRows<Key extends PublicViewKeys<Module>>(
    key: Key,
    ...[rowsOptions]: ViewRowsOptionsParam<Module, Key>
  ): Stream.Stream<
    ReadonlyArray<ViewRowOf<Module["views"][Key]>>,
    SubscriptionFailure | StdbDecodeError,
    Scope.Scope
  > {
    const read = options.views[key].toArray()
    const args = viewCallArgs(rowsOptions)
    return streamTableSnapshotSignals(
      options.connectionState,
      options.viewRelation(key),
      (onFailure) => subscribeViewTarget(key, args, onFailure),
      rowsOptions?.buffer,
    ).pipe(
      Stream.chunks,
      Stream.mapEffect(() => read),
    )
  }

  function viewGroupOf<
    const Keys extends ReadonlyArray<PublicViewKeys<Module>>,
  >(
    keys: Keys,
    argsOf: (key: Keys[number]) => unknown,
    streamOptions: WsStreamOptions | undefined,
  ): ViewGroup<Module, Keys> {
    const readSnapshot = Effect.forEach(keys, (key) =>
      options.views[key]
        .toArray()
        .pipe(Effect.map((rows) => [key, rows] as const)),
    ).pipe(
      Effect.map(
        (entries) =>
          typedFromEntries(entries) as unknown as ViewGroupSnapshot<
            Module,
            Keys
          >,
      ),
    )
    const groupSubscribe = Effect.forEach(
      keys,
      function subscribeViewWithoutFailureSink(key) {
        return subscribeViewTarget(key, argsOf(key))
      },
      { discard: true },
    )
    const changes = streamTableGroupChanges(
      options.connectionState,
      keys.map((key) => options.viewRelation(key)),
      (onFailure) =>
        Effect.forEach(
          keys,
          (key) => subscribeViewTarget(key, argsOf(key), onFailure),
          { discard: true },
        ),
      streamOptions?.buffer,
    ).pipe(
      Stream.chunks,
      Stream.mapEffect(() => readSnapshot),
    )

    return {
      keys,
      subscribe: groupSubscribe,
      readSnapshot,
      changes,
    }
  }

  /**
   * Several views, read together on every change of any of them. A view with
   * params is subscribed through one call, its arguments under its key in
   * `args`; its snapshot is its cache, the union of every call this
   * connection subscribes.
   */
  function viewGroup<const Keys extends ReadonlyArray<PublicViewKeys<Module>>>(
    keys: Keys,
    ...[groupOptions]: ViewGroupOptionsParam<Module, Keys>
  ): ViewGroup<Module, Keys> {
    const argsByKey: unknown = viewCallArgs(groupOptions)
    return viewGroupOf(
      keys,
      (key) =>
        typeof argsByKey === "object" && argsByKey !== null
          ? Reflect.get(argsByKey, key)
          : undefined,
      groupOptions,
    )
  }

  /**
   * The first rows of the view `predicate` admits. For a view with params the
   * predicate sees the cache, the union of every call this connection holds,
   * not only the call `args` names.
   */
  function waitUntilView<Key extends PublicViewKeys<Module>>(
    key: Key,
    predicate: (row: ViewRowOf<Module["views"][Key]>) => boolean,
    ...[waitOptions]: WaitUntilViewOptionsParam<Module, Key>
  ): Effect.Effect<
    ReadonlyArray<ViewRowOf<Module["views"][Key]>>,
    SubscriptionFailure | StdbDecodeError | WaitUntilTimeoutError,
    Scope.Scope
  > {
    let snapshotSizeLast = 0
    const timeout = waitOptions?.timeout ?? "10 seconds"
    const args = viewCallArgs(waitOptions)
    const matching = viewGroupOf(
      [key] as const,
      () => args,
      undefined,
    ).changes.pipe(
      Stream.map((snapshot) => snapshot[key]),
      Stream.map((rows) => {
        snapshotSizeLast = rows.length
        return rows.filter(predicate)
      }),
      Stream.filter((rows) => rows.length > 0),
      Stream.runHead,
      Effect.flatMap((rows) =>
        rows.pipe(
          Match.value,
          Match.when({ _tag: "Some" }, (some) => Effect.succeed(some.value)),
          Match.orElse(() =>
            Effect.fail(
              new WaitUntilTimeoutError({
                table: key,
                timeoutMillis: Duration.toMillis(timeout),
                snapshotSizeLast,
              }),
            ),
          ),
        ),
      ),
    )
    return matching.pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () =>
          Effect.fail(
            new WaitUntilTimeoutError({
              table: key,
              timeoutMillis: Duration.toMillis(timeout),
              snapshotSizeLast,
            }),
          ),
      }),
    )
  }

  return { streamViewRows, viewGroup, waitUntilView }
}
