import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { generatedArtifactShapeError } from "../../src/client/generated-artifact-shape.ts"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const userTable = Stdb.table("user", {
  public: false,
  columns: {
    id: Stdb.string().primaryKey(),
    name: Stdb.string(),
  },
})

const ViewModule = Stdb.StdbModule.make("view_contract_validation", {})
  .addTables(userTable)
  .add(
    Stdb.StdbGroup.make("Views")
      .add(
        Stdb.StdbFn.anonymousView("allUsers", {
          returns: Stdb.array(
            Stdb.struct({
              id: Stdb.string(),
              name: Stdb.string(),
            }),
          ),
        }),
      )
      .add(
        Stdb.StdbFn.view("selfUser", {
          public: false,
          returns: Stdb.option(
            Stdb.struct({
              id: Stdb.string(),
              name: Stdb.string(),
            }),
          ),
        }),
      ),
  ).spec

const NonePolicyViewModule = Stdb.StdbModule.make(
  "view_contract_validation_none",
  {
    settings: { caseConversionPolicy: "none" },
  },
)
  .addTables(userTable)
  .add(
    Stdb.StdbGroup.make("Views").add(
      Stdb.StdbFn.anonymousView("allUsers", {
        returns: Stdb.array(
          Stdb.struct({
            id: Stdb.string(),
            name: Stdb.string(),
          }),
        ),
      }),
    ),
  ).spec

type ViewRowShape = { readonly id: string; readonly name: string }

const emptyViewRelation = (): StdbTesting.RelationHandle<
  ViewRowShape,
  unknown
> => ({
  onInsert: () => undefined,
  removeOnInsert: () => undefined,
  onDelete: () => undefined,
  removeOnDelete: () => undefined,
  onUpdate: () => undefined,
  removeOnUpdate: () => undefined,
  iter: () => ([] as ReadonlyArray<ViewRowShape>).values(),
  count: () => 0n,
})

const idleSubscriptionBuilder = <Root>(): StdbTesting.SubscriptionBuilderLike<
  unknown,
  Root
> => {
  const builder: StdbTesting.SubscriptionBuilderLike<unknown, Root> = {
    onApplied: () => builder,
    onError: () => builder,
    subscribe: () => ({ isEnded: () => false, unsubscribe: () => undefined }),
  }
  return builder
}

describe("view contract validation", (it) => {
  it.effect(
    "keeps the authored view surface aligned with the supported runtime shape",
    () =>
      Effect.gen(function* () {
        const plan = StdbTesting.makeModulePlan(ViewModule)

        expect("params" in ViewModule.views.allUsers).toBe(false)
        expect(ViewModule.views.allUsers.public).toBe(true)
        expect("params" in ViewModule.views.selfUser).toBe(false)
        expect(ViewModule.views.selfUser.public).toBe(false)
        expect(Object.keys(plan.publicViews)).toEqual(["allUsers"])
        expect(plan.targets.views.allUsers).toMatchObject({
          kind: "view",
          key: "allUsers",
          name: "all_users",
        })
      }),
  )

  it.effect("subscribes to and caches public view rows", () =>
    Effect.gen(function* () {
      type ViewRow = { readonly id: string; readonly name: string }
      let rows: ReadonlyArray<ViewRow> = []
      let insertCallback: ((context: unknown, row: ViewRow) => void) | undefined
      let applied: (() => void) | undefined
      let capturedQuery: unknown
      const subscribed = yield* Deferred.make<void>()
      const relation: StdbTesting.RelationHandle<ViewRow, unknown> = {
        onInsert: (callback) => {
          insertCallback = callback
        },
        removeOnInsert: (callback) => {
          if (insertCallback === callback) insertCallback = undefined
        },
        onDelete: () => undefined,
        removeOnDelete: () => undefined,
        onUpdate: () => undefined,
        removeOnUpdate: () => undefined,
        iter: () => rows.values(),
        count: () => BigInt(rows.length),
      }
      const builder: StdbTesting.SubscriptionBuilderLike<
        unknown,
        StdbTesting.ClientQueryRoot<typeof ViewModule>
      > = {
        onApplied: (callback) => {
          applied = callback
          return builder
        },
        onError: () => builder,
        subscribe: (query) => {
          capturedQuery = query
          Deferred.doneUnsafe(subscribed, Effect.void)
          return { isEnded: () => false, unsubscribe: () => undefined }
        },
      }
      const db = Object.assign(Object.create(null), { allUsers: relation })
      expect(
        generatedArtifactShapeError(StdbTesting.makeModulePlan(ViewModule), {
          db,
          disconnect: () => undefined,
          subscriptionBuilder: () => builder,
        }),
      ).toBeUndefined()
      const session = StdbTesting.ClientWs.make({
        module: ViewModule,
        connection: {
          isActive: true,
          db,
          subscriptionBuilder: () => builder,
        },
      })

      expect(yield* session.cache.views.allUsers.toArray()).toEqual([])
      const waiting = yield* session
        .waitUntilView("allUsers", (row) => row.id === "user-1")
        .pipe(Effect.forkScoped)
      yield* Deferred.await(subscribed)

      expect(capturedQuery).toBeTypeOf("function")
      if (typeof capturedQuery !== "function") return
      const nativeRelation = {}
      expect(capturedQuery({ allUsers: nativeRelation })).toBe(nativeRelation)
      applied?.()
      const row = { id: "user-1", name: "Ada" }
      rows = [row]
      insertCallback?.(undefined, row)

      expect(yield* Fiber.join(waiting)).toEqual([row])
      expect(
        yield* session.viewGroup(["allUsers"] as const).readSnapshot,
      ).toEqual({ allUsers: [row] })
      expect(session.cache.views.allUsers.count()).toBe(1n)
    }).pipe(Effect.scoped),
  )

  it.effect(
    "accepts a client keyed by contract key whatever the module name policy",
    () =>
      Effect.gen(function* () {
        const snakePlan = StdbTesting.makeModulePlan(ViewModule)
        const nonePlan = StdbTesting.makeModulePlan(NonePolicyViewModule)

        // The wire name is the SQL name and follows the policy ...
        expect(snakePlan.targets.views.allUsers.name).toBe("all_users")
        expect(nonePlan.targets.views.allUsers.name).toBe("allUsers")

        // ... while the generated client is indexed by contract key regardless.
        expect(
          generatedArtifactShapeError(snakePlan, {
            db: Object.assign(Object.create(null), {
              allUsers: emptyViewRelation(),
            }),
            disconnect: () => undefined,
            subscriptionBuilder: idleSubscriptionBuilder,
          }),
        ).toBeUndefined()
        expect(
          generatedArtifactShapeError(nonePlan, {
            db: Object.assign(Object.create(null), {
              allUsers: emptyViewRelation(),
            }),
            disconnect: () => undefined,
            subscriptionBuilder: idleSubscriptionBuilder,
          }),
        ).toBeUndefined()
      }),
  )

  it.effect(
    "reports a typed artifact error when a client exposes only the deprecated snake_case view accessor",
    () =>
      Effect.gen(function* () {
        const plan = StdbTesting.makeModulePlan(ViewModule)
        const error = generatedArtifactShapeError(plan, {
          db: Object.assign(Object.create(null), {
            all_users: emptyViewRelation(),
          }),
          disconnect: () => undefined,
          subscriptionBuilder: idleSubscriptionBuilder,
        })

        expect(StdbTesting.GeneratedArtifactShapeError.is(error)).toBe(true)
        expect(error?.missingKeys).toEqual(["allUsers"])
      }),
  )

  it.effect(
    "rejects sum-backed view returns that upstream compiles incorrectly",
    () =>
      Effect.gen(function* () {
        expect(
          () =>
            Stdb.StdbModule.make("unsupported_view_shape", {}).add(
              Stdb.StdbGroup.make("Views").add(
                Stdb.StdbFn.anonymousView("presence_kind", {
                  returns: Stdb.literal("joined", "left"),
                }),
              ),
            ).spec,
        ).toThrow(
          "View presence_kind must return Type.array(Type.struct(...)) or Type.option(Type.struct(...))",
        )

        expect(
          () =>
            Stdb.StdbModule.make("unsupported_scalar_array_view", {}).add(
              Stdb.StdbGroup.make("Views").add(
                Stdb.StdbFn.anonymousView("names", {
                  returns: Stdb.array(Stdb.string()),
                }),
              ),
            ).spec,
        ).toThrow(
          "View names must return Type.array(Type.struct(...)) or Type.option(Type.struct(...))",
        )

        expect(
          () =>
            Stdb.StdbModule.make("unsupported_scalar_option_view", {}).add(
              Stdb.StdbGroup.make("Views").add(
                Stdb.StdbFn.anonymousView("maybe_name", {
                  returns: Stdb.option(Stdb.string()),
                }),
              ),
            ).spec,
        ).toThrow(
          "View maybe_name must return Type.array(Type.struct(...)) or Type.option(Type.struct(...))",
        )
      }),
  )
})
