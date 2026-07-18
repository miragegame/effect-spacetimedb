import * as EffectVitest from "@effect/vitest"
import * as Stdb from "effect-spacetimedb"
import { define } from "../../src/contract/module.ts"

const { describe, expect, it } = EffectVitest

describe("module group metadata", () => {
  it("assembles sorted reducer, procedure, and HTTP group records", () => {
    const Zeta = Stdb.StdbGroup.make("Zeta")
      .add(Stdb.StdbFn.reducer("zetaReducer", {}))
      .add(Stdb.StdbFn.procedure("alphaProcedure", { returns: Stdb.unit() }))
    const Alpha = Stdb.StdbGroup.make("Alpha")
      .add(Stdb.StdbFn.reducer("alphaReducer", {}))
      .add(Stdb.StdbFn.procedure("zetaProcedure", { returns: Stdb.unit() }))
    const Http = Stdb.StdbHttpGroup.make("Http").add(
      Stdb.StdbHttp.post("middleHandler", "/middle"),
    )
    const module = Stdb.StdbModule.make("sorted_groups", {}).add(
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
    const ping = Stdb.StdbFn.reducer("ping", {}).spec
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
