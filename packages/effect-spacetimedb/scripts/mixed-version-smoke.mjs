// Two copies of effect-spacetimedb installed side by side read each other's
// field-options annotations, because the annotation key is a global symbol.
// This smoke is the only check that exercises that against a real npm install
// of the published package: one consumer, the packed candidate beside the last
// published version, one hoisted `effect` and an SDK satisfying each copy's peers. Both copies write
// field-options payload version 2 under the same key, so each must read the
// other's options exactly; a payload change in either direction shows here
// first. (Published 0.7.0 is outside this story: it cannot load on the stable
// Effect line at all. The 0.6.x payload boundary is pinned by the field-options
// version unit test.)
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolvePublishArchive } from "./pack.mjs"
import { packageRoot, runCommand } from "./standalone-helpers.mjs"

const publishedVersion = "0.8.0"

const nodeMajorVersion = Number.parseInt(
  process.versions.node.split(".")[0],
  10,
)
if (nodeMajorVersion < 20) {
  throw new Error(
    `Mixed-version smoke requires Node 20 or newer; found ${process.version}`,
  )
}

const packageJson = JSON.parse(
  readFileSync(path.join(packageRoot, "package.json"), "utf8"),
)
if (packageJson.version === publishedVersion) {
  throw new Error(
    `Mixed-version smoke needs the candidate to differ from the published ${publishedVersion}`,
  )
}

const exactDependency = (name) => {
  const version = packageJson.devDependencies?.[name]
  if (typeof version !== "string") {
    throw new Error(
      `Missing exact devDependency used by mixed-version smoke: ${name}`,
    )
  }
  return version
}

const smokeRoot = mkdtempSync(
  path.join(tmpdir(), "effect-spacetimedb-mixed-version-smoke-"),
)
const packageScratchRoot = path.join(packageRoot, ".tmp")
mkdirSync(packageScratchRoot, { recursive: true })
const packDir = mkdtempSync(
  path.join(packageScratchRoot, "mixed-version-smoke-"),
)
const consumerDir = path.join(smokeRoot, "consumer")
mkdirSync(consumerDir, { recursive: true })

try {
  const tarball = await resolvePublishArchive(packDir)

  // Put the published package below a consumer boundary. npm can now resolve
  // both releases' SDK peers even when they require different minor versions.
  const publishedDir = path.join(smokeRoot, "published-consumer")
  mkdirSync(publishedDir)
  writeFileSync(
    path.join(publishedDir, "package.json"),
    JSON.stringify({
      name: "published-consumer",
      version: "1.0.0",
      private: true,
      type: "module",
      exports: "./index.js",
      dependencies: { "effect-spacetimedb": publishedVersion },
    }),
  )
  writeFileSync(
    path.join(publishedDir, "index.js"),
    `import { createRequire } from "node:module"
export * from "effect-spacetimedb"
export const version = createRequire(import.meta.url)("effect-spacetimedb/package.json").version
`,
  )

  writeFileSync(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "mixed-version-smoke",
        private: true,
        type: "module",
        dependencies: {
          "effect-spacetimedb": `file:${tarball}`,
          "published-consumer": `file:${publishedDir}`,
          effect: exactDependency("effect"),
          spacetimedb: exactDependency("spacetimedb"),
        },
      },
      null,
      2,
    )}\n`,
  )

  runCommand(
    "npm",
    [
      "install",
      "--install-links",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
    ],
    {
      cwd: consumerDir,
    },
  )

  writeFileSync(
    path.join(consumerDir, "check.mjs"),
    `import { createRequire } from "node:module"
import * as Candidate from "effect-spacetimedb"
import * as Published from "published-consumer"

const candidateVersion = createRequire(import.meta.url)("effect-spacetimedb/package.json").version
const installedPublished = Published.version

if (installedPublished !== ${JSON.stringify(publishedVersion)}) {
  throw new Error(\`Expected the published copy to be ${publishedVersion}, found \${installedPublished}\`)
}
if (candidateVersion === installedPublished) {
  throw new Error("Both installed copies resolved to the same version")
}

// The same options, authored once by each copy. Both copies mint
// the same process-wide symbol, so each accepts the other's value types as columns.
const publishedColumn = Published.string().unique().index("btree")
const candidateColumn = Candidate.string().unique().index("btree")

// A table spec's constraints and indexes are plain data derived from the field
// options, so equal JSON means the reader saw the same options.
const shapeOf = (spec) =>
  JSON.stringify({ constraints: spec.constraints, indexes: spec.indexes })

// Each reader's view of its own copy's field is the reference: who authored a
// field must not change what a reader sees.
const expectAuthorInvisible = (label, reader, ownColumn, foreignColumn) => {
  const own = reader.table("mixedVersionTable", { columns: { id: ownColumn } })
  const foreign = reader.table("mixedVersionTable", { columns: { id: foreignColumn } })
  if (own.constraints.length === 0 || own.indexes.length === 0) {
    throw new Error(\`\${label}: the reader did not read its own field options; the fixture is wrong\`)
  }
  if (shapeOf(foreign) !== shapeOf(own)) {
    throw new Error(\`\${label}: read \${shapeOf(foreign)} from the other copy's field, but \${shapeOf(own)} from its own\`)
  }
}

expectAuthorInvisible(
  \`candidate \${candidateVersion} reading a \${installedPublished} field\`,
  Candidate,
  candidateColumn,
  publishedColumn,
)
expectAuthorInvisible(
  \`published \${installedPublished} reading a \${candidateVersion} field\`,
  Published,
  publishedColumn,
  candidateColumn,
)

process.stdout.write(
  \`candidate \${candidateVersion} and published \${installedPublished} read each other's field options exactly.\\n\`,
)
`,
  )

  process.stdout.write(
    runCommand(process.execPath, ["check.mjs"], { cwd: consumerDir }),
  )
  process.stdout.write("Mixed-version smoke passed.\n")
} finally {
  rmSync(smokeRoot, { force: true, recursive: true })
  rmSync(packDir, { force: true, recursive: true })
}
