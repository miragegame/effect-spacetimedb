import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as EffectVitest from "@effect/vitest"
import type { RecordedHttpHeader } from "./fixtures/http-request-recording-sys"
import { withHostModule } from "./fixtures/host-module-bundle"

const { describe, expect, it } = EffectVitest

const recordingSys = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "http-request-recording-sys.ts",
)

/** A SigV4 `Authorization` value: three comma-separated components. */
const sigV4Authorization =
  "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261014/us-east-1/ec2/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"

/**
 * Header values the host must receive whole. `headers-polyfill`'s
 * `headersToList` splits on every comma, so each of these once reached the
 * host as several lines.
 */
const sentHeaders: ReadonlyArray<readonly [string, string]> = [
  ["authorization", sigV4Authorization],
  ["content-type", "application/x-www-form-urlencoded; charset=utf-8"],
  ["if-modified-since", "Wed, 21 Oct 2015 07:28:00 GMT"],
  ["x-amz-date", "20261014T120000Z"],
]

const byName = (
  headers: ReadonlyArray<RecordedHttpHeader>,
): ReadonlyArray<RecordedHttpHeader> =>
  [...headers].sort((left, right) => left.name.localeCompare(right.name))

describe("server fetch header values", () => {
  it("hands the host every header value whole, commas included", async () => {
    const recorded = await withHostModule(
      {
        label: "server-fetch-header-values",
        sysModulePath: recordingSys,
        source: [
          `import { schema, t } from "spacetimedb/server"`,
          `import { moduleHooks, takeRecordedRequests } from "spacetime:sys@2.0"`,
          `const fetchSchema = schema({})`,
          `let pendingHeaders = []`,
          `const fetchWithHeaders = fetchSchema.procedure(t.unit(), (ctx) => {`,
          `  ctx.http.fetch("http://ec2.us-east-1.amazonaws.com/", {`,
          `    method: "POST",`,
          `    headers: pendingHeaders,`,
          `    body: "Action=DescribeInstances&Version=2016-11-15",`,
          `  })`,
          `  return {}`,
          `})`,
          `export const probe = (headers) => {`,
          `  pendingHeaders = headers`,
          `  const hooks = fetchSchema[moduleHooks]({ fetchWithHeaders })`,
          `  hooks.__call_procedure__(0, 0n, 0n, 0n, new Uint8Array(0))`,
          `  return takeRecordedRequests()`,
          `}`,
        ],
      },
      (loaded) =>
        (
          loaded.probe as (
            headers: ReadonlyArray<readonly [string, string]>,
          ) => ReadonlyArray<ReadonlyArray<RecordedHttpHeader>>
        )(sentHeaders),
    )

    expect(recorded).toHaveLength(1)
    expect(byName(recorded[0] ?? [])).toEqual(
      sentHeaders.map(([name, value]) => ({ name, value })),
    )
  })
})
