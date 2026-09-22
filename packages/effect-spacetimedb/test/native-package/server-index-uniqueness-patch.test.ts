import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as EffectVitest from "@effect/vitest"

const { describe, expect, it } = EffectVitest

const fileImport = (filePath: string) =>
  `${pathToFileURL(filePath).href}?t=${Date.now().toString()}`
const spacetimePackageRoot = path.dirname(
  fileURLToPath(import.meta.resolve("spacetimedb/package.json")),
)

describe("server index uniqueness patch", () => {
  it("keeps a prefix of a composite unique constraint non-unique", async () => {
    const tempDir = path.join(
      os.tmpdir(),
      `spacetimedb-server-index-patch-${Date.now().toString()}`,
    )
    const entrypoint = path.join(tempDir, "entry.ts")
    const sysStub = path.join(tempDir, "spacetime-sys.ts")
    const bundlePath = path.join(tempDir, "bundle.js")
    const tempNodeModules = path.join(tempDir, "node_modules")
    await Bun.$`mkdir -p ${tempNodeModules}`.quiet()
    await Bun.$`ln -s ${spacetimePackageRoot} ${path.join(
      tempNodeModules,
      "spacetimedb",
    )}`.quiet()

    await Bun.write(
      sysStub,
      [
        `export const moduleHooks = Symbol.for("spacetime:sys/moduleHooks")`,
        `let pointScans = 0`,
        `let rangeScans = 0`,
        `export const resetScans = () => { pointScans = 0; rangeScans = 0 }`,
        `export const readScans = () => ({ pointScans, rangeScans })`,
        `export const register_hooks = () => undefined`,
        `export const table_id_from_name = () => 1`,
        `export const index_id_from_name = () => 1`,
        `export const datastore_table_row_count = () => 0n`,
        `export const datastore_table_scan_bsatn = () => 1`,
        `export const datastore_index_scan_range_bsatn = () => { rangeScans += 1; return 1 }`,
        `export const datastore_index_scan_point_bsatn = () => { pointScans += 1; return 1 }`,
        `export const row_iter_bsatn_advance = () => 0`,
        `export const row_iter_bsatn_close = () => undefined`,
        `export const datastore_insert_bsatn = () => undefined`,
        `export const datastore_update_bsatn = () => undefined`,
        `export const datastore_delete_by_index_scan_range_bsatn = () => 0`,
        `export const datastore_delete_by_index_scan_point_bsatn = () => 0`,
        `export const datastore_delete_all_by_eq_bsatn = () => 0`,
        `export const datastore_clear = () => undefined`,
        `export const volatile_nonatomic_schedule_immediate = () => undefined`,
        `export const console_log = () => undefined`,
        `export const console_timer_start = () => 1`,
        `export const console_timer_end = () => undefined`,
        `export const identity = () => 0n`,
        `export const get_jwt_payload = () => ""`,
        `export const procedure_http_request = () => undefined`,
        `export const procedure_start_mut_tx = () => 0n`,
        `export const procedure_commit_mut_tx = () => undefined`,
        `export const procedure_abort_mut_tx = () => undefined`,
      ].join("\n"),
    )

    await Bun.write(
      entrypoint,
      [
        `import { Range, schema, t, table } from "spacetimedb/server"`,
        `import { moduleHooks, readScans, resetScans } from "spacetime:sys@2.0"`,
        `const membership = table({`,
        `  name: "membership",`,
        `  indexes: [`,
        `    { accessor: "byTenant", name: "membership_by_tenant", algorithm: "btree", columns: ["tenant"] },`,
        `    { accessor: "byTenantEmail", name: "membership_by_tenant_email", algorithm: "btree", columns: ["tenant", "email"] },`,
        `  ],`,
        `  constraints: [`,
        `    { name: "membership_tenant_email_unique", constraint: "unique", columns: ["tenant", "email"] },`,
        `  ],`,
        `}, t.row({ tenant: t.string(), email: t.string() }))`,
        `const testSchema = schema({ membership })`,
        `let prefixIndexMethods = []`,
        `let compositeIndexMethods = []`,
        `const probeIndexes = testSchema.reducer({}, (ctx) => {`,
        `  prefixIndexMethods = Object.keys(ctx.db.membership.byTenant)`,
        `  compositeIndexMethods = Object.keys(ctx.db.membership.byTenantEmail)`,
        `  Array.from(ctx.db.membership.byTenant.filter("tenant-1"))`,
        `  Array.from(ctx.db.membership.byTenant.filter(`,
        `    new Range({ tag: "included", value: "tenant-1" }, { tag: "excluded", value: "tenant-3" }),`,
        `  ))`,
        `})`,
        `export const probe = () => {`,
        `  resetScans()`,
        `  const hooks = testSchema[moduleHooks]({ probeIndexes })`,
        `  hooks.__call_reducer__(0, 0n, 0n, 0n, new DataView(new ArrayBuffer(0)))`,
        `  return { prefixIndexMethods, compositeIndexMethods, ...readScans() }`,
        `}`,
      ].join("\n"),
    )

    try {
      const result = await Bun.build({
        entrypoints: [entrypoint],
        format: "esm",
        target: "bun",
        plugins: [
          {
            name: "spacetime-sys-stub",
            setup(build) {
              build.onResolve({ filter: /^spacetime:sys@2\.[01]$/ }, () => ({
                path: sysStub,
              }))
            },
          },
        ],
      })
      expect(result.success).toBe(true)
      const output = result.outputs[0]
      if (output == null) {
        throw new Error("Bun.build did not produce a server patch probe")
      }
      await Bun.write(bundlePath, output)

      const loaded = await (async () => {
        const nativeConsole = globalThis.console
        try {
          return await import(fileImport(bundlePath))
        } finally {
          globalThis.console = nativeConsole
        }
      })()
      const probe = loaded.probe as () => {
        readonly prefixIndexMethods: ReadonlyArray<string>
        readonly compositeIndexMethods: ReadonlyArray<string>
        readonly pointScans: number
        readonly rangeScans: number
      }
      const observed = probe()

      expect(observed.prefixIndexMethods).toContain("filter")
      expect(observed.prefixIndexMethods).not.toContain("find")
      expect(observed.compositeIndexMethods).toContain("find")
      expect(observed.compositeIndexMethods).not.toContain("filter")
      expect(observed.pointScans).toBe(1)
      // The prefix index keeps the ranged accessor, so a `Range` bound reaches
      // the runtime's range-scan path instead of being diverted to a point
      // lookup on a unique index.
      expect(observed.rangeScans).toBe(1)
    } finally {
      await Bun.$`rm -rf ${tempDir}`.quiet()
    }
  })
})
