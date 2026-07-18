export {
  ExampleErrors,
  RotateTokenInput,
  RotateTokenOutput,
  ThingAbortError,
  UserMissingError,
} from "./errors"
export {
  Example,
  ExampleModule as ExampleModuleBuilder,
} from "./module"
export { ExampleModule } from "./module-spec"
export {
  ThingId,
  UserId,
  UserName,
} from "./schema"

export const canonicalExampleModuleEntrypoint =
  "effect-spacetimedb/example-module" as const
