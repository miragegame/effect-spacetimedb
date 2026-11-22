import { wrapHttp } from "../../src/server/services.ts"
import type { ProcedureHttpRequestOptions } from "effect-spacetimedb/server"
import * as Effect from "effect/Effect"
import * as Duration from "effect/Duration"
import * as EffectVitest from "@effect/vitest"
import {
  Headers,
  type RawProcedureHttp,
} from "effect-spacetimedb/testing/internal"

EffectVitest.describe("procedure HTTP types", () => {
  EffectVitest.it.effect(
    "forwards the deadline to the host in microseconds",
    () =>
      Effect.gen(function* () {
        const deadlines: Array<bigint | undefined> = []
        const http = wrapHttp({
          fetch: (_url, init) => {
            deadlines.push(init?.timeout?.micros)
            return {
              status: 201,
              text: () => "",
              json: () => ({}),
              bytes: () => new Uint8Array(),
            }
          },
        } satisfies RawProcedureHttp)
        const response = yield* http.fetch("https://example.com", {
          timeout: "1500 micros",
        })
        yield* http.fetch("https://example.com", { timeout: Duration.infinity })
        EffectVitest.expect(response.status).toBe(201)
        EffectVitest.expect(deadlines).toEqual([1500n, undefined])
      }),
  )

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
