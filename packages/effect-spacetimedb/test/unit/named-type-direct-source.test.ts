import * as EffectVitest from "@effect/vitest"
import * as SpacetimeDB from "spacetimedb"
import { typeBuilderWithFactories } from "../../src/contract/type/builder-lowering.ts"
import { struct } from "../../src/contract/type/constructors.ts"
import { string } from "../../src/contract/type/primitives.ts"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

describe("named value types from direct source imports", (it) => {
  it("names a value without loading a package barrel", () => {
    const Named = struct({ id: string() }).named("DirectSourceNamed")
    const builder = typeBuilderWithFactories(Named, SpacetimeDB.t as never)

    expect(Reflect.get(builder, "typeName")).toBe("DirectSourceNamed")
  })
})
