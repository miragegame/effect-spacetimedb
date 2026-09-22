//
// Two copies of effect-spacetimedb installed side by side read each other's
// field-options annotations, because the annotation key is a global symbol.
// This smoke is the only check that exercises that against a real npm install
// of the published package, and since Effect `4.0.0-rc.113` it has to say which
// Effect each copy runs on, because no single Effect can load both:
//
//   * The 0.7.0 candidate needs `effect@4.0.0-rc.117` — its declared floor.
//     rc.113 renamed `SchemaGetter.transformOrFail` to `transformEffect` and
//     rc.116 reshaped `SchemaGetter.Getter`, and the candidate speaks the new
//     spelling.
//   * Published 0.6.0 cannot load on `effect >= 4.0.0-rc.113` at all: its
//     `dist/schema-transform.js` calls `SchemaGetter.transformOrFail` while the
//     module is being evaluated, so importing it throws a `TypeError` before any
//     of its API is reachable. A shipped tarball cannot be changed, so this is
//     permanent. `4.0.0-rc.112` is the newest Effect it can load.
//
// So the smoke runs two scenarios against one packed candidate:
//
//   1. `declared-floor` — one consumer, one hoisted `effect` at the candidate's
//      pin, both packages installed. This is the tree a user upgrading today
//      actually gets, and what it proves is that a stale 0.6.0 copy cannot
//      silently misread anything, because it cannot be imported.
//   2. `legacy-window` — a nested consumer that gives published 0.6.0 its own
//      `effect@4.0.0-rc.112` while the candidate keeps resolving the outer
//      rc.117. Both copies load, so the field-options version boundary is
//      observable, which is the only window in which it ever is. The global
//      `Symbol.for(...)` keys are process-wide, so the two copies recognise each
//      other's value types across the two Effect realms exactly as they would
//      inside one.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { packPublishArchive } from "./pack.mjs"
import { packageRoot, runCommand } from "./standalone-helpers.mjs"

const publishedVersion = "0.6.0"

// The newest Effect published 0.6.0 can be imported on. Not derived from any
// manifest on purpose: it is a fact about a released tarball, and it can only
// change if npm loses a version.
const publishedEffectVersion = "4.0.0-rc.112"

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
  const tarball = await packPublishArchive(packDir)

  // The two copies peer on different SpaceTimeDB majors (published 0.6.0 wants
  // ~2.6.1, the candidate ~2.10.1), so no single install satisfies both peer
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

  // Nested, so Node's upward resolution gives published 0.6.0 the Effect it can
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

// Published 0.6.0 in the same tree cannot be imported at all. This is what an
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
if (!String(importError).includes("transformOrFail")) {
  throw new Error(
    \`Expected published \${installedPublished} to fail importing on the removed SchemaGetter.transformOrFail, got: \${String(importError)}\`,
  )
}

process.stdout.write(
  \`declared-floor: candidate \${candidateVersion} is whole on effect \${installedEffect}, and published \${installedPublished} cannot be imported beside it.\\n\`,
)
`,
  )

  // --- Scenario 2: the rc.110–rc.112 window, where the boundary is visible ---
  writeFileSync(
    path.join(legacyWindowDir, "check-annotation-boundary.mjs"),
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

// On Effect 4 release candidates a Schema is callable, which 0.6.0's value-type
// guard predates: 0.6.0 throws "not supported for this SpaceTimeDB column type"
// from the options that consult its type metadata. Asserted, not assumed — if a
// future Effect made 0.6.0 whole again, more of its surface would become live
// in a mixed install and this smoke should be revisited.
for (const [label, build] of [
  ["primaryKey", () => Published.string().primaryKey()],
  ["name", () => Published.string().name("wire_name")],
]) {
  let metadataError
  try {
    build()
  } catch (error) {
    metadataError = error
  }
  if (metadataError === undefined) {
    throw new Error(
      \`Published \${installedPublished} accepted .\${label}() on effect \${publishedEffect}; the mixed-install story changed\`,
    )
  }
}

// Both copies mint Symbol.for("effect-spacetimedb/StdbValueType"), a key in the
// process-wide symbol registry rather than in either Effect realm, so each one
// really does accept the other's value types as columns; without that, the
// scenario could not happen in the first place. The options below are the ones
// published 0.6.0 can still write under its Effect, and they are enough to
// produce its legacy annotation payload.
const publishedColumn = Published.string().unique().index("btree")
const candidateColumn = Candidate.string()
  .primaryKey()
  .unique()
  .index("btree")
  .name("wire_name")

// Direction 1: the candidate reads a field the published 0.6.0 copy annotated.
let boundaryError
try {
  Candidate.table("mixedVersionTable", { columns: { id: publishedColumn } })
} catch (error) {
  boundaryError = error
}
if (!(boundaryError instanceof Candidate.StdbFieldOptionsVersionError)) {
  throw new Error(
    \`Expected StdbFieldOptionsVersionError reading a \${installedPublished} field, got \${String(boundaryError)}\`,
  )
}
if (boundaryError._tag !== "StdbFieldOptionsVersionError") {
  throw new Error(\`Unexpected error tag \${String(boundaryError._tag)}\`)
}
for (const fragment of [
  "annotation payload version 1",
  "0.6.x",
  "annotation payload version 2",
  "deduplicate effect-spacetimedb to one version",
]) {
  if (!boundaryError.message.includes(fragment)) {
    throw new Error(\`Boundary error message is missing "\${fragment}": \${boundaryError.message}\`)
  }
}

// Direction 2: published 0.6.0 reads a candidate field. We cannot change what a
// released package does, and 0.6.0 only looks under the unversioned key, so it
// sees an unannotated column: no primary key constraint, no unique constraint,
// no index, and the column keeps its property name on the wire. It never
// misreads an option as a *different* option, which is what the new key buys.
const publishedView = Published.table("mixedVersionTable", {
  columns: { id: candidateColumn },
})
if (publishedView.constraints.length !== 0) {
  throw new Error(
    \`Expected \${installedPublished} to see no constraints on a \${candidateVersion} column, got \${JSON.stringify(publishedView.constraints)}\`,
  )
}
if (publishedView.indexes.length !== 0) {
  throw new Error(
    \`Expected \${installedPublished} to see no indexes on a \${candidateVersion} column, got \${JSON.stringify(publishedView.indexes)}\`,
  )
}

// The same table authored entirely by the published copy does see its options,
// so the empty result above is the version boundary and not a broken fixture.
const publishedNative = Published.table("publishedOnlyTable", {
  columns: { id: publishedColumn },
})
if (publishedNative.constraints.length === 0 || publishedNative.indexes.length === 0) {
  throw new Error(
    \`Published \${installedPublished} did not read its own field options; the fixture is wrong\`,
  )
}

process.stdout.write(
  \`legacy-window: on effect \${publishedEffect} both copies load, and candidate \${candidateVersion} fails explicitly on a \${installedPublished} field while \${installedPublished} reads a \${candidateVersion} field as carrying no options.\\n\`,
)
`,
  )

  process.stdout.write(
    runCommand(process.execPath, ["check-declared-floor.mjs"], {
      cwd: consumerDir,
    }),
  )
  process.stdout.write(
    runCommand(process.execPath, ["check-annotation-boundary.mjs"], {
      cwd: legacyWindowDir,
    }),
  )
  process.stdout.write("Mixed-version smoke passed.\n")
} finally {
  rmSync(smokeRoot, { force: true, recursive: true })
  rmSync(packDir, { force: true, recursive: true })
}
