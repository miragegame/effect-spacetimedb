
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const fixturesDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(fixturesDir, "..", "..", "..")

export const hostDatastoreSysPath = path.join(
  fixturesDir,
  "host-datastore-sys.ts",
)

const fileImport = (filePath: string) =>
  `${pathToFileURL(filePath).href}?t=${Date.now().toString()}`

/**
 * Bundles a SpaceTimeDB module entrypoint with the host ABI redirected to a
 * stub, then hands the loaded module to `run`.
 *
 * The bundle is the only way to exercise `spacetimedb/server` from this suite:
 * the SDK's runtime uses `using` declarations that the Vitest transform cannot
 * parse, while Bun.build handles them. Bundling under the package root also
 * keeps `effect-spacetimedb` and `spacetimedb` resolvable from the entrypoint,
 * so a fixture can compile a contract module through our own compiler.
 */
export const withHostModule = async <A>(
  options: {
    readonly label: string
    /** Either inline entry source or a path to an existing entrypoint file. */
    readonly source?: ReadonlyArray<string>
    readonly entrypoint?: string
    readonly sysModulePath?: string
  },
  run: (loaded: Record<string, unknown>) => A | Promise<A>,
): Promise<A> => {
  const workDir = path.join(
    packageRoot,
    ".tmp",
    `${options.label}-${Date.now().toString()}`,
  )
  const entrypoint = options.entrypoint ?? path.join(workDir, "entry.ts")
  const bundlePath = path.join(workDir, "bundle.js")
  const sysModulePath = options.sysModulePath ?? hostDatastoreSysPath

  await Bun.$`mkdir -p ${workDir}`.quiet()
  if (options.source !== undefined) {
    await Bun.write(entrypoint, options.source.join("\n"))
  }

  try {
    const result = await Bun.build({
      entrypoints: [entrypoint],
      format: "esm",
      target: "bun",
      plugins: [
        {
          name: "spacetime-sys-stub",
          setup(build: Bun.PluginBuilder) {
            build.onResolve({ filter: /^spacetime:sys@2\.[01]$/ }, () => ({
              path: sysModulePath,
            }))
          },
        },
      ],
    })
    if (!result.success) {
      throw new AggregateError(result.logs, `Failed to bundle ${options.label}`)
    }
    const output = result.outputs[0]
    if (output == null) {
      throw new Error(`Bun.build produced no output for ${options.label}`)
    }
    await Bun.write(bundlePath, output)

    const nativeConsole = globalThis.console
    const loaded = await (async () => {
      try {
        return (await import(fileImport(bundlePath))) as Record<string, unknown>
      } finally {
        globalThis.console = nativeConsole
      }
    })()

    return await run(loaded)
  } finally {
    await Bun.$`rm -rf ${workDir}`.quiet()
  }
}

/** Bundles an inline module entrypoint against the in-memory datastore host. */
export const withHostDatastoreModule = async <A>(
  label: string,
  source: ReadonlyArray<string>,
  run: (loaded: Record<string, unknown>) => A | Promise<A>,
): Promise<A> => withHostModule({ label, source }, run)
