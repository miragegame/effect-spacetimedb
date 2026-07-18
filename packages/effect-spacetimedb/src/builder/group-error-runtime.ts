import {
  merge as mergeErrorDefinitions,
  tagOf,
  type AnyErrorDefinition,
} from "../contract/error.ts"
import type { HttpHandlerSpec } from "../contract/http-handler.ts"
import {
  StdbDiagnostic,
  StdbValidationError,
} from "../contract/module-validation.ts"
import type { ProcedureSpec } from "../contract/procedure.ts"
import type { ReducerSpec } from "../contract/reducer.ts"

export const mergeGroupErrorDefaults = (
  left: AnyErrorDefinition | undefined,
  right: AnyErrorDefinition | undefined,
): AnyErrorDefinition | undefined =>
  left === undefined
    ? right
    : right === undefined
      ? left
      : mergeErrorDefinitions(left, right)

export const withGroupDefaultErrors = <
  Spec extends ReducerSpec | ProcedureSpec | HttpHandlerSpec,
>(
  groupErrors: AnyErrorDefinition,
  spec: Spec,
  path: ReadonlyArray<string>,
): Spec => {
  const ownErrors = spec.errors
  const conflictingClass = ownErrors?.errors.find((ownClass) =>
    groupErrors.errors.some(
      (defaultClass) =>
        defaultClass !== ownClass && tagOf(defaultClass) === tagOf(ownClass),
    ),
  )
  if (conflictingClass !== undefined) {
    const tag = tagOf(conflictingClass)
    throw new StdbValidationError({
      diagnostics: [
        new StdbDiagnostic({
          code: "DuplicateDeclaredErrorTag",
          path: [...path, "errors", tag],
          message: `Declared error tag ${tag} is backed by different classes in the group default and endpoint declaration`,
          severity: "error",
        }),
      ],
    })
  }
  return {
    ...spec,
    errors:
      ownErrors === undefined
        ? groupErrors
        : mergeErrorDefinitions(groupErrors, ownErrors),
  } as Spec
}
