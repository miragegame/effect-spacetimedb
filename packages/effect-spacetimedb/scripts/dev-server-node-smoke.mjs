// lint-ignore: prefer-effect-filesystem - Node smoke wrapper bootstraps before the Effect runtime is available.
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { delimiter, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveInstallRootNodeModules } from "./standalone-helpers.mjs"

const currentMajorNodeVersion = () =>
  Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10)

const nodeMajorVersion = (nodePath) => {
  const result = spawnSync(nodePath, ["--version"], {
    encoding: "utf8",
  })
  if (result.status !== 0) {
    return undefined
  }

  const match = result.stdout.trim().match(/^v(\d+)\./u)
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10)
}

const findModernNode = () => {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(entry, "node")
    if (!existsSync(candidate) || candidate === process.execPath) {
      continue
    }

    const major = nodeMajorVersion(candidate)
    if (major !== undefined && major >= 22) {
      return candidate
    }
  }

  return undefined
}

const requiredSpacetimeVersion = "2.5.0"

const spacetimeVersionOutput = (binary) => {
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
  })
  return result.status === 0 ? result.stdout : undefined
}

const findCompatibleSpacetimeCli = () => {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(entry, "spacetime")
    if (!existsSync(candidate)) {
      continue
    }

    const output = spacetimeVersionOutput(candidate)
    if (
      output?.includes(`spacetimedb tool version ${requiredSpacetimeVersion}`)
    ) {
      return {
        binDir: entry,
        cli: candidate,
      }
    }
  }

  return undefined
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  })
  // Throw (don't process.exit) so the caller's `finally` cleanup still runs —
  // process.exit skips finally and would leak the compiled artifact dir under
  // node_modules/.cache (a stray `effect-spacetimedb` copy that breaks tests).
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} (exit code ${result.status ?? "unknown"}).`,
    )
  }
}

const patchRelativeImports = (filePath) => {
  const source = readFileSync(filePath, "utf8")
  // The smoke emits ESM for plain Node, which requires extensions on the
  // generated SDK's relative import specifiers.
  const patched = source.replace(
    /(["'])(\.{1,2}\/[^"']+)(["'])/gu,
    (full, prefix, specifier, suffix) => {
      const extension = extname(specifier)
      if (extension.length > 0 || specifier.endsWith("/")) {
        return full
      }
      return `${prefix}${specifier}.js${suffix}`
    },
  )
  if (patched !== source) {
    writeFileSync(filePath, patched)
  }
}

const patchCompiledTree = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      patchCompiledTree(path)
      continue
    }
    if (entry.isFile() && path.endsWith(".js")) {
      patchRelativeImports(path)
    }
  }
}

if (currentMajorNodeVersion() < 22) {
  const modernNode = findModernNode()
  if (modernNode === undefined) {
    console.error("effect-spacetimedb/dev-server Node smoke requires Node 22+.")
    process.exit(1)
  }

  const result = spawnSync(
    modernNode,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      env: process.env,
      stdio: "inherit",
    },
  )
  process.exit(result.status ?? 1)
}

const compatibleSpacetimeCli = findCompatibleSpacetimeCli()
if (compatibleSpacetimeCli === undefined) {
  console.error(
    `effect-spacetimedb/dev-server Node smoke requires spacetime ${requiredSpacetimeVersion} on PATH.`,
  )
  process.exit(1)
}

process.env.SPACETIME_CLI_BIN = compatibleSpacetimeCli.cli
process.env.PATH = `${compatibleSpacetimeCli.binDir}${delimiter}${process.env.PATH ?? ""}`

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)))
const moduleDir = join(packageRoot, "examples", "publishable-module")
const artifactDir = resolve(
  packageRoot,
  "node_modules",
  ".cache",
  "effect-spacetimedb-dev-server-node-smoke",
  `run-${process.pid.toString()}`,
)
const compiledRoot = join(artifactDir, "effect-spacetimedb")
const compiledNodeModules = join(compiledRoot, "node_modules")
const tscBinaryName = process.platform === "win32" ? "tsc.cmd" : "tsc"
const resolveTscPath = () => {
  const packageTscPath = join(
    packageRoot,
    "node_modules",
    ".bin",
    tscBinaryName,
  )
  if (existsSync(packageTscPath)) {
    return packageTscPath
  }
  const installRootTscPath = join(
    resolveInstallRootNodeModules(packageRoot),
    ".bin",
    tscBinaryName,
  )
  if (existsSync(installRootTscPath)) {
    return installRootTscPath
  }
  throw new Error(
    `tsc binary not found at ${packageTscPath} or ${installRootTscPath}. Run bun install from the package or mirror root.`,
  )
}
const tscPath = resolveTscPath()
const tsconfigPath = join(artifactDir, "tsconfig.json")

process.env.EFFECT_SPACETIMEDB_PACKAGE_ROOT = packageRoot

rmSync(artifactDir, { force: true, recursive: true })
mkdirSync(compiledRoot, { recursive: true })

try {
  run(compatibleSpacetimeCli.cli, ["build", "--module-path", moduleDir], {
    cwd: packageRoot,
    env: process.env,
  })

  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: true,
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
          lib: ["ES2022", "DOM"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noCheck: true,
          noEmit: false,
          outDir: compiledRoot,
          rewriteRelativeImportExtensions: true,
          rootDir: packageRoot,
          skipLibCheck: true,
          target: "ES2022",
          types: ["node"],
          verbatimModuleSyntax: true,
        },
        include: [
          relative(artifactDir, join(packageRoot, "src", "**", "*.ts")),
          relative(
            artifactDir,
            join(
              packageRoot,
              "examples",
              "publishable-module",
              "src",
              "**",
              "*.ts",
            ),
          ),
          relative(
            artifactDir,
            join(
              packageRoot,
              "examples",
              "publishable-module",
              "generated",
              "**",
              "*.ts",
            ),
          ),
          relative(
            artifactDir,
            join(packageRoot, "scripts", "dev-server-node-smoke-entry.ts"),
          ),
        ],
      },
      null,
      2,
    ),
  )

  run(tscPath, ["-p", tsconfigPath], {
    cwd: artifactDir,
    env: process.env,
  })
  patchCompiledTree(compiledRoot)

  writeFileSync(
    join(compiledRoot, "package.json"),
    JSON.stringify(
      {
        name: "effect-spacetimedb",
        type: "module",
        exports: {
          ".": "./src/index.js",
          "./client": "./src/client/index.js",
          "./dev-server": "./src/dev-server/index.js",
          "./server": "./src/server/index.js",
          "./server-compiler": "./src/server-compiler.js",
          "./server-polyfills": "./src/server-polyfills.js",
          "./testing": "./src/testing.js",
          "./testing/example-client":
            "./examples/publishable-module/generated/index.js",
          "./testing/example-module":
            "./examples/publishable-module/src/canonical-example-module.js",
          "./testing/spacetime-sys": "./src/testing/spacetime-sys.js",
        },
      },
      null,
      2,
    ),
  )
  mkdirSync(compiledNodeModules, { recursive: true })
  symlinkSync("..", join(compiledNodeModules, "effect-spacetimedb"))

  run(
    process.execPath,
    [join(compiledRoot, "scripts", "dev-server-node-smoke-entry.js")],
    {
      cwd: compiledRoot,
      env: process.env,
    },
  )
} finally {
  rmSync(artifactDir, { force: true, recursive: true })
}
