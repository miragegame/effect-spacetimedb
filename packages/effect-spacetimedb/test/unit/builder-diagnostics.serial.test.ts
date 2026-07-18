import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import * as NodePath from "@effect/platform-node/NodePath"
import * as EffectVitest from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"

const { expect } = EffectVitest

const stripTrailingSlash = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value

const packageRoot = stripTrailingSlash(
  fileURLToPath(new URL("../../", import.meta.url)),
)
const DiagnosticsLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)
const describe = EffectVitest.layer(DiagnosticsLayer)

type TempProject = {
  readonly root: string
  readonly fixturePath: string
  readonly tsconfigPath: string
  readonly relativeFixturePath: string
}

type TsgoResult = {
  readonly status: number
  readonly output: string
}

class BuilderDiagnosticsAssertionFailure extends Data.TaggedError(
  "BuilderDiagnosticsAssertionFailure",
)<{
  readonly cause: unknown
}> {}

const slashPath = (value: string): string => value.replaceAll("\\", "/")

// Deterministic per-fixture service key. Derived from the fixture file name so
// the generator and the expected-diagnostic assertion agree without depending
// on where the scoped temp directory (or this repository) lives on disk.
const serviceKeyFor = (fixturePath: string): string => {
  const fileName = slashPath(fixturePath).split("/").at(-1) ?? fixturePath
  return `external-app/${fileName.replace(/\.ts$/u, "")}/ExternalService`
}

const withTempProject = <A, E>(
  sourceFor: (fixturePath: string) => string,
  run: (project: TempProject) => Effect.Effect<A, E>,
): Effect.Effect<
  A,
  E | PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const tmpRoot = path.join(packageRoot, "node_modules", ".tmp")

    yield* fs.makeDirectory(tmpRoot, { recursive: true })
    const root = yield* fs.makeTempDirectoryScoped({
      directory: tmpRoot,
      prefix: "builder-diagnostics-",
    })
    const fixturePath = path.join(root, "fixture.ts")
    const tsconfigPath = path.join(root, "tsconfig.json")

    yield* fs.writeFileString(fixturePath, sourceFor(fixturePath))
    yield* fs.writeFileString(
      tsconfigPath,
      `${JSON.stringify(
        {
          $schema: "https://json.schemastore.org/tsconfig",
          extends: path.join(packageRoot, "tsconfig.base.json"),
          compilerOptions: {
            noEmit: true,
            tsBuildInfoFile: "./tsconfig.tsbuildinfo",
          },
          include: ["./fixture.ts"],
        },
        null,
        2,
      )}\n`,
    )

    return yield* run({
      root,
      fixturePath,
      tsconfigPath,
      relativeFixturePath: slashPath(path.relative(packageRoot, fixturePath)),
    })
  }).pipe(Effect.scoped)

const runTsgo = (
  project: TempProject,
  extraArgs: ReadonlyArray<string> = [],
): TsgoResult => {
  const result = spawnSync(
    process.execPath,
    [
      `${packageRoot}/scripts/effect-tsgo.mjs`,
      "--noEmit",
      ...extraArgs,
      "-p",
      project.tsconfigPath,
    ],
    {
      cwd: packageRoot,
      encoding: "utf8",
    },
  )
  return {
    status: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`,
  }
}

const lineOf = (source: string, needle: string): number => {
  const index = source.split("\n").findIndex((line) => line.includes(needle))
  expect(index).toBeGreaterThanOrEqual(0)
  return index + 1
}

const expectDiagnosticAt = (
  output: string,
  project: TempProject,
  source: string,
  needle: string,
): void => {
  expect(output).toContain(
    `${project.relativeFixturePath}(${lineOf(source, needle)},`,
  )
}

const misuseFixture = (fixturePath: string): string => {
  const externalKey = serviceKeyFor(fixturePath)
  return `import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"

class DeclaredFailure extends Schema.TaggedErrorClass<DeclaredFailure>()(
  "DeclaredFailure",
  {},
) {}

class UndeclaredFailure extends Schema.TaggedErrorClass<UndeclaredFailure>()(
  "UndeclaredFailure",
  {},
) {}

class ExternalService extends Context.Service<
  ExternalService,
  {
    readonly value: string
  }
>()(
  "${externalKey}",
) {}

const Errors = Stdb.errors(DeclaredFailure)
const ProbeGroup = Stdb.StdbGroup.make("Probe").add(
  Stdb.StdbFn.reducer("checked_error", {
    params: Stdb.struct({}),
    errors: Errors,
  }),
  Stdb.StdbFn.reducer("checked_service", {
    params: Stdb.struct({}),
  }),
)
const MultiServiceGroup = Stdb.StdbGroup.make("MultiService").add(
  Stdb.StdbFn.reducer("multi_service", {
    params: Stdb.struct({}),
  }),
)
const ProbeModule = Stdb.StdbModule.make("diagnostic_probe", {})
  .add(ProbeGroup)
  .add(MultiServiceGroup)
const { Http, Tx } = ProbeModule

const InlineUndeclared = Stdb.StdbBuilder.group(ProbeModule, "Probe", {
  checked_error: () => Effect.fail(UndeclaredFailure.make()),
  checked_service: () => Effect.void,
})
void InlineUndeclared

const CheckedForbidden = Stdb.StdbBuilder.groupChecked(ProbeModule, "Probe", {
  checked_error: () => Effect.fail(DeclaredFailure.make()),
  checked_service: () => Http,
})
void CheckedForbidden

const MultiForbidden = Stdb.StdbBuilder.groupChecked(ProbeModule, "MultiService", {
  multi_service: () => Effect.all([Http, Tx]),
})
void MultiForbidden

const PrecheckedExternal = Stdb.StdbBuilder.groupPrechecked(ProbeModule, "Probe", {
  checked_error: () => Effect.fail(DeclaredFailure.make()),
  checked_service: () => ExternalService,
})
void PrecheckedExternal

const RuntimeGroup = Stdb.StdbGroup.make("Runtime").add(
  Stdb.StdbFn.reducer("needs_runtime", {
    params: Stdb.struct({}),
  }),
)
const RuntimeModule = Stdb.StdbModule.make("diagnostic_runtime", {}).add(
  RuntimeGroup,
)
const RuntimeLive = Stdb.StdbBuilder.group(RuntimeModule, "Runtime", {
  needs_runtime: () => ExternalService,
})
void build(RuntimeModule, [RuntimeLive])
`
}

const moduleIdentityFixture = (
  _fixturePath?: string,
): string => `import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import * as Server from "effect-spacetimedb/server"
import { build } from "effect-spacetimedb/server-compiler"

const SharedGroup = Stdb.StdbGroup.make("Shared").add(
  Stdb.StdbFn.reducer("get", {
    params: Stdb.struct({}),
  }),
)
const OtherGroup = Stdb.StdbGroup.make("Other").add(
  Stdb.StdbFn.reducer("get", {
    params: Stdb.struct({}),
  }),
)

const ModuleA = Stdb.StdbModule.make("module_a", {}).add(SharedGroup)
const ModuleB = Stdb.StdbModule.make("module_b", {}).add(SharedGroup)
const ModuleBDifferent = Stdb.StdbModule.make("module_b_different", {}).add(OtherGroup)
const { Db: ModuleADb } = ModuleA

const ModuleALive = Stdb.StdbBuilder.group(ModuleA, "Shared", {
  get: () => Effect.void,
})

void build(ModuleB, [ModuleALive] as const) // build_same_name
void Stdb.StdbBuilder.plan(ModuleB, [ModuleALive] as const) // plan_same_name
void Stdb.StdbBuilder.handlersOf(ModuleB, ModuleALive) // handlers_same_name
void build(ModuleBDifferent, [ModuleALive] as const) // build_different_name

const WidenedImpl: Stdb.GroupImpl<"Shared", unknown> = ModuleALive
void build(ModuleB, [WidenedImpl] as const) // widened_impl

const CrossModuleAccessor = Stdb.StdbBuilder.groupChecked(ModuleB, "Shared", {
  get: () => ModuleADb,
})
void CrossModuleAccessor

const CrossModuleAnnotatedHandlers: Stdb.GroupCheckedHandlers<typeof ModuleB, "Shared"> = {
  get: () => ModuleADb, // annotated_brand_path
}
void CrossModuleAnnotatedHandlers

const RawTagAccessor = Stdb.StdbBuilder.groupChecked(ModuleB, "Shared", {
  get: () => Server.Db,
})
void RawTagAccessor

const ViewGroup = Stdb.StdbGroup.make("Views").add(
  Stdb.StdbFn.view("list", {
    returns: Stdb.array(Stdb.struct({})),
  }),
)
const ViewModule = Stdb.StdbModule.make("view_module", {}).add(ViewGroup)

const RawReadonlyDbAccessor = Stdb.StdbBuilder.groupChecked(ViewModule, "Views", {
  list: () =>
    Effect.gen(function* () {
      yield* Server.ReadonlyDb
      return []
    }),
})
void RawReadonlyDbAccessor

const TxGroup = Stdb.StdbGroup.make("TxPath").add(
  Stdb.StdbFn.procedure("lookup", {
    params: Stdb.struct({}),
    returns: Stdb.unit(),
  }),
)
const HttpTxGroup = Stdb.StdbHttpGroup.make("HttpTxPath").add(
  Stdb.StdbHttp.post("lookupHttp", "/lookup-http"),
)

const TxModuleA = Stdb.StdbModule.make("tx_module_a", {})
  .add(TxGroup)
  .add(HttpTxGroup)
const TxModuleB = Stdb.StdbModule.make("tx_module_b", {})
  .add(TxGroup)
  .add(HttpTxGroup)
const { Db: TxModuleADb, MutationCtx: TxModuleAMutationCtx } = TxModuleA
const { Tx: TxModuleBTx, HttpTx: TxModuleBHttpTx, withTx: TxModuleBWithTx } =
  TxModuleB

const CrossDbInsideTxRun = Stdb.StdbBuilder.groupChecked(TxModuleB, "TxPath", {
  lookup: () =>
    Effect.gen(function* () {
      const tx = yield* TxModuleBTx
      return yield* tx.run(
        Effect.gen(function* () {
          yield* TxModuleADb
          return undefined
        }),
      )
    }),
})
void CrossDbInsideTxRun

const CrossMutationInsideWithTx = Stdb.StdbBuilder.groupChecked(
  TxModuleB,
  "TxPath",
  { // mutation_withtx_path
    lookup: () =>
      TxModuleBWithTx(
        Effect.gen(function* () {
          yield* TxModuleAMutationCtx
          return undefined
        }),
      ),
  },
)
void CrossMutationInsideWithTx

const CrossDbInsideHttpTxRun = Stdb.StdbBuilder.groupChecked(
  TxModuleB,
  "HttpTxPath",
  { // http_tx_path
    lookupHttp: () =>
      Effect.gen(function* () {
        const httpTx = yield* TxModuleBHttpTx
        return yield* httpTx.run(
          Effect.gen(function* () {
            yield* TxModuleADb
            return new Stdb.SyncResponse("ok")
          }),
        )
      }),
  },
)
void CrossDbInsideHttpTxRun
`

const groupDecl = (index: number): string => {
  const groupName = `Group${index.toString().padStart(2, "0")}`
  const endpoints = Array.from(
    { length: 5 },
    (_, endpointIndex) =>
      `endpoint${index.toString().padStart(2, "0")}_${endpointIndex
        .toString()
        .padStart(2, "0")}`,
  )
  return `  group5(
    "${groupName}",
${endpoints.map((endpoint) => `    "${endpoint}",`).join("\n")}
  )`
}

const procedureGroupDecl = (index: number): string => {
  const groupName = `ResultGroup${index.toString().padStart(2, "0")}`
  const endpoints = Array.from(
    { length: 5 },
    (_, endpointIndex) =>
      `resultEndpoint${index.toString().padStart(2, "0")}_${endpointIndex
        .toString()
        .padStart(2, "0")}`,
  )
  return `  procedureGroup5(
    "${groupName}",
${endpoints.map((endpoint) => `    "${endpoint}",`).join("\n")}
  )`
}

const platformClientGroupDecl = (index: number): string => {
  const groupName = `PlatformGroup${index.toString().padStart(2, "0")}`
  const prefix = `platform${index.toString().padStart(2, "0")}`
  const endpoints = Array.from(
    { length: 42 },
    (_, endpointIndex) =>
      `${prefix}_${endpointIndex.toString().padStart(2, "0")}`,
  )
  return `const ${groupName} = Stdb.StdbGroup.make("${groupName}").add(
${endpoints.map((endpoint) => `  reducer("${endpoint}"),`).join("\n")}
)`
}

const platformGroupedClientScaleFixture = (
  groupedAccesses: boolean,
): string => `// lint-ignore: stdb-string-columns-require-domain - scale diagnostic fixture intentionally exercises raw STDB schema constructors
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"

const Params = Stdb.struct({ value: Stdb.string(Schema.String) })
const reducer = <const Name extends string>(name: Name) =>
  Stdb.StdbFn.reducer(name, { params: Params })

${Array.from({ length: 19 }, (_, index) => platformClientGroupDecl(index)).join("\n\n")}

const PlatformModule = Stdb.StdbModule.make("platform_grouped_scale", {}).add(
${Array.from(
  { length: 19 },
  (_, index) => `  PlatformGroup${index.toString().padStart(2, "0")},`,
).join("\n")}
)
type PlatformSpec = typeof PlatformModule.spec
declare const FlatPlatformSpec: Stdb.ModuleSpec<
  PlatformSpec["tables"],
  PlatformSpec["views"],
  PlatformSpec["reducers"],
  PlatformSpec["procedures"],
  PlatformSpec["lifecycle"],
  PlatformSpec["httpHandlers"]
>
const client = Stdb.project(${groupedAccesses ? "PlatformModule" : "FlatPlatformSpec"}).client.http.make({
  uri: "http://localhost:3000",
  databaseName: "platform_grouped_scale",
})
${Array.from({ length: 19 }, (_, index) => {
  const suffix = index.toString().padStart(2, "0")
  return groupedAccesses && index === 0
    ? `void client.PlatformGroup${suffix}.reducers.platform${suffix}_41({ value: "grouped" })`
    : `void client.reducers.platform${suffix}_41({ value: "baseline" })`
}).join("\n")}
`

const scaleFixture =
  (): string => `// lint-ignore: stdb-string-columns-require-domain - scale diagnostic fixture intentionally exercises raw STDB schema constructors
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import * as StdbClient from "effect-spacetimedb/client"
import {
  DbConnectionBuilder as NativeDbConnectionBuilder,
  DbConnectionImpl,
  type ErrorContextInterface,
  type RemoteModule,
} from "spacetimedb"

class DeclaredFailure extends Schema.TaggedErrorClass<DeclaredFailure>()(
  "DeclaredFailure",
  {},
) {}

class UndeclaredFailure extends Schema.TaggedErrorClass<UndeclaredFailure>()(
  "UndeclaredFailure",
  {},
) {}

const Errors = Stdb.errors(DeclaredFailure)
const ProbeParams = Stdb.struct({})
const ScaleUserId = Schema.String.pipe(Schema.brand("ScaleUserId"))
const ScaleUser = Stdb.table("scale_user", {
  public: true,
  columns: {
    id: Stdb.string(ScaleUserId).primaryKey(),
  },
})
const reducer = <const Name extends string>(name: Name) =>
  Stdb.StdbFn.reducer(name, { params: ProbeParams, errors: Errors })
const resultProcedure = <const Name extends string>(name: Name) =>
  Stdb.StdbFn.procedure(name, {
    params: ProbeParams,
    returns: Stdb.string(),
    errors: Errors,
  })

const group5 = <
  const Id extends string,
  const E0 extends string,
  const E1 extends string,
  const E2 extends string,
  const E3 extends string,
  const E4 extends string,
>(
  id: Id,
  e0: E0,
  e1: E1,
  e2: E2,
  e3: E3,
  e4: E4,
) =>
  Stdb.StdbGroup.make(id).add(
    reducer(e0),
    reducer(e1),
    reducer(e2),
    reducer(e3),
    reducer(e4),
  )

const procedureGroup5 = <
  const Id extends string,
  const E0 extends string,
  const E1 extends string,
  const E2 extends string,
  const E3 extends string,
  const E4 extends string,
>(
  id: Id,
  e0: E0,
  e1: E1,
  e2: E2,
  e3: E3,
  e4: E4,
) =>
  Stdb.StdbGroup.make(id).add(
    resultProcedure(e0),
    resultProcedure(e1),
    resultProcedure(e2),
    resultProcedure(e3),
    resultProcedure(e4),
  )

const ScaleModule = Stdb.StdbModule.make("diagnostic_scale", {}).addTables(
  ScaleUser,
).add(
${Array.from({ length: 12 }, (_, index) => groupDecl(index)).join(",\n")}
)
type ScaleModuleSpec = (typeof ScaleModule)["spec"]
const ResultScaleModule = Stdb.StdbModule.make("result_scale", {}).add(
${Array.from({ length: 12 }, (_, index) => procedureGroupDecl(index)).join(",\n")}
)
type ScaleResultValues = StdbClient.ResultValuesOf<
  (typeof ResultScaleModule)["spec"]
>
declare const ScaleResult: ScaleResultValues[keyof ScaleResultValues]
void ScaleResult
type GeneratedSchema = {
  readonly tables: Record<string, never>
}
type GeneratedReducers = {
  readonly reducers: readonly []
}
type GeneratedProcedures = {
  readonly procedures: readonly []
}
declare const REMOTE_MODULE: RemoteModule<
  GeneratedSchema,
  GeneratedReducers,
  GeneratedProcedures,
  "2.6.1"
>
type ErrorContext = ErrorContextInterface<typeof REMOTE_MODULE>
declare class DbConnection extends DbConnectionImpl<typeof REMOTE_MODULE> {
  static builder(): DbConnectionBuilder
}
declare class DbConnectionBuilder extends NativeDbConnectionBuilder<DbConnection> {}

const handler = () => Effect.void

const ScaleLive = Stdb.StdbBuilder.groupPrechecked(ScaleModule, "Group11", {
  endpoint11_00: handler,
  endpoint11_01: handler,
  endpoint11_02: handler,
  endpoint11_03: handler,
  endpoint11_04: () => Effect.fail(UndeclaredFailure.make()),
})
void ScaleLive
const ScaleProject = Stdb.project(ScaleModule)
void ScaleProject.client.ws.layerGenerated({
  DbConnection,
  uri: "ws://localhost:3000",
  databaseName: "diagnostic_scale",
})
declare const ScaleSession: StdbClient.WsSession<ScaleModuleSpec, ErrorContext>
const scaleUserId = Schema.decodeUnknownSync(ScaleUserId)("user_1")
void ScaleSession.subscribeRowRef("scale_user", scaleUserId)
`

const instantiationsFrom = (output: string): number => {
  const match = /^Instantiations:\s+(\d+)$/mu.exec(output)
  expect(match).not.toBeNull()
  return Number(match?.[1] ?? Number.NaN)
}

const assertEffect = (
  assert: () => void,
): Effect.Effect<void, BuilderDiagnosticsAssertionFailure> =>
  Effect.try({
    try: assert,
    catch: (cause) => new BuilderDiagnosticsAssertionFailure({ cause }),
  })

describe("builder misuse diagnostics", (it) => {
  it.effect(
    "reports keyed endpoint diagnostics without old structural noise",
    () =>
      withTempProject(misuseFixture, (project) =>
        assertEffect(() => {
          const source = misuseFixture(project.fixturePath)
          const result = runTsgo(project)

          expect(result.status).not.toBe(0)
          expectDiagnosticAt(
            result.output,
            project,
            source,
            "const InlineUndeclared",
          )
          expectDiagnosticAt(
            result.output,
            project,
            source,
            "const CheckedForbidden",
          )
          expectDiagnosticAt(
            result.output,
            project,
            source,
            "const PrecheckedExternal",
          )
          expectDiagnosticAt(
            result.output,
            project,
            source,
            "const MultiForbidden",
          )
          expectDiagnosticAt(
            result.output,
            project,
            source,
            "void build(RuntimeModule",
          )
          expect(result.output).toContain(
            "Handler checked_error may only fail with declared errors; undeclared error: UndeclaredFailure",
          )
          expect(result.output).toContain(
            "Handler checked_service requires a server service that is not allowed for this endpoint: Http — reducers may require Db, ReducerCtx, and MutationCtx",
          )
          expect(result.output).toContain(
            "Handler multi_service requires a server service that is not allowed for this endpoint: Http — reducers may require Db, ReducerCtx, and MutationCtx",
          )
          expect(result.output).toContain(
            "Handler multi_service requires a server service that is not allowed for this endpoint: TxRunner — reducers may require Db, ReducerCtx, and MutationCtx",
          )
          expect(result.output).toContain(
            `Prechecked handler checked_service requires a service that groupPrechecked cannot erase: ${serviceKeyFor(project.fixturePath)} — reducers may require Db, ReducerCtx, and MutationCtx`,
          )
          expect(result.output).toContain(
            "Handlers require external services; pass options.runtime providing them",
          )
          expect(result.output).not.toContain("StdbUniqueAlreadyExistsError")
          expect(result.output).not.toContain("effect(missingEffectError)")
          expect(result.output).not.toContain("effect(missingEffectContext)")
          expect(result.output).not.toContain("__runtimeRequired")
        }),
      ),
  )

  it.effect("reports module identity diagnostics", () =>
    withTempProject(moduleIdentityFixture, (project) =>
      assertEffect(() => {
        const source = moduleIdentityFixture(project.fixturePath)
        const result = runTsgo(project)

        expect(result.status).not.toBe(0)
        expectDiagnosticAt(result.output, project, source, "build_same_name")
        expectDiagnosticAt(result.output, project, source, "plan_same_name")
        expectDiagnosticAt(result.output, project, source, "handlers_same_name")
        expectDiagnosticAt(
          result.output,
          project,
          source,
          "build_different_name",
        )
        expectDiagnosticAt(result.output, project, source, "widened_impl")
        expectDiagnosticAt(
          result.output,
          project,
          source,
          "const CrossModuleAccessor",
        )
        expectDiagnosticAt(
          result.output,
          project,
          source,
          "annotated_brand_path",
        )
        expectDiagnosticAt(
          result.output,
          project,
          source,
          "const RawTagAccessor",
        )
        expectDiagnosticAt(
          result.output,
          project,
          source,
          "const RawReadonlyDbAccessor",
        )
        expectDiagnosticAt(
          result.output,
          project,
          source,
          "const CrossDbInsideTxRun",
        )
        expectDiagnosticAt(
          result.output,
          project,
          source,
          "mutation_withtx_path",
        )
        expectDiagnosticAt(result.output, project, source, "http_tx_path")
        expect(result.output).toContain(
          "Group impl was built for module 'module_a', not 'module_b'",
        )
        expect(result.output).toContain(
          "Group impl was built for module 'module_a', not 'module_b_different'",
        )
        expect(result.output).toContain(
          "Group impl 'Shared' has a widened module type; use the concrete return from StdbBuilder.group",
        )
        expect(result.output).toContain(
          "Handler 'get' uses module 'module_a' Db inside module 'module_b'",
        )
        expect(result.output).toContain('ModuleBrand<"module_a">')
        expect(result.output).toContain('ModuleBrand<"module_b">')
        expect(result.output).toContain(
          "Handler 'get' yields the raw Db tag; use this module's accessor (Module.Db)",
        )
        expect(result.output).toContain(
          "Handler 'list' yields the raw ReadonlyDb tag; use this module's accessor (Module.ReadonlyDb)",
        )
        expect(result.output).toContain(
          "Effect uses module 'tx_module_a' Db inside module 'tx_module_b'",
        )
        expect(result.output).toContain(
          "Effect uses module 'tx_module_a' MutationCtx inside module 'tx_module_b'",
        )
        expect(result.output).not.toContain("Group not implemented: Other")
      }),
    ),
  )

  it.effect(
    "keeps scaled keyed diagnostics within the declare-once instantiation budget",
    () =>
      withTempProject(
        () => scaleFixture(),
        (project) =>
          assertEffect(() => {
            const source = scaleFixture()
            const result = runTsgo(project, ["--extendedDiagnostics"])

            expect(result.status).not.toBe(0)
            expectDiagnosticAt(
              result.output,
              project,
              source,
              "const ScaleLive",
            )
            expect(result.output).toContain(
              "Handler endpoint11_04 may only fail with declared errors; undeclared error: UndeclaredFailure",
            )
            expect(result.output).not.toContain("StdbUniqueAlreadyExistsError")
            expect(result.output).not.toContain("effect(missingEffectError)")

            // This baseline covers the public plan shape plus ResultValuesOf
            // over the sixty-procedure result module above.
            const declareOnceBaseline = 626_472
            const maxInstantiations = Math.ceil(declareOnceBaseline * 1.1)
            expect(instantiationsFrom(result.output)).toBeLessThanOrEqual(
              maxInstantiations,
            )
          }),
      ),
  )

  it.effect(
    "keeps platform-width grouped clients within their instantiation budget",
    () =>
      Effect.gen(function* () {
        const baselineResult = yield* withTempProject(
          () => platformGroupedClientScaleFixture(false),
          (project) =>
            Effect.succeed(runTsgo(project, ["--extendedDiagnostics"])),
        )
        const groupedResult = yield* withTempProject(
          () => platformGroupedClientScaleFixture(true),
          (project) =>
            Effect.succeed(runTsgo(project, ["--extendedDiagnostics"])),
        )

        yield* assertEffect(() => {
          expect(baselineResult.status).toBe(0)
          expect(groupedResult.status).toBe(0)

          // Recorded from the genuinely flat-only form of this exact 19 × 42
          // endpoint fixture. The grouped arm selects a group namespace from
          // the full client type, which carries all nineteen group properties.
          const flatClientBaseline = 760_781
          const maxGroupedInstantiations = Math.ceil(flatClientBaseline * 1.1)
          const baselineInstantiations = instantiationsFrom(
            baselineResult.output,
          )
          const groupedInstantiations = instantiationsFrom(groupedResult.output)
          expect(baselineInstantiations).toBeLessThanOrEqual(
            maxGroupedInstantiations,
          )
          // Keep the flat fixture on the recorded absolute budget, then judge
          // grouped projection overhead against that same-run flat control.
          // This isolates group namespace cost from package-wide surface growth.
          expect(groupedInstantiations).toBeLessThanOrEqual(
            Math.ceil(baselineInstantiations * 1.1),
          )
        })
      }),
  )
})
