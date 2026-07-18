import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { FullModule } from "../fixtures/full-module"
import { TestLayer } from "../helpers/test-layer"

const { expect } = EffectVitest
const describe = EffectVitest.layer(TestLayer)

describe("module reflection", (it) => {
  it.effect("walks every module section with group metadata", () => {
    const visited: Array<{
      readonly kind: string
      readonly name: string
      readonly groupId: string | undefined
    }> = []
    const collect = (entry: {
      readonly kind: string
      readonly name: string
      readonly groupId: string | undefined
    }): void => {
      visited.push(entry)
    }

    Stdb.reflect(FullModule, {
      onTable: collect,
      onView: collect,
      onReducer: collect,
      onProcedure: collect,
      onHttpHandler: collect,
      onLifecycle: collect,
    })

    expect(visited).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "table",
          name: "user",
          groupId: undefined,
        }),
        expect.objectContaining({
          kind: "view",
          name: "allUsers",
          groupId: undefined,
        }),
        expect.objectContaining({
          kind: "reducer",
          name: "userUpsert",
          groupId: "FullCallables",
        }),
        expect.objectContaining({
          kind: "procedure",
          name: "userGet",
          groupId: "FullCallables",
        }),
        expect.objectContaining({
          kind: "httpHandler",
          name: "rotateToken",
          groupId: "FullHttp",
        }),
        expect.objectContaining({
          kind: "lifecycle",
          name: "init",
          groupId: undefined,
        }),
      ]),
    )

    return Effect.void
  })

  it.effect("filters callbacks through the optional predicate", () => {
    const visited: Array<string> = []
    Stdb.reflect(FullModule, {
      predicate: (entry) => entry.kind === "reducer",
      onReducer: ({ name }) => {
        visited.push(name)
      },
      onProcedure: ({ name }) => {
        visited.push(name)
      },
    })

    expect(visited).toEqual(["userRequire", "userUpsert"])
    return Effect.void
  })
})
