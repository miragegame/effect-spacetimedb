import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as EffectVitest from "@effect/vitest"
import { withHostModule } from "./fixtures/host-module-bundle"

const { describe, expect, it } = EffectVitest

const entrypoint = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "environment-declarations-entry.ts",
)

const spacetimeSysStub = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "testing",
  "spacetime-sys.ts",
)

describe("environment declarations through the native SDK", () => {
  it("lowers every declaration kind to the module definition the host validates", async () => {
    const observed = await withHostModule(
      {
        label: "environment-declarations",
        entrypoint,
        sysModulePath: spacetimeSysStub,
      },
      (loaded) =>
        (
          loaded.probe as () => {
            readonly fixture: unknown
            readonly pinned: unknown
            readonly colliding: unknown
          }
        )(),
    )

    expect(observed.fixture).toEqual([
      { name: "GREETING", ty: { tag: "String" }, optional: false },
      { name: "API_KEY", ty: { tag: "String" }, optional: false },
      {
        name: "MODE",
        ty: { tag: "Union", value: ["development", "production"] },
        optional: false,
      },
      { name: "REGION", ty: { tag: "String" }, optional: true },
    ])
    expect(observed.pinned).toEqual([
      {
        name: "PINNED",
        ty: { tag: "StringLiteral", value: "only" },
        optional: false,
      },
    ])
    expect(observed.colliding).toEqual([
      {
        name: "LIFECYCLE",
        ty: { tag: "Union", value: ["create", "update"] },
        optional: false,
      },
      {
        name: "REQUIREDNESS",
        ty: { tag: "Union", value: ["optional", "required"] },
        optional: true,
      },
      {
        name: "PROTOTYPE",
        ty: { tag: "StringLiteral", value: "__proto__" },
        optional: false,
      },
      {
        name: "MEMBERS",
        ty: {
          tag: "Union",
          value: [
            "constructor",
            "toString",
            "default",
            "name",
            "primaryKey",
            "algebraicType",
            "variants",
          ],
        },
        optional: false,
      },
    ])
  })
})
