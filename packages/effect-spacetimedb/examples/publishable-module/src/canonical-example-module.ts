export {
  Example,
  ExampleModule as ExampleModuleBuilder,
} from "./module"
export { ExampleModule } from "./module-spec"
export {
  ExampleErrors,
  RotateTokenInput,
  RotateTokenOutput,
  UserMissingError,
} from "./errors"
export {
  ThingId,
  UserId,
  UserName,
} from "./schema"

export const canonicalExampleModuleEntrypoint =
  "effect-spacetimedb/example-module" as const
