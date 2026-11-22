/**
 * Loaded inside the doc samples' bundle, so it shares the package instance the
 * samples declared their contracts with.
 */
import * as Stdb from "effect-spacetimedb"

type Candidate = Readonly<Record<string, unknown>>

const isObject = (value: unknown): value is Candidate =>
  (typeof value === "object" || typeof value === "function") && value !== null

const isModule = (value: unknown): value is Stdb.AnyModule =>
  isObject(value) && "spec" in value && "addTables" in value

const isTable = (value: unknown): value is Stdb.AnyTableSpec =>
  isObject(value) &&
  "columns" in value &&
  "constraints" in value &&
  "indexes" in value

/** What a table points at, which a table declared on its own lacks. */
const unboundTableDiagnostics: ReadonlySet<string> = new Set([
  "ScheduledTableWithoutTarget",
  "OutboxWithoutResult",
])

const diagnosticsOf = (
  validate: () => ReadonlyArray<Stdb.Diagnostic>,
): ReadonlyArray<Stdb.Diagnostic> => {
  try {
    return validate()
  } catch (cause) {
    // `module.spec` validates too, and throws what `validate` would return.
    if (cause instanceof Stdb.StdbValidationDefect) {
      return cause.diagnostics
    }
    throw cause
  }
}

const render = (diagnostic: Stdb.Diagnostic): string =>
  `${diagnostic.code}: ${diagnostic.message}`

const isError = (diagnostic: Stdb.Diagnostic): boolean =>
  diagnostic.severity === "error"

type HostSchema = {
  readonly buildRawModuleDefV10: (exports: object) => unknown
}

const isHostSchema = (value: unknown): value is HostSchema =>
  isObject(value) && "buildRawModuleDefV10" in value

/** What `spacetime publish` and `generate` do with a module entry's exports. */
const hostExportProblems = (exports: Candidate): ReadonlyArray<string> => {
  const schema = exports.default
  if (!isHostSchema(schema)) {
    return []
  }
  try {
    schema.buildRawModuleDefV10(exports)
    return []
  } catch (cause) {
    return [`the host refuses this entry: ${String(cause)}`]
  }
}

/**
 * Everything `build` would refuse in what a sample declares: every module, and
 * every table on its own, whether or not it reached a module.
 */
export const contractProblems = (
  exports: Candidate,
  contextExports: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const context = new Set(contextExports)
  const authored = Object.fromEntries(
    Object.entries(exports).filter(([name]) => !context.has(name)),
  )
  return [
    ...hostExportProblems(authored),
    ...Object.entries(exports).flatMap(([name, value]) => {
      if (isModule(value)) {
        return diagnosticsOf(() => Stdb.validate(value))
          .filter(isError)
          .map((diagnostic) => `module ${name}: ${render(diagnostic)}`)
      }
      if (isTable(value)) {
        return diagnosticsOf(() =>
          Stdb.validate(Stdb.Module.make("docSample").addTables(value)),
        )
          .filter(
            (diagnostic) =>
              isError(diagnostic) &&
              !unboundTableDiagnostics.has(diagnostic.code),
          )
          .map((diagnostic) => `table ${name}: ${render(diagnostic)}`)
      }
      return []
    }),
  ]
}
