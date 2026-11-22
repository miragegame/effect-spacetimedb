import * as EffectVitest from "@effect/vitest"
import * as Stdb from "effect-spacetimedb"
import {
  OutboxSelfTargetDefect,
  OutboxSendOutsideMutationDefect,
  outboxBacklog,
  StdbDeclaredErrorEncodingError,
} from "effect-spacetimedb/server"
import { Timestamp } from "spacetimedb"
import { outboxResultFromHost } from "../../src/contract/outbox-result.ts"
import { hostValueBsatnBytes } from "../../src/server/outbox.ts"

const { describe, expect, it } = EffectVitest

const thrownBy = (run: () => unknown): unknown => {
  try {
    run()
    return undefined
  } catch (thrown) {
    return thrown
  }
}

const cases: ReadonlyArray<readonly [string, unknown]> = [
  [
    "OutboxSelfTargetDefect",
    new OutboxSelfTargetDefect({ table: "call", target: "abc" }),
  ],
  [
    "OutboxSendOutsideMutationDefect",
    new OutboxSendOutsideMutationDefect({ table: "call" }),
  ],
  [
    "StdbDeclaredErrorEncodingError",
    new StdbDeclaredErrorEncodingError({
      callable: "procedure",
      cause: "unencodable",
    }),
  ],
  ["OutboxResultHostValueDefect", thrownBy(() => outboxResultFromHost(1))],
  [
    "OutboxRowSizeDefect",
    thrownBy(() => hostValueBsatnBytes(Stdb.string(), 1)),
  ],
  [
    "OutboxBacklogTargetDefect",
    thrownBy(() =>
      outboxBacklog(
        [{ target: 1 as never, enqueuedAt: new Timestamp(0n) }],
        new Timestamp(0n),
      ),
    ),
  ],
]

// The host's uncaught text leaves out a `message` that is a prototype getter, so
// an error without its own would reach the module log as a bare tag.
describe("errors a module can die with", () => {
  it.each(cases)("%s has its own message", (tag, error) => {
    expect(error).toMatchObject({ _tag: tag })
    const message = Object.getOwnPropertyDescriptor(error, "message")?.value
    expect(typeof message).toBe("string")
    expect(message).not.toBe("")
  })
})
