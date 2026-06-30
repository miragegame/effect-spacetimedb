import * as EffectVitest from "@effect/vitest"
import { SpacetimeSysStub, spacetimeSysAlias } from "effect-spacetimedb/testing"

const describe = EffectVitest.describe
const expect = EffectVitest.expect
const it = EffectVitest.it

const sys20CallableNames = [
  "register_hooks",
  "table_id_from_name",
  "index_id_from_name",
  "datastore_table_row_count",
  "datastore_table_scan_bsatn",
  "datastore_index_scan_range_bsatn",
  "row_iter_bsatn_advance",
  "row_iter_bsatn_close",
  "datastore_insert_bsatn",
  "datastore_update_bsatn",
  "datastore_delete_by_index_scan_range_bsatn",
  "datastore_delete_all_by_eq_bsatn",
  "volatile_nonatomic_schedule_immediate",
  "console_log",
  "console_timer_start",
  "console_timer_end",
  "identity",
  "get_jwt_payload",
  "procedure_http_request",
  "procedure_start_mut_tx",
  "procedure_commit_mut_tx",
  "procedure_abort_mut_tx",
  "datastore_index_scan_point_bsatn",
  "datastore_delete_by_index_scan_point_bsatn",
] as const

describe("spacetime sys testing stub", () => {
  it("exports callables for every imported host syscall", () => {
    expect(typeof SpacetimeSysStub.moduleHooks).toBe("symbol")
    for (const name of sys20CallableNames) {
      expect(typeof SpacetimeSysStub[name]).toBe("function")
    }
    expect(typeof SpacetimeSysStub.datastore_clear).toBe("function")
  })

  it("keeps import-time console and iterator hooks safe off-host", () => {
    expect(() => SpacetimeSysStub.row_iter_bsatn_close(1)).not.toThrow()
    expect(() => SpacetimeSysStub.console_log(2, "console smoke")).not.toThrow()
    expect(() => {
      const spanId = SpacetimeSysStub.console_timer_start("console smoke")
      SpacetimeSysStub.console_timer_end(spanId)
    }).not.toThrow()
    expect(() => SpacetimeSysStub.identity()).toThrow(/host syscall identity/)
  })

  it("scopes SpaceTimeDB-style unavailable Math.random without leaking", async () => {
    const original = Object.getOwnPropertyDescriptor(Math, "random")
    const touchingModule = new URL(
      `./fixtures/touch-math-random.ts?t=${Date.now().toString()}`,
      import.meta.url,
    )

    await expect(
      SpacetimeSysStub.withUnavailableMathRandomAsync(
        () => import(touchingModule.href),
      ),
    ).rejects.toThrow("Math.random is not available")

    expect(Object.getOwnPropertyDescriptor(Math, "random")).toEqual(original)
    expect(() => Math.random()).not.toThrow()
  })

  it("ships a spreadable Vitest alias preset", () => {
    expect(spacetimeSysAlias["spacetime:sys@2.0"]).toContain("spacetime-sys.ts")
    expect(spacetimeSysAlias["spacetime:sys@2.1"]).toBe(
      spacetimeSysAlias["spacetime:sys@2.0"],
    )
  })
})
