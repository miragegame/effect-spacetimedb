// lint-ignore: stdb-string-columns-require-domain, stdb-numeric-columns-require-domain - capability tests intentionally exercise raw STDB schema constructors.
import * as EffectVitest from "@effect/vitest"
import * as Stdb from "effect-spacetimedb"

const { describe, expect, it } = EffectVitest

describe("column key capabilities", () => {
  it("rejects primary keys on column types the native builder cannot express", () => {
    expect(() =>
      Stdb.struct({
        value: Stdb.u32(),
      }).primaryKey(),
    ).toThrow("A primary key is not supported")

    expect(() => Stdb.array(Stdb.u32()).primaryKey()).toThrow(
      "A primary key is not supported",
    )
  })

  it("rejects auto-increment on non-integer primary-key-capable columns", () => {
    expect(() => Stdb.string().primaryKey().autoInc()).toThrow(
      "autoInc is not supported",
    )

    expect(() => Stdb.identity().primaryKey().autoInc()).toThrow(
      "autoInc is not supported",
    )
  })

  it("keeps supported integer and simple-enum primary key declarations valid", () => {
    expect(() => Stdb.u64().primaryKey().autoInc()).not.toThrow()
    expect(() => Stdb.literal("Open", "Closed").primaryKey()).not.toThrow()
    expect(() => Stdb.enum("Open", "Closed").primaryKey()).not.toThrow()
  })

  it("rejects primary keys on payload-bearing sums", () => {
    expect(() =>
      Stdb.sum({
        Ready: Stdb.unit(),
        Count: Stdb.u32(),
      }).primaryKey(),
    ).toThrow("A primary key is not supported")
  })
})
