import * as EffectVitest from "@effect/vitest"
import { TimeDuration } from "spacetimedb"
import {
  Headers,
  type ProcedureHttpRequestOptions,
} from "../../src/server/index.ts"

EffectVitest.describe("procedure HTTP types", () => {
  EffectVitest.it("models outbound timeout options and response status", () => {
    const options = {
      method: "POST",
      headers: { "X-Test": "value" },
      body: "payload",
      timeout: TimeDuration.fromMillis(5_000),
    } satisfies ProcedureHttpRequestOptions
    const fetch = (
      _url: string,
      init?: ProcedureHttpRequestOptions,
    ): {
      readonly status: number
      readonly text: () => string
      readonly json: () => unknown
      readonly bytes: () => Uint8Array
    } => ({
      status: init?.timeout === undefined ? 200 : 201,
      text: () => "",
      json: () => ({}),
      bytes: () => new Uint8Array(),
    })

    EffectVitest.expect(fetch("https://example.com", options).status).toBe(201)
  })

  EffectVitest.it(
    "accepts every body and header shape supported by the host",
    () => {
      const arrayBuffer = new ArrayBuffer(8)
      const options = [
        {
          body: arrayBuffer,
          headers: new Headers({ "X-Test": "array-buffer" }),
        },
        {
          body: new DataView(arrayBuffer),
          headers: [["X-Test", "data-view"]],
        },
        {
          body: new Uint32Array(arrayBuffer),
          headers: { "X-Test": "typed-array" },
        },
      ] satisfies ReadonlyArray<ProcedureHttpRequestOptions>

      EffectVitest.expect(options).toHaveLength(3)
    },
  )
})
