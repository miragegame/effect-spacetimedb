import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as EffectVitest from "@effect/vitest"
import { withHostModule } from "./fixtures/host-module-bundle"
import type { OutboxRegistrationProbe } from "./fixtures/outbox-registration-entry"

const { describe, expect, it } = EffectVitest

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
)

const spacetimeSysStub = path.resolve(
  fixturesDir,
  "..",
  "..",
  "..",
  "src",
  "testing",
  "spacetime-sys.ts",
)

describe("outbox registration against a generated receiver binding", () => {
  it("compiles outboxes, settle reducers and pinned receiver names through the SDK", async () => {
    const observed = await withHostModule(
      {
        label: "outbox-registration",
        entrypoint: path.join(fixturesDir, "outbox-registration-entry.ts"),
        sysModulePath: spacetimeSysStub,
      },
      (loaded) => (loaded.probe as () => OutboxRegistrationProbe)(),
    )

    // Each outbox carries its receiver's wire name and the binding's signature
    // hash, and names its settle reducer.
    const byTable = new Map(
      observed.outboxes.map((outbox) => [outbox.tableName, outbox]),
    )
    expect(byTable.get("pingOutbox")).toMatchObject({
      remoteReducer: "receive_ping",
      signatureHash: observed.bindingReducers.receivePing?.signatureHash,
      onResultReducer: "ping_settled",
    })
    expect(byTable.get("detailsOutbox")).toMatchObject({
      remoteReducer: "receive_details",
      signatureHash: observed.bindingReducers.receiveDetails?.signatureHash,
      onResultReducer: "details_settled",
    })
    expect(observed.senderReducerNames).toEqual(
      expect.arrayContaining(["ping_settled", "details_settled"]),
    )

    // Receivers register under their pinned wire names, the names the binding
    // calls them by.
    expect(observed.bindingReducers.receivePing?.name).toBe("receive_ping")
    expect(observed.receiverReducerNames).toEqual(
      expect.arrayContaining(["receive_ping", "receive_details"]),
    )
    expect(observed.receiverFunctionNames).toEqual(
      expect.arrayContaining([
        { sourceName: "receive_ping", canonicalName: "receive_ping" },
        { sourceName: "receive_details", canonicalName: "receive_details" },
      ]),
    )

    // The SDK serializes the rows our insert handle produces, including the
    // binding's own variant names, and our bound matches its byte count.
    expect(observed.rowSizes.map((size) => size.table)).toEqual([
      "pingOutbox",
      "detailsOutbox",
    ])
    for (const size of observed.rowSizes) {
      expect(size.computedBytes).toBe(size.nativeBytes)
    }
  })
})
