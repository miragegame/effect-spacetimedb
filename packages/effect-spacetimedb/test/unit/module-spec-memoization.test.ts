import * as EffectVitest from "@effect/vitest"
import * as Stdb from "effect-spacetimedb"

const { describe, expect, it } = EffectVitest

/*
 * `module.spec` used to re-assemble the whole spec on every property read, so
 * routing code that reads `module.spec.procedureGroups` once per request paid
 * an O(module size) walk per request — ~32ms on a platform-sized module, which
 * dominated in-process request latency and the component test tier's wall
 * clock. These cases pin the memo and the two things it must not change:
 * builder immutability and the visibility of assembly failures.
 */
describe("module spec memoization", () => {
  const makeModule = () =>
    Stdb.StdbModule.make("spec_memo", {}).add(
      Stdb.StdbGroup.make("Group")
        .add(Stdb.StdbFn.reducer("someReducer", {}))
        .add(Stdb.StdbFn.procedure("someProcedure", { returns: Stdb.unit() })),
    )

  it("returns the identical spec object across repeated reads", () => {
    const module = makeModule()

    const first = module.spec
    const second = module.spec

    expect(second).toBe(first)
    expect(module.spec.reducerGroups).toBe(first.reducerGroups)
  })

  it("gives each builder result its own spec", () => {
    const base = makeModule()
    const baseSpec = base.spec
    const extended = base.add(
      Stdb.StdbGroup.make("Later").add(Stdb.StdbFn.reducer("laterReducer", {})),
    )

    // The memo must live per module instance: deriving a new module from an
    // already-read one must not hand back the parent's spec.
    expect(extended.spec).not.toBe(baseSpec)
    expect(Object.keys(baseSpec.reducers)).toEqual(["someReducer"])
    expect(Object.keys(extended.spec.reducers)).toEqual([
      "laterReducer",
      "someReducer",
    ])
    // Reading the derived module must not disturb the parent's memo either.
    expect(base.spec).toBe(baseSpec)
  })

  it("re-throws assembly failures on every read instead of caching them", () => {
    const duplicated = Stdb.StdbModule.make("spec_memo_duplicate", {}).add(
      Stdb.StdbGroup.make("First").add(Stdb.StdbFn.reducer("collide", {})),
      Stdb.StdbGroup.make("Second").add(Stdb.StdbFn.reducer("collide", {})),
    )

    expect(() => duplicated.spec).toThrow()
    // A caller that catches the first failure and reads again must see the same
    // error, not a half-built or silently-empty memo.
    expect(() => duplicated.spec).toThrow()
  })
})
