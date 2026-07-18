import type { AnyModuleSpec } from "./contract/module.ts"

export type ModuleSpecInput = AnyModuleSpec | { readonly spec: AnyModuleSpec }

export type SpecOf<Input extends ModuleSpecInput> = Input extends {
  readonly spec: infer Spec extends AnyModuleSpec
}
  ? Spec
  : Input extends AnyModuleSpec
    ? Input
    : never

export const moduleSpecOf = <const Input extends ModuleSpecInput>(
  input: Input,
): SpecOf<Input> => ("spec" in input ? input.spec : input) as SpecOf<Input>
