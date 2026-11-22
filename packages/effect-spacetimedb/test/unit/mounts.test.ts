import * as StdbInternal from "effect-spacetimedb/testing/internal"
import * as EffectVitest from "@effect/vitest"
import * as Stdb from "effect-spacetimedb"
import { makeModulePlan } from "effect-spacetimedb/testing/internal"
import { IdcFixtureInbox } from "../fixtures/idc/inbox.ts"
import { Library } from "../../examples/mounted-module/contract.ts"

const parent = Stdb.Module.make("root")
const child = Stdb.Module.make("child")
const columns = { id: Stdb.u32().primaryKey() }
const table = Stdb.table("myValue", { public: true, columns })
const httpGroup = Stdb.HttpGroup.make("web").add(
  Stdb.Http.get("getHealth", "/health"),
)

const { describe, expect, it } = EffectVitest

describe("mount declarations", () => {
  it.each([
    "snake_case",
    "2abc",
    "",
    "x".repeat(64),
    "st",
    "spacetimedb",
    "public",
    "pgReserved",
  ])("rejects namespace %s", (name) => {
    expect(() => parent.mount(name, child).spec).toThrow(
      /InvalidMountNamespace/,
    )
  })
  it.each(["bad.name", "pg_catalog", "st", "public", "n".repeat(64)])(
    "rejects pinned namespace %s",
    (name) => {
      expect(() => parent.mount("ok", child, { name }).spec).toThrow(
        /InvalidMountNamespace/,
      )
    },
  )
  it("detects duplicate accessor, wire name and spec identity independently", () => {
    const first = parent.mount("one", child, { name: "pinned" })
    expect(() => first.mountNative()("one").spec).toThrow(
      /DuplicateMountNamespace/,
    )
    expect(() => first.mountNative()("two", { name: "pinned" }).spec).toThrow(
      /DuplicateMountNamespace/,
    )
    expect(() => first.mount("two", child).spec).toThrow(
      /DuplicateMountedModule/,
    )
  })
  it("rejects mounts that shadow local members and accepts separate group and session names", () => {
    const root = parent.addTables(table).add(
      httpGroup,
      Stdb.Group.make("Functions").add(
        Stdb.Fn.reducer("save", {}),
        Stdb.Fn.procedure("load", { returns: Stdb.u32() }),
        Stdb.Fn.anonymousView("items", {
          returns: Stdb.array(table.row),
        }),
      ),
    )
    for (const key of [
      "myValue",
      "save",
      "load",
      "items",
      "getHealth",
      "constructor",
    ])
      expect(() => root.mount(key, child).spec).toThrow(
        /MountNamespaceCollision/,
      )
    for (const key of ["web", "subscribe"])
      expect(root.mount(key, child).spec.mounts).toHaveProperty(key)
  })
  it("rejects root-only declarations even below another mount", () => {
    const mount = (spec: Stdb.AnyModuleSpec) =>
      Stdb.validate({
        ...parent.spec,
        mounts: {
          outer: {
            kind: "moduleMount",
            namespace: "outer",
            wireNamespace: "outer",
            module: {
              ...child.spec,
              mounts: {
                inner: {
                  kind: "moduleMount",
                  namespace: "inner",
                  wireNamespace: "inner",
                  module: spec,
                },
              },
            },
          },
        },
      })
    for (const [spec, code] of [
      [
        Stdb.Module.make("env", {
          environment: { VALUE: Stdb.Environment.string() },
        }).spec,
        "MountedEnvironment",
      ],
      [
        child.add(Stdb.Group.make("Hooks").add(Stdb.Fn.init())).spec,
        "MountedLifecycle",
      ],
      [child.add(Stdb.HttpGroup.make("empty")).spec, "MountedHttpHandler"],
      [child.add(httpGroup).spec, "MountedHttpHandler"],
      [child.add(IdcFixtureInbox).spec, "MountedReceiver"],
    ] as const)
      expect(mount(spec)).toContainEqual(
        expect.objectContaining({
          code,
          path: ["mounts", "outer", "mounts", "inner"],
        }),
      )
  })
  it("bounds depth, detects identity cycles, and re-paths the child's own diagnostics", () => {
    const one = parent.mount("one", child),
      two = parent.mount("two", one),
      three = parent.mount("three", two),
      four = parent.mount("four", three)
    expect(() => four.spec).not.toThrow()
    expect(() => parent.mount("five", four).spec).toThrow(/MountDepthExceeded/)
    const mounts: Record<string, Stdb.ModuleMount> = {}
    const cyclic = { ...parent.spec, mounts }
    mounts.loop = {
      kind: "moduleMount",
      namespace: "loop",
      wireNamespace: "loop",
      module: cyclic,
    }
    expect(Stdb.validate(cyclic)).toContainEqual(
      expect.objectContaining({ code: "MountCycle", path: ["mounts", "loop"] }),
    )
    expect(
      () =>
        parent.mount(
          "child",
          child.addTables(Stdb.table("2invalid", { columns })),
        ).spec,
    ).toThrow(/mounts.child.tables.2invalid/)
  })
  it("plans canonical paths and module-local bindings without changing the reusable child's names", () => {
    const leaf = Stdb.Module.make("leaf", {
      settings: { caseConversionPolicy: "none" },
    }).addTables(table)
    const mid = child.mount("innerLib", leaf)
    const root = parent
      .mount("myLib", mid, { name: "stable_v1" })
      .mount("jobs", Library)
    const plan = makeModulePlan(root.spec)
    expect(plan.members.tables["myLib.innerLib.myValue"]).toEqual({
      owner: leaf.spec,
      key: "myValue",
      accessorPath: ["myLib", "innerLib", "myValue"],
      wireName: "stable_v1.inner_lib.myValue",
    })
    expect(plan.members.reducers["jobs.queueItem"]?.wireName).toBe(
      "jobs.queue_item",
    )
    expect(plan.members.views["jobs.listedItems"]?.wireName).toBe(
      "jobs.listed_items",
    )
    expect(plan.members.procedures["jobs.save_item"]?.wireName).toBe(
      "jobs.save_item",
    )
    expect(makeModulePlan(root.spec)).toBe(plan)
    expect(plan.mounts.jobs?.scheduleBindings).toHaveLength(1)
    expect(plan.mounts.jobs?.outboxResultBindings).toHaveLength(1)
    expect(plan.scheduleBindings).toEqual([])
    expect(leaf.spec.wireNames.tables.myValue).toBe("myValue")
    const seen: string[] = []
    Stdb.reflect(root.spec, {
      onMount: ({ name }) => seen.push(name),
      onTable: ({ name }) => seen.push(name),
    })
    expect(seen).toEqual(["myLib", "jobs"])
  })
  it("refuses missing, duplicate, foreign and mismatched implementations before compilation", () => {
    const mod = parent.mount("ns", child)
    const impl = Stdb.Builder.mount(mod, "ns", {
      module: child,
      implementations: [],
    })
    expect(() => StdbInternal.planModule(mod, [] as never)).toThrow(
      /MountNotImplemented/,
    )
    expect(() => StdbInternal.planModule(mod, [impl, impl] as never)).toThrow(
      /DuplicateMountImpl/,
    )
    expect(() => StdbInternal.planModule(parent, [impl] as never)).toThrow(
      /UndeclaredMountImpl/,
    )
    const other = Stdb.Module.make("child")
    const mismatch = Stdb.Builder.mount(mod, "ns", {
      module: other,
      implementations: [],
    })
    expect(() => StdbInternal.planModule(mod, [mismatch])).toThrow(
      /UndeclaredMountImpl/,
    )
  })
})
