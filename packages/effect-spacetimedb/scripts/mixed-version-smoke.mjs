// Two copies of effect-spacetimedb installed side by side read each other's
// field-options annotations, because the annotation key is a global symbol.
// This smoke is the only check that exercises that against a real npm install
// of the published package, and it has to say which Effect each copy runs on,
// because no single Effect can load both:
//
//   * The candidate needs `effect@4.1.1` — its declared floor. The stable
//     line removed the `effect/unstable/*` subpaths every release through 0.7.0
//     imports, and the candidate speaks the stable spelling.
//   * Published 0.7.0 cannot load on the stable line at all: it resolves an
//     `effect/unstable/*` subpath that no longer exists. A shipped tarball
//     cannot be changed, so this is permanent. `4.0.0-rc.117`, the release
//     candidate it was built on, is the newest Effect it can load.
//
// So the smoke runs two scenarios against one packed candidate:
//
//   1. `declared-floor` — one consumer, one hoisted `effect` at the candidate's
//      pin, both packages installed. This is the tree a user upgrading today
//      actually gets, and what it proves is that a stale 0.7.0 copy cannot
//      silently misread anything, because it cannot be imported.
//   2. `legacy-window` — a nested consumer that gives published 0.7.0 its own
//      `effect@4.0.0-rc.117` while the candidate keeps resolving the outer
//      4.1.1. Both copies load, which is the only window in which they can
//      meet. Both write field-options payload version 2 under the same key, so
//      each must read the other's options exactly; a payload change in either
//      direction would show here first. The global `Symbol.for(...)` keys are
//      process-wide, so the two copies recognise each other's value types
//      across the two Effect realms exactly as they would inside one. (The
//      0.6.x payload boundary is pinned by the field-options version unit test.)
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

const publishedVersion = "0.7.0"

// The newest Effect published 0.7.0 can be imported on. Not derived from any
// manifest on purpose: it is a fact about a released tarball, and it can only
// change if npm loses a version.
const publishedEffectVersion = "4.0.0-rc.117"

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

// The candidate side tracks the repository pin rather than a literal, so a
// future Effect bump moves this smoke with it.
const candidateEffectVersion = exactDependency("effect")
if (candidateEffectVersion === publishedEffectVersion) {
  throw new Error(
    `The candidate pins the one Effect published ${publishedVersion} can load (${publishedEffectVersion}); this smoke's two scenarios have collapsed into one`,
  )
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
const legacyWindowDir = path.join(consumerDir, "legacy-window")
mkdirSync(legacyWindowDir, { recursive: true })

const npmInstall = (cwd) =>
  runCommand(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--legacy-peer-deps",
    ],
    { cwd },
  )

try {
  const tarball = await resolvePublishArchive(packDir)

  // The two copies peer on different SpaceTimeDB minors (published 0.7.0 wants
  // ~2.10.1, the candidate ~2.14.0), so no single install satisfies both peer
  // ranges — that disagreement is the point of the scenario, not an accident to
  // route around. `--legacy-peer-deps` makes npm install exactly the tree
  // spelled out below instead of resolving peers, and the contract layer this
  // smoke exercises (value types, field options, table specs) only touches the
  // SDK's re-exported scalar classes, which are identical across both. Only
  // `effect` is deliberately duplicated below; the SDK stays shared.
  writeFileSync(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "mixed-version-smoke",
        private: true,
        type: "module",
        dependencies: {
          "estdb-candidate": `file:${tarball}`,
          "estdb-published": `npm:effect-spacetimedb@${publishedVersion}`,
          effect: candidateEffectVersion,
          spacetimedb: exactDependency("spacetimedb"),
        },
      },
      null,
      2,
    )}\n`,
  )

  // Nested, so Node's upward resolution gives published 0.7.0 the Effect it can
  // load while the candidate — which lives in the parent's node_modules —
  // keeps resolving the parent's. `spacetimedb` and `estdb-candidate` are
  // deliberately absent here and resolve upward to the single shared copy.
  writeFileSync(
    path.join(legacyWindowDir, "package.json"),
    `${JSON.stringify(
      {
        name: "mixed-version-smoke-legacy-window",
        private: true,
        type: "module",
        dependencies: {
          "estdb-published": `npm:effect-spacetimedb@${publishedVersion}`,
          effect: publishedEffectVersion,
        },
      },
      null,
      2,
    )}\n`,
  )

  npmInstall(consumerDir)
  npmInstall(legacyWindowDir)

  // --- Scenario 1: the declared floor, one hoisted Effect --------------------
  writeFileSync(
    path.join(consumerDir, "check-declared-floor.mjs"),
    `import { readFileSync } from "node:fs"
import * as Candidate from "estdb-candidate"

const versionOf = (dir) =>
  JSON.parse(readFileSync(\`node_modules/\${dir}/package.json\`, "utf8")).version

const candidateVersion = versionOf("estdb-candidate")
const installedPublished = versionOf("estdb-published")
const installedEffect = versionOf("effect")

if (installedPublished !== ${JSON.stringify(publishedVersion)}) {
  throw new Error(\`Expected the published copy to be ${publishedVersion}, found \${installedPublished}\`)
}
if (candidateVersion === installedPublished) {
  throw new Error("Both installed copies resolved to the same version")
}
if (installedEffect !== ${JSON.stringify(candidateEffectVersion)}) {
  throw new Error(\`Expected effect ${candidateEffectVersion} hoisted for the candidate, found \${installedEffect}\`)
}

// The candidate is whole on its declared floor: it reads its own field options
// back, including the option the qualifier-last rename touched.
const candidateOnly = Candidate.table("candidateOnlyTable", {
  columns: { id: Candidate.string().unique().index("btree") },
})
if (candidateOnly.constraints.length === 0 || candidateOnly.indexes.length === 0) {
  throw new Error(\`Candidate \${candidateVersion} did not read its own field options on effect \${installedEffect}\`)
}

// Published 0.7.0 in the same tree cannot be imported at all. This is what an
// upgrading user actually hits, and it is why the annotation boundary below is
// unreachable on this Effect: a copy that cannot load cannot misread a field.
let importError
try {
  await import("estdb-published")
} catch (error) {
  importError = error
}
if (importError === undefined) {
  throw new Error(
    \`Published \${installedPublished} imported successfully on effect \${installedEffect}; the mixed-install story changed and this smoke must be revisited\`,
  )
}
if (
  importError.code !== "ERR_MODULE_NOT_FOUND" ||
  !String(importError).includes("/effect/dist/unstable/")
) {
  throw new Error(
    \`Expected published \${installedPublished} to fail importing a removed effect/unstable subpath, got: \${String(importError)}\`,
  )
}

process.stdout.write(
  \`declared-floor: candidate \${candidateVersion} is whole on effect \${installedEffect}, and published \${installedPublished} cannot be imported beside it.\\n\`,
)
`,
  )

  // --- Scenario 2: the rc.117 window, where both copies load ----------------
  writeFileSync(
    path.join(legacyWindowDir, "check-legacy-window.mjs"),
    `import { readFileSync } from "node:fs"
import * as Candidate from "estdb-candidate"
import * as Published from "estdb-published"

const readVersion = (file) => JSON.parse(readFileSync(file, "utf8")).version

const candidateVersion = readVersion("../node_modules/estdb-candidate/package.json")
const installedPublished = readVersion("node_modules/estdb-published/package.json")
const candidateEffect = readVersion("../node_modules/effect/package.json")
const publishedEffect = readVersion("node_modules/effect/package.json")

if (installedPublished !== ${JSON.stringify(publishedVersion)}) {
  throw new Error(\`Expected the published copy to be ${publishedVersion}, found \${installedPublished}\`)
}
if (candidateVersion === installedPublished) {
  throw new Error("Both installed copies resolved to the same version")
}
if (candidateEffect !== ${JSON.stringify(candidateEffectVersion)}) {
  throw new Error(\`Expected the candidate on effect ${candidateEffectVersion}, found \${candidateEffect}\`)
}
if (publishedEffect !== ${JSON.stringify(publishedEffectVersion)}) {
  throw new Error(\`Expected published \${installedPublished} on effect ${publishedEffectVersion}, found \${publishedEffect}\`)
}

// The same options, authored once by each copy. Both copies mint
// Symbol.for("effect-spacetimedb/StdbValueType"), a key in the process-wide
// symbol registry rather than in either Effect realm, so each accepts the
// other's value types as columns.
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

// Direction 1: the candidate reads a field the published copy annotated.
expectAuthorInvisible(
  \`candidate \${candidateVersion} reading a \${installedPublished} field\`,
  Candidate,
  candidateColumn,
  publishedColumn,
)

// Direction 2: the published copy reads a field the candidate annotated.
expectAuthorInvisible(
  \`published \${installedPublished} reading a \${candidateVersion} field\`,
  Published,
  publishedColumn,
  candidateColumn,
)

process.stdout.write(
  \`legacy-window: on effect \${publishedEffect} and \${candidateEffect} both copies load, and candidate \${candidateVersion} and published \${installedPublished} read each other's field options exactly.\\n\`,
)
`,
  )

  process.stdout.write(
    runCommand(process.execPath, ["check-declared-floor.mjs"], {
      cwd: consumerDir,
    }),
  )
  process.stdout.write(
    runCommand(process.execPath, ["check-legacy-window.mjs"], {
      cwd: legacyWindowDir,
    }),
  )
  process.stdout.write("Mixed-version smoke passed.\n")
} finally {
  rmSync(smokeRoot, { force: true, recursive: true })
  rmSync(packDir, { force: true, recursive: true })
}
