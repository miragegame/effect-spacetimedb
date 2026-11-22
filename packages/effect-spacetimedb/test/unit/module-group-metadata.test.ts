import * as EffectVitest from "@effect/vitest"
import * as Stdb from "effect-spacetimedb"
import { define } from "../../src/contract/module.ts"

const { describe, expect, it } = EffectVitest

describe("module group metadata", () => {
  it("assembles sorted reducer, procedure, and HTTP group records", () => {
    const Zeta = Stdb.Group.make("Zeta")
      .add(Stdb.Fn.reducer("zetaReducer", {}))
      .add(Stdb.Fn.procedure("alphaProcedure", { returns: Stdb.unit() }))
    const Alpha = Stdb.Group.make("Alpha")
      .add(Stdb.Fn.reducer("alphaReducer", {}))
      .add(Stdb.Fn.procedure("zetaProcedure", { returns: Stdb.unit() }))
    const Http = Stdb.HttpGroup.make("Http").add(
      Stdb.Http.post("middleHandler", "/middle"),
    )
    const module = Stdb.Module.make("sorted_groups", {}).add(
      Zeta,
      Alpha,
      Http,
    ).spec

    expect(module.reducerGroups).toEqual({
      alphaReducer: "Alpha",
      zetaReducer: "Zeta",
    })
    expect(module.procedureGroups).toEqual({
      alphaProcedure: "Zeta",
      zetaProcedure: "Alpha",
    })
    expect(module.httpGroups).toEqual({ middleHandler: "Http" })
    expect(Object.keys(module.reducerGroups)).toEqual([
      "alphaReducer",
      "zetaReducer",
    ])
    expect(Object.keys(module.procedureGroups)).toEqual([
      "alphaProcedure",
      "zetaProcedure",
    ])
  })

  it("defaults group records for nonempty hand-defined specs", () => {
    const ping = Stdb.Fn.reducer("ping", {}).spec
    const module = define({
      name: "hand_defined_groups",
      reducers: { ping },
    })

    expect(Object.keys(module.reducers)).toEqual(["ping"])
    expect(module.reducerGroups).toEqual({})
    expect(module.procedureGroups).toEqual({})
    expect(module.httpGroups).toEqual({})
  })
})
