export {
  formatModuleDiagnostics,
  StdbDiagnostic,
  type StdbDiagnosticCode,
  type StdbDiagnosticSeverity,
  StdbValidationError,
} from "./diagnostic.ts"
export type { ServerHandlerDefinitions } from "./module-validation-common.ts"
export { httpHandlerRoutesOverlap } from "./module-validation-http-handlers.ts"
export { RESERVED_GROUP_CLIENT_KEYS } from "./module-validation-http-handlers.ts"
import {
  assertValid as assertValidModule,
  validate as validateModule,
} from "./module-validation-public.ts"
export { validateServerHandlers } from "./module-validation-public.ts"
import { moduleSpecOf, type ModuleSpecInput } from "../module-input.ts"

export const validate = <const Input extends ModuleSpecInput>(input: Input) =>
  validateModule(moduleSpecOf(input))

export const assertValid = <const Input extends ModuleSpecInput>(
  input: Input,
): void => {
  assertValidModule(moduleSpecOf(input))
}
