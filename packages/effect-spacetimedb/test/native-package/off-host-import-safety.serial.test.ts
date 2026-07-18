
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as EffectVitest from "@effect/vitest"

const describe = EffectVitest.describe
const expect = EffectVitest.expect
const it = EffectVitest.it

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, "..", "..")
const exampleEntry = path.join(
  packageRoot,
  "examples",
  "publishable-module",
  "src",
  "index.ts",
)
const spacetimeSysStub = path.join(
  packageRoot,
  "src",
  "testing",
  "spacetime-sys.ts",
)

const importWithConsoleRestore = async <A>(specifier: string): Promise<A> => {
  const nativeConsole = globalThis.console
  try {
    return (await import(specifier)) as A
  } finally {
    globalThis.console = nativeConsole
  }
}

const fileImport = (filePath: string) =>
  `${pathToFileURL(filePath).href}?t=${Date.now().toString()}`

const installThrowingRandom = () => {
  Object.defineProperty(Math, "random", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: () => {
      throw new Error("Math.random not available")
    },
  })
}

const sysStubPlugin = {
  name: "spacetime-sys-stub",
  setup(build: Bun.PluginBuilder) {
    build.onResolve({ filter: /^spacetime:sys@2\.[01]$/ }, () => ({
      path: spacetimeSysStub,
    }))
  },
} satisfies Bun.BunPlugin

const buildWithSysStub = async (entrypoint: string, outfile: string) => {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    format: "esm",
    target: "bun",
    plugins: [sysStubPlugin],
  })

  if (!result.success) {
    throw new Error(
      result.logs.map((log) => log.message).join("\n") || "Bun.build failed",
    )
  }
  const output = result.outputs[0]
  if (output == null) {
    throw new Error("Bun.build did not produce output")
  }
  await Bun.write(outfile, output)
}

describe("native package import safety", () => {
  it("imports a host entry off-host with console restored", async () => {
    const randomDescriptor = Object.getOwnPropertyDescriptor(Math, "random")
    const tempDir = path.join(
      os.tmpdir(),
      `effect-spacetimedb-entry-${Date.now().toString()}`,
    )
    await Bun.$`mkdir -p ${tempDir}`.quiet()
    const bundlePath = path.join(tempDir, "entry.js")
    installThrowingRandom()
    try {
      const nativeConsole = globalThis.console
      await buildWithSysStub(exampleEntry, bundlePath)

      const module = await importWithConsoleRestore<{
        readonly default: unknown
        readonly ModuleExports: unknown
      }>(fileImport(bundlePath))

      expect(module.default).toBeDefined()
      expect(module.ModuleExports).toBeDefined()
      expect(globalThis.console).toBe(nativeConsole)
      expect(typeof globalThis.console.dir).toBe("function")
      expect(() => {
        console.log("console smoke")
        console.time("console smoke")
        console.timeEnd("console smoke")
      }).not.toThrow()
      expect(() => Math.random()).not.toThrow()
    } finally {
      if (randomDescriptor != null) {
        Object.defineProperty(Math, "random", randomDescriptor)
      }
      await Bun.$`rm -rf ${tempDir}`.quiet()
    }
  })

  it("keeps root and client bundles free of host-only compiler imports", async () => {
    const result = await Bun.build({
      entrypoints: [
        path.join(packageRoot, "src", "index.ts"),
        path.join(packageRoot, "src", "client", "index.ts"),
      ],
      format: "esm",
      target: "bun",
      external: ["spacetime:sys@2.0", "spacetime:sys@2.1"],
    })

    expect(result.success).toBe(true)
    for (const output of result.outputs) {
      const text = await output.text()
      expect(text).not.toContain("spacetime:sys")
      expect(text).not.toContain("server-compiler")
    }
  })

  it("keeps the root named-type hook active in bundled imports", async () => {
    const tempDir = path.join(
      packageRoot,
      "node_modules",
      ".cache",
      `effect-spacetimedb-root-named-${Date.now().toString()}`,
    )
    await Bun.$`mkdir -p ${tempDir}`.quiet()
    const entrypoint = path.join(tempDir, "entry.ts")
    const bundlePath = path.join(tempDir, "entry.js")
    await Bun.write(
      entrypoint,
      [
        `import * as Stdb from "effect-spacetimedb"`,
        `export const Named = Stdb.struct({ id: Stdb.string() }).named("RootNamed")`,
      ].join("\n"),
    )

    try {
      await buildWithSysStub(entrypoint, bundlePath)
      const module = await importWithConsoleRestore<{
        readonly Named: unknown
      }>(fileImport(bundlePath))

      expect(module.Named).toBeDefined()
    } finally {
      await Bun.$`rm -rf ${tempDir}`.quiet()
    }
  })

  it("keeps server-polyfills active in a bundled side-effect import", async () => {
    const randomDescriptor = Object.getOwnPropertyDescriptor(Math, "random")
    const tempDir = path.join(
      os.tmpdir(),
      `effect-spacetimedb-polyfills-${Date.now().toString()}`,
    )
    await Bun.$`mkdir -p ${tempDir}`.quiet()
    const entryPath = path.join(tempDir, "entry.ts")
    const bundlePath = path.join(tempDir, "bundle.js")
    const tempNodeModules = path.join(tempDir, "node_modules")
    await Bun.$`mkdir -p ${tempNodeModules}`.quiet()
    await Bun.$`ln -s ${packageRoot} ${path.join(
      tempDir,
      "node_modules",
      "effect-spacetimedb",
    )}`.quiet()
    await Bun.write(
      entryPath,
      [
        'import "effect-spacetimedb/server-polyfills"',
        "export const randomValue = () => Math.random()",
      ].join("\n"),
    )

    const result = await Bun.build({
      entrypoints: [entryPath],
      format: "esm",
      target: "bun",
    })

    expect(result.success).toBe(true)
    const output = result.outputs[0]
    expect(output).toBeDefined()
    if (output == null) {
      return
    }
    await Bun.write(bundlePath, output)
    const bundle = await Bun.file(bundlePath).text()
    expect(bundle).toContain("mulberry32")

    try {
      installThrowingRandom()
      const module = await importWithConsoleRestore<{
        readonly randomValue: () => number
      }>(fileImport(bundlePath))
      expect(() => module.randomValue()).not.toThrow()
    } finally {
      if (randomDescriptor != null) {
        Object.defineProperty(Math, "random", randomDescriptor)
      }
      await Bun.$`rm -rf ${tempDir}`.quiet()
    }
  })

  it("keeps server-compiler absorbing server polyfills in a bundled side-effect import", async () => {
    const randomDescriptor = Object.getOwnPropertyDescriptor(Math, "random")
    const tempDir = path.join(
      os.tmpdir(),
      `effect-spacetimedb-server-compiler-polyfills-${Date.now().toString()}`,
    )
    await Bun.$`mkdir -p ${tempDir}`.quiet()
    const entryPath = path.join(tempDir, "entry.ts")
    const bundlePath = path.join(tempDir, "bundle.js")
    const tempNodeModules = path.join(tempDir, "node_modules")
    await Bun.$`mkdir -p ${tempNodeModules}`.quiet()
    await Bun.$`ln -s ${packageRoot} ${path.join(
      tempDir,
      "node_modules",
      "effect-spacetimedb",
    )}`.quiet()
    await Bun.write(
      entryPath,
      [
        'import "effect-spacetimedb/server-compiler"',
        'export const randomDescriptor = () => Object.getOwnPropertyDescriptor(Math, "random")',
        "export const randomValue = () => Math.random()",
      ].join("\n"),
    )

    const result = await Bun.build({
      entrypoints: [entryPath],
      format: "esm",
      target: "bun",
      plugins: [sysStubPlugin],
    })

    expect(result.success).toBe(true)
    const output = result.outputs[0]
    expect(output).toBeDefined()
    if (output == null) {
      return
    }
    await Bun.write(bundlePath, output)
    const bundle = await Bun.file(bundlePath).text()
    expect(bundle).toContain("mulberry32")

    try {
      installThrowingRandom()
      const throwingDescriptor = Object.getOwnPropertyDescriptor(Math, "random")
      const module = await importWithConsoleRestore<{
        readonly randomDescriptor: () => PropertyDescriptor | undefined
        readonly randomValue: () => number
      }>(fileImport(bundlePath))
      const patchedDescriptor = module.randomDescriptor()

      expect(patchedDescriptor?.configurable).toBe(true)
      expect(patchedDescriptor?.enumerable).toBe(false)
      expect(patchedDescriptor?.writable).toBe(true)
      expect(patchedDescriptor?.value).not.toBe(throwingDescriptor?.value)
      expect(() => module.randomValue()).not.toThrow()
    } finally {
      if (randomDescriptor != null) {
        Object.defineProperty(Math, "random", randomDescriptor)
      }
      await Bun.$`rm -rf ${tempDir}`.quiet()
    }
  })
})
