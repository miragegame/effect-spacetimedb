import * as EffectVitest from "@effect/vitest"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import { schema } from "../helpers/spacetimedb-server.ts"
import { assertMountSchema } from "../../src/server/host-abi-compiler.ts"

type CapturedSchema = {
  readonly schemaEntries: Readonly<
    Record<
      string,
      {
        readonly name: string
        readonly module: {
          readonly default: unknown
          readonly ModuleExports?: unknown
        }
      }
    >
  >
}
const { describe, expect, it } = EffectVitest

describe("mount lowering", () => {
  it("compiles fresh child schemas and passes both namespace entries to the parent's schema call", () => {
    const native = { default: schema({}) }
    const lib = Stdb.Module.make("library").addTables(
      Stdb.table("item", { columns: { id: Stdb.u32() } }),
    )
    const app = Stdb.Module.make("consumer")
      .mountNative<typeof native>()("sdk")
      .mount("myLib", lib, { name: "stable" })
    const live = [
      Stdb.Builder.mount(app, "myLib", {
        module: lib,
        implementations: [],
      }),
      Stdb.Builder.mountNative(app, "sdk", native),
    ] as const
    const compile = () =>
      (build(app, live).schema as CapturedSchema).schemaEntries
    const first = compile()
    expect(first.sdk).toBe(native)
    expect(first.myLib).toMatchObject({
      name: "stable",
      module: {
        ModuleExports: expect.anything(),
        default: { schemaEntries: { item: expect.anything() } },
      },
    })
    expect(compile().myLib?.module.default).not.toBe(
      first.myLib?.module.default,
    )
  })
  it("rejects reusing a native schema via another namespace object", () => {
    const native = { default: schema({}) }
    const root = Stdb.Module.make("consumer")
      .mountNative<typeof native>()("first")
      .mountNative<typeof native>()("second")
    expect(() =>
      build(root, [
        Stdb.Builder.mountNative(root, "first", native),
        Stdb.Builder.mountNative(root, "second", { ...native }),
      ]),
    ).toThrow(/DuplicateMountedModule/)
  })
  it("distinguishes a duplicate SDK from a changed dispatch ABI", () => {
    class SchemaCopy {}
    const same = new SchemaCopy()
    expect(() => assertMountSchema("files", {}, same)).toThrow(
      /same spacetimedb\/server SDK copy/,
    )
    expect(() => assertMountSchema("files", same, same)).toThrow(
      /Schema.buildSubmoduleDispatch/,
    )
  })
})
