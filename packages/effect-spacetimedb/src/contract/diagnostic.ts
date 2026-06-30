import * as Data from "effect/Data"

export type StdbDiagnosticSeverity = "error" | "warning"

export type StdbDiagnosticCode =
  | "DuplicateRelationName"
  | "DuplicateCallableName"
  | "UnknownEndpoint"
  | "EndpointAlreadyHandled"
  | "UnknownGroup"
  | "EndpointNotHandled"
  | "UndeclaredGroupImpl"
  | "DuplicateGroupImpl"
  | "GroupNotImplemented"
  | "EventScheduledTable"
  | "ScheduleAtColumnOnTable"
  | "ScheduledTableWithoutTarget"
  | "DuplicateScheduleTarget"
  | "InvalidScheduledTargetParams"
  | "ScheduledTableMissingScheduledIdColumn"
  | "ScheduledTableInvalidScheduledIdColumn"
  | "ScheduledTableMissingScheduleAtColumn"
  | "MultiplePrimaryKeys"
  | "EmptyColumnSelection"
  | "DuplicateSelectedColumn"
  | "MissingSelectedColumn"
  | "DirectIndexMultiColumn"
  | "UniqueConstraintMissingBackingIndex"
  | "UnsupportedViewReturn"
  | "DuplicateDeclaredErrorTag"
  | "ReservedDeclaredErrorTag"
  | "MissingServerHandler"
  | "InvalidHttpHandlerPath"
  | "DuplicateHttpHandlerRoute"
  | "InvalidHttpHandlerSchemaMode"
  | "HttpRouteMissingErrorStatus"
  | "InvalidHttpGroupClientKey"
  | "InvalidScheduleTarget"
  | "UnsupportedTypeDescriptor"
  | "NonCanonicalDeclaredName"
  | "CanonicalNameCollision"
  | "LiteralTagCollision"
  | "InvalidLiteralTag"
  | "NumericLiteralPrecision"

export class StdbDiagnostic extends Data.TaggedClass("StdbDiagnostic")<{
  readonly code: StdbDiagnosticCode
  readonly path: ReadonlyArray<string | number>
  readonly message: string
  readonly severity: StdbDiagnosticSeverity
}> {}

export const formatModuleDiagnostics = (
  diagnostics: ReadonlyArray<StdbDiagnostic>,
): string => diagnostics.map((entry) => entry.message).join("\n")

export class StdbValidationError extends Data.TaggedError(
  "StdbValidationError",
)<{
  readonly diagnostics: ReadonlyArray<StdbDiagnostic>
}> {
  override get message(): string {
    return formatModuleDiagnostics(this.diagnostics)
  }
}

export const makeStdbDiagnostic = (
  code: StdbDiagnosticCode,
  path: ReadonlyArray<string | number>,
  message: string,
  severity: StdbDiagnosticSeverity = "error",
): StdbDiagnostic =>
  new StdbDiagnostic({
    code,
    path,
    message,
    severity,
  })
