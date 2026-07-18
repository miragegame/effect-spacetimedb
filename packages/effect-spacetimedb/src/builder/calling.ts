import { canonicalNameForPolicy } from "../contract/canonical-name.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyEndpointDecl } from "./declarations.ts"
import { findDecl } from "./runtime-helpers.ts"
import type { DeclNameOf, DeclOf } from "./type-utils.ts"

type GroupWithEndpoints = {
  readonly id: string
  readonly endpoints: ReadonlyArray<AnyEndpointDecl>
}

type CallableKeyOf<Module extends AnyModuleSpec> =
  | (keyof Module["reducers"] & string)
  | (keyof Module["procedures"] & string)
  | (keyof Module["httpHandlers"] & string)

export const declOf = <
  Group extends GroupWithEndpoints,
  const Name extends DeclNameOf<Group>,
>(
  group: Group,
  name: Name,
): DeclOf<Group, Name> =>
  findDecl(group.id, group.endpoints, name) as DeclOf<Group, Name>

export const wireNameOf = <
  Module extends AnyModuleSpec,
  const Key extends CallableKeyOf<Module>,
>(
  module: Module,
  key: Key,
): string => module.wireNames.functions[key] ?? key

export const wireNameForDecl = (
  decl: Pick<AnyEndpointDecl, "name">,
  policy?: "none" | "snake_case",
): string => canonicalNameForPolicy(policy, decl.name)
