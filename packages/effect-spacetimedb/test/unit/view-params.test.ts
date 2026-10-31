/**
 * Views with params (SpacetimeDB 2.13): a client calls one as
 * `SELECT * FROM name(arg, ...)`. The contract refuses params no SQL literal
 * can carry, and the WebSocket client writes each argument as the literal the
 * host parses back against the param's type, in the params' field order.
 */
import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { ConnectionId, Identity, Uuid } from "spacetimedb"
import { testViewRowsLength } from "../helpers/array-bounds"
import { TestLayer } from "../helpers/test-layer"
import { makeStaticRelationHandle } from "../helpers/ws-fixtures"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

const Author = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(16))),
)
const Post = Stdb.struct({ id: Stdb.string(), authorId: Author })

const postsByAuthor = Stdb.StdbFn.anonymousView("postsByAuthor", {
  params: Stdb.struct({
    authorId: Author,
    published: Stdb.bool(),
    offset: Stdb.i32(),
    revision: Stdb.u64(),
    reviewer: Stdb.identity(),
    connection: Stdb.connectionId(),
    request: Stdb.uuid(),
    // A custom type travels as the type it encodes as.
    label: Stdb.custom(Schema.String, { type: Stdb.string() }),
  }),
  returns: Stdb.array(Post, testViewRowsLength),
})
const allPosts = Stdb.StdbFn.anonymousView("allPosts", {
  returns: Stdb.array(Post, testViewRowsLength),
})

const PostsModule = Stdb.StdbModule.make("view_params", {}).add(
  Stdb.StdbGroup.make("Views").add(postsByAuthor).add(allPosts),
).spec

const reviewer = Identity.fromString("ab".repeat(32))
const connection = ConnectionId.fromString("cd".repeat(16))
const request = Uuid.parse("01234567-89ab-7def-8123-456789abcdef")

const postsByAuthorArgs = {
  authorId: "o'brien\\x",
  published: true,
  offset: -3,
  revision: 18_446_744_073_709_551_615n,
  reviewer,
  connection,
  request,
  label: "tag",
}

const postsByAuthorSql = `SELECT * FROM "posts_by_author"('o''brien\\x', true, -3, 18446744073709551615, '${"ab".repeat(32)}', '${"cd".repeat(16)}', '01234567-89ab-7def-8123-456789abcdef', 'tag')`

/** A connection whose subscriptions apply at once, recording their queries. */
const recordingSession = () => {
  const queries: Array<unknown> = []
  // Completes when the first subscription reaches the builder.
  const subscribed = Deferred.makeUnsafe<void>()
  const handle: StdbTesting.NativeSubscriptionHandleLike = {
    isEnded: () => false,
    unsubscribe: () => undefined,
  }
  const builder = (): StdbTesting.SubscriptionBuilderLike<
    unknown,
    StdbTesting.ClientQueryRoot<typeof PostsModule>
  > => {
    let applied: (() => void) | undefined
    const self: StdbTesting.SubscriptionBuilderLike<
      unknown,
      StdbTesting.ClientQueryRoot<typeof PostsModule>
    > = {
      onApplied: (callback) => {
        applied = callback
        return self
      },
      onError: () => self,
      subscribe: (query) => {
        queries.push(query)
        Deferred.doneUnsafe(subscribed, Effect.void)
        queueMicrotask(() => applied?.())
        return handle
      },
    }
    return self
  }
  const session = StdbTesting.ClientWs.make({
    module: PostsModule,
    connection: {
      isActive: true,
      db: {
        postsByAuthor: makeStaticRelationHandle(),
        allPosts: makeStaticRelationHandle(),
      },
      subscriptionBuilder: builder,
    },
  })
  return { queries, session, subscribed }
}

// The validator reads a module spec's sections; the builder would refuse an
// invalid view before validation could report it, so the spec is by hand.
const asModuleSpec = (module: object): Stdb.AnyModuleSpec =>
  module as Stdb.AnyModuleSpec

const paramsOf = (fields: Stdb.StructFields): Stdb.AnyModuleSpec =>
  asModuleSpec({
    kind: "module",
    name: "view_param_kinds",
    settings: {},
    tables: {},
    views: {
      kinds: Stdb.StdbFn.anonymousView("kinds", {
        params: Stdb.struct(fields),
        returns: Stdb.array(Post, testViewRowsLength),
      }).spec,
    },
    reducers: {},
    procedures: {},
    httpHandlers: {},
    httpGroups: {},
    lifecycle: {},
    wireNames: { tables: {}, views: {}, functions: {} },
  })

EffectVitest.describe("view params validation", () => {
  EffectVitest.it("refuses a param no SQL literal can carry", () => {
    const diagnostics = Stdb.validate(
      paramsOf({
        ratio: Stdb.f64(),
        nickname: Stdb.option(Stdb.string()),
        tag: Stdb.literal("a", "b"),
        at: Stdb.timestamp(),
        weight: Stdb.custom(Schema.Finite, { type: Stdb.f64() }),
      }),
    ).filter((entry) => entry.code === "UnsupportedViewParam")

    expect(diagnostics.map((entry) => entry.path.at(-1))).toEqual([
      "ratio",
      "nickname",
      "tag",
      "at",
      "weight",
    ])
  })

  EffectVitest.it("accepts every kind a literal carries", () => {
    const diagnostics = Stdb.validate(
      paramsOf({
        name: Stdb.string(),
        flag: Stdb.bool(),
        small: Stdb.i8(),
        large: Stdb.u256(),
        owner: Stdb.identity(),
        connection: Stdb.connectionId(),
        key: Stdb.uuid(),
        label: Stdb.custom(Schema.String, { type: Stdb.string() }),
      }),
    ).filter((entry) => entry.code === "UnsupportedViewParam")

    expect(diagnostics).toEqual([])
  })
})

describe("view calls", (it) => {
  it.effect(
    "subscribes a call as SQL literals in field order beside a builder query",
    () =>
      Effect.gen(function* () {
        const { queries, session: client } = recordingSession()

        yield* client.viewGroup(["postsByAuthor", "allPosts"] as const, {
          args: { postsByAuthor: postsByAuthorArgs },
        }).subscribe

        expect(queries[0]).toBe(postsByAuthorSql)
        // A view without params keeps the typed query builder.
        expect(queries[1]).toBeTypeOf("function")
      }).pipe(Effect.scoped),
  )

  it.effect("streams one view's rows through its call", () =>
    Effect.gen(function* () {
      const { queries, session: client, subscribed } = recordingSession()

      yield* Effect.forkScoped(
        client
          .streamViewRows("postsByAuthor", { args: postsByAuthorArgs })
          .pipe(Stream.runDrain),
      )
      yield* Deferred.await(subscribed)

      expect(queries).toEqual([postsByAuthorSql])
    }).pipe(Effect.scoped),
  )

  it.effect("waits on a view's rows through its call", () =>
    Effect.gen(function* () {
      const { queries, session: client, subscribed } = recordingSession()

      yield* Effect.forkScoped(
        client.waitUntilView("postsByAuthor", () => true, {
          args: postsByAuthorArgs,
        }),
      )
      yield* Deferred.await(subscribed)

      expect(queries).toEqual([postsByAuthorSql])
    }).pipe(Effect.scoped),
  )

  it.effect("fails a call whose arguments the params refuse", () =>
    Effect.gen(function* () {
      const { queries, session: client } = recordingSession()
      const target = Stdb.project(PostsModule).targets.views.postsByAuthor({
        ...postsByAuthorArgs,
        authorId: "an-author-id-over-16",
      })

      const fiber = yield* Effect.forkScoped(client.subscribe(target))
      const exit = yield* Fiber.await(fiber)

      expect(
        Exit.isFailure(exit) &&
          Cause.findErrorOption(exit.cause).pipe(
            Option.exists(Stdb.StdbDecodeError.is),
          ),
      ).toBe(true)
      expect(queries).toEqual([])
    }).pipe(Effect.scoped),
  )
})
