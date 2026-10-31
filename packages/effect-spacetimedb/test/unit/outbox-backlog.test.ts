import * as EffectVitest from "@effect/vitest"
import { outboxBacklog } from "effect-spacetimedb/server"
import { Identity, Timestamp } from "spacetimedb"

const { describe, expect, it } = EffectVitest

const at = (millis: bigint) => new Timestamp(millis * 1_000n)

const alpha = new Identity(0xa1n)
const beta = new Identity(0xb2n)

describe("outbox backlog", () => {
  it("reports each target's pending count and oldest row age", () => {
    const backlog = outboxBacklog(
      [
        { target: beta, enqueuedAt: at(9_000n) },
        { target: alpha, enqueuedAt: at(4_000n) },
        { target: beta, enqueuedAt: at(2_500n) },
        { target: alpha, enqueuedAt: at(7_000n) },
        { target: beta, enqueuedAt: at(3_000n) },
      ],
      at(10_000n),
    )

    expect(backlog).toEqual([
      {
        target: alpha.toHexString(),
        pendingCount: 2,
        oldestEnqueuedAt: at(4_000n),
        oldestAgeMs: 6_000,
      },
      {
        target: beta.toHexString(),
        pendingCount: 3,
        oldestEnqueuedAt: at(2_500n),
        oldestAgeMs: 7_500,
      },
    ])
  })

  it("is empty when nothing waits, and never reports a negative age", () => {
    expect(outboxBacklog([], at(10_000n))).toEqual([])
    expect(
      outboxBacklog([{ target: alpha, enqueuedAt: at(12_000n) }], at(10_000n)),
    ).toEqual([
      {
        target: alpha.toHexString(),
        pendingCount: 1,
        oldestEnqueuedAt: at(12_000n),
        oldestAgeMs: 0,
      },
    ])
  })
})
