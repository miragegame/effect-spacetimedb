import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

const userTable = Stdb.table("user", {
  public: true,
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
        expect("views" in (plan as object)).toBe(false)
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
