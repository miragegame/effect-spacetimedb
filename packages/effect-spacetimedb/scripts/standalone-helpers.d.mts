export type ModuleProject = {
  readonly moduleRoot: string
  readonly bundlePath: string
  readonly databaseNamePrefix: string
  readonly generatedClientDir?: string
  readonly version?: string
}

export const requiredSpacetimeCliVersion: "2.6.1"
export const packageRoot: string
export const exampleModuleRoot: string
export const exampleBundlePath: string
export const exampleGeneratedClientDir: string
export const exampleModuleProject: ModuleProject
export const migrationFixtureRoot: string
export const migrationModuleProjects: {
  readonly v1: ModuleProject & {
    readonly generatedClientDir: string
    readonly version: "v1"
  }
  readonly v2: ModuleProject & {
    readonly generatedClientDir: string
    readonly version: "v2"
  }
  readonly v3: ModuleProject & {
    readonly generatedClientDir: string
    readonly version: "v3"
  }
}

export class StandaloneCommandError extends Error {
  readonly command: string
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly cause?: unknown
}

export class StandalonePackageDependencyError extends Error {}

export function parseSpacetimeCliVersion(output: string): string | undefined
export function runCommand(
  command: string,
  args?: ReadonlyArray<string>,
  options?: {
    readonly cwd?: string
    readonly env?: NodeJS.ProcessEnv
  },
): string
export function resolveSpacetimeCliCommand(): ReadonlyArray<string>
export function resolveInstallRootNodeModules(
  startDirectory: string,
  ignoredNodeModules?: string,
): string
export function ensureModuleCanResolveInstallRoot(moduleRoot: string): string
export function buildModuleWithSpacetime(project?: ModuleProject): void
export function generateModuleClientWithSpacetime(
  project: ModuleProject & { readonly generatedClientDir: string },
): void
