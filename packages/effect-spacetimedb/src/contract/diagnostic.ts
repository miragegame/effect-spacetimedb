import * as Data from "effect/Data"

export type DiagnosticSeverity = "error" | "warning"

export type DiagnosticCode =
  | "InvalidMountNamespace"
  | "DuplicateMountNamespace"
  | "MountNamespaceCollision"
  | "MountedEnvironment"
  | "MountedLifecycle"
  | "MountedHttpHandler"
  | "MountedReceiver"
  | "DuplicateMountedModule"
  | "MountDepthExceeded"
  | "MountCycle"
  | "MountNotImplemented"
  | "UndeclaredMountImpl"
  | "DuplicateMountImpl"
  | "DuplicateRelationName"
  | "DuplicateCallableName"
  | "DuplicateTypeName"
  | "UnknownEndpoint"
  | "UnknownGroup"
  | "EndpointNotHandled"
  | "InvalidBuilderImpl"
  | "InvalidGroupMiddleware"
  | "UndeclaredGroupImpl"
  | "UndeclaredLifecycleImpl"
  | "DuplicateGroupImpl"
  | "GroupNotImplemented"
  | "LifecycleNotImplemented"
  | "LifecycleHookMismatch"
  | "CachePolicyRequiresBTree"
  | "EventTableCachePolicy"
  | "UnknownTableCachePolicy"
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
  | "UnsupportedViewParam"
  | "DuplicateDeclaredErrorTag"
  | "ReservedDeclaredErrorTag"
  | "MissingServerHandler"
  | "InvalidHttpHandlerPath"
  | "DuplicateHttpHandlerRoute"
  | "InvalidHttpHandlerSchemaMode"
  | "HttpRouteMissingErrorStatus"
  | "InvalidGroupClientKey"
  | "InvalidScheduleTarget"
  | "UnsupportedTypeDescriptor"
  | "NonCanonicalDeclaredName"
  | "CanonicalNameCollision"
  | "LiteralTagCollision"
  | "InvalidLiteralTag"
  | "NumericLiteralPrecision"
  | "InvalidNativeColumnName"
  | "DuplicateNativeColumnName"
  | "InvalidEnvironmentKey"
  | "InvalidEnvironmentDeclaration"
  | "InvalidEnvironmentLiteral"
  | "EnvironmentDeclarationCountExceeded"
  | "EnvironmentUnionEntriesExceeded"
  | "EnvironmentSchemaBytesExceeded"
  | "InvalidRemoteInterface"
  | "RemoteInterfaceBindingMismatch"
  | "DuplicateReceiverBinding"
  | "InvalidReceiver"
  | "ReceiverNameNotPolicyInvariant"
  | "ReceiverParamReserved"
  | "ReceiverWithoutGuard"
  | "InvalidOutboxTable"
  | "OutboxRowBytesMaxOutOfRange"
  | "OutboxReceiverUnknown"
  | "OutboxReceiverBindingMissing"
  | "OutboxWithoutResult"
  | "DuplicateOutboxResult"
  | "InvalidOutboxResult"

export class Diagnostic extends Data.TaggedClass("Diagnostic")<{
  readonly code: DiagnosticCode
  readonly path: ReadonlyArray<string | number>
  readonly message: string
  readonly severity: DiagnosticSeverity
}> {}

export const formatModuleDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
): string =>
  diagnostics
    .map(
      (entry) =>
        `[${entry.code}] ${entry.path.join(".") || "<module>"}: ${entry.message}`,
    )
    .join("\n")

export class StdbValidationDefect extends Data.TaggedError(
  "StdbValidationDefect",
)<{
  readonly diagnostics: ReadonlyArray<Diagnostic>
}> {
  // An own property, as on every error that can reach the host: its uncaught
  // text reads data properties only, so a prototype getter prints no reason.
  override readonly message = formatModuleDiagnostics(this.diagnostics)
}

export const makeStdbDiagnostic = (
  code: DiagnosticCode,
  path: ReadonlyArray<string | number>,
  message: string,
  severity: DiagnosticSeverity = "error",
): Diagnostic =>
  new Diagnostic({
    code,
    path,
    message,
    severity,
  })
