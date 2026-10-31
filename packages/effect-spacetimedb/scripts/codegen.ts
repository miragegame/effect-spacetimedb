import path from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Effect from "effect/Effect"
import {
  checkArtifact,
  checkReceiverArtifact,
  generateArtifact,
  generateReceiverArtifact,
  type CodegenTarget,
  type ReceiverCodegenTarget,
} from "../src/codegen/index.ts"
import {
  ensureModuleCanResolveInstallRoot,
  exampleBundlePath,
  exampleGeneratedClientDir,
  exampleModuleRoot,
  idcPairReceiverProject,
  idcPairReceiverBindingDir,
  packageRoot,
  resolveSpacetimeCliCommand,
  runCommand,
} from "./standalone-helpers.mjs"

const args = process.argv.slice(2)
const check = args.length === 1 && args[0] === "--check"
if (args.length > (check ? 1 : 0)) {
  throw new Error(`Unknown argument: ${args.join(" ")}`)
}

const stagingRoot = path.join(packageRoot, ".tmp", "effect-spacetimedb-codegen")

// One ESM bundle of a module entry, for schema extraction only: generate reads
// the module definition, so any bundler that keeps the host imports external
// yields the same names and hashes.
const bundleModuleEntry = (entry: string, outfile: string) =>
  runCommand("bun", [
    "build",
    entry,
    "--outfile",
    outfile,
    "--format",
    "esm",
    "--target",
    "bun",
    "--external",
    "spacetime:sys@2.0",
    "--external",
    "spacetime:sys@2.1",
    "--external",
    "spacetime:sys@2.2",
  ])

ensureModuleCanResolveInstallRoot(exampleModuleRoot)
bundleModuleEntry(
  path.join(exampleModuleRoot, "src", "index.ts"),
  exampleBundlePath,
)

const spacetimeCommand = resolveSpacetimeCliCommand()

const clientTarget: CodegenTarget = {
  moduleBundlePath: exampleBundlePath,
  stagingDir: path.join(stagingRoot, "staging"),
  artifactDir: exampleGeneratedClientDir,
  spacetimeCommand,
}

// Each committed receiver binding, with the interface fixture it is generated
// from: the example pair's, and the inter-database-call test fixtures'.
const idcFixtureRoot = path.join(packageRoot, "test", "fixtures", "idc")
const receiverBindings: ReadonlyArray<{
  readonly entry: string
  readonly target: ReceiverCodegenTarget
}> = [
  {
    entry: path.join(idcPairReceiverProject.moduleRoot, "src", "index.ts"),
    target: {
      interfaceName: "pair_inbox",
      receiverBundlePath: path.join(stagingRoot, "pair-inbox", "receiver.js"),
      stagingDir: path.join(stagingRoot, "pair-inbox", "staging"),
      artifactDir: idcPairReceiverBindingDir,
      spacetimeCommand,
    },
  },
  {
    entry: path.join(idcFixtureRoot, "receiver", "entry.ts"),
    target: {
      interfaceName: "idc_fixture_inbox",
      receiverBundlePath: path.join(
        stagingRoot,
        "idc-fixture-inbox",
        "receiver.js",
      ),
      stagingDir: path.join(stagingRoot, "idc-fixture-inbox", "staging"),
      artifactDir: path.join(idcFixtureRoot, "remote", "idc_fixture_inbox"),
      spacetimeCommand,
    },
  },
]

ensureModuleCanResolveInstallRoot(idcPairReceiverProject.moduleRoot)
for (const binding of receiverBindings) {
  bundleModuleEntry(binding.entry, binding.target.receiverBundlePath)
}

if (check) {
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* checkArtifact(clientTarget)
      yield* Effect.forEach(
        receiverBindings,
        (binding) => checkReceiverArtifact(binding.target),
        { concurrency: 1, discard: true },
      )
    }).pipe(Effect.provide(NodeServices.layer)),
  )
} else {
  const written = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* generateArtifact(clientTarget)
      const receivers = yield* Effect.forEach(
        receiverBindings,
        (binding) => generateReceiverArtifact(binding.target),
        { concurrency: 1 },
      )
      return [
        client.artifactDir,
        ...receivers.map((receiver) => receiver.artifactDir),
      ]
    }).pipe(Effect.provide(NodeServices.layer)),
  )
  process.stdout.write(`${written.join("\n")}\n`)
}
