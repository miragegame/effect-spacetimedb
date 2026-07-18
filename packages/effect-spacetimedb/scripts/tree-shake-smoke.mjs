import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const result = await build({
  stdin: {
    contents: `
      import { compareTimestampAsc } from "./src/index.ts"
      globalThis.__treeShakeValue = compareTimestampAsc
    `,
    resolveDir: packageRoot,
    sourcefile: "tree-shake-entry.ts",
  },
  bundle: true,
  external: [
    "effect",
    "effect/*",
    "headers-polyfill",
    "spacetimedb",
    "spacetimedb/*",
  ],
  format: "esm",
  metafile: true,
  platform: "neutral",
  treeShaking: true,
  write: false,
})

const outputMetadata = Object.values(result.metafile.outputs)[0]
if (outputMetadata === undefined) {
  throw new Error("Tree-shake smoke produced no bundle metadata")
}
const inputs = Object.entries(outputMetadata.inputs)
  .filter(([, metadata]) => metadata.bytesInOutput > 0)
  .map(([input]) => input)
const forbiddenInputs = [
  "src/server/compile-module.ts",
  "src/server/host-abi-compiler.ts",
  "src/contract/type/wire-schema.ts",
]
const includedForbiddenInputs = forbiddenInputs.filter((suffix) =>
  inputs.some((input) => input.endsWith(suffix)),
)
const output = result.outputFiles.map((file) => file.text).join("\n")

if (includedForbiddenInputs.length > 0) {
  throw new Error(
    `Tree-shake smoke retained heavy modules: ${includedForbiddenInputs.join(", ")}`,
  )
}
if (output.includes("spacetimedb/server")) {
  throw new Error("Tree-shake smoke retained the server host entrypoint")
}
if (!inputs.some((input) => input.endsWith("src/timestamp.ts"))) {
  throw new Error("Tree-shake smoke did not retain the requested leaf helper")
}

console.log(
  `Tree-shake smoke retained ${inputs.length.toString()} inputs without compiler, host, or wire-schema modules.`,
)
