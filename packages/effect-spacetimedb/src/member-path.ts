import { camelCaseName } from "./contract/canonical-name.ts"
import type { AnyModuleSpec } from "./contract/module.ts"
import type { ModuleMount, MountsOf } from "./contract/mount.ts"
import type { PlanSection, PlannedMember } from "./module-plan.ts"

export type Entries<
  M extends AnyModuleSpec,
  S extends PlanSection,
  P extends string,
> =
  | {
      [K in keyof M[S] & string]: { path: `${P}${K}`; value: M[S][K] }
    }[keyof M[S] & string]
  | MountedEntries<M, S, P>

export type MountedEntries<
  M extends AnyModuleSpec,
  S extends PlanSection,
  P extends string,
> = string extends keyof MountsOf<M>
  ? never
  : {
      [K in keyof MountsOf<M> & string]: MountsOf<M>[K] extends ModuleMount<
        infer Child
      >
        ? Entries<Child, S, `${P}${K}.`>
        : never
    }[keyof MountsOf<M> & string]

export type MembersByPath<M extends AnyModuleSpec, S extends PlanSection> = [
  keyof MountsOf<M>,
] extends [never]
  ? M[S]
  : M[S] & { readonly [E in MountedEntries<M, S, ""> as E["path"]]: E["value"] }

export const specsByPath = <M extends AnyModuleSpec, S extends PlanSection>(
  members: Readonly<Record<string, PlannedMember>>,
  section: S,
): MembersByPath<M, S> =>
  Object.fromEntries(
    Object.entries(members).map(([path, { owner, key }]) => [
      path,
      owner[section][key],
    ]),
  ) as MembersByPath<M, S>

export type Prefix<K> = K extends `${infer Head}.${string}` ? Head : never
export type Below<T, K extends string> = {
  readonly [P in keyof T as P extends `${K}.${infer Tail}` ? Tail : never]: T[P]
}
export type NestedMembers<T> = [Prefix<keyof T>] extends [never]
  ? T
  : {
      readonly [K in keyof T as K extends `${string}.${string}`
        ? never
        : K]: T[K]
    } & {
      readonly [K in Prefix<keyof T>]: NestedMembers<Below<T, K>>
    }

/** Only namespace records are frozen. A leaf can be a live SDK object. */
export const nestMembers = <T extends object>(flat: T): NestedMembers<T> => {
  // Preserve the original flat facade (including its property descriptors)
  // when there are no namespaces to construct.
  if (!Object.keys(flat).some((key) => key.includes(".")))
    return flat as NestedMembers<T>
  const root: Record<string, unknown> = Object.create(null)
  const namespaces = [root]
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split(".")
    let node = root
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(node, part)) {
        const child: Record<string, unknown> = Object.create(null)
        node[part] = child
        namespaces.push(child)
      }
      node = node[part] as Record<string, unknown>
    }
    node[parts[parts.length - 1]!] = value
  }
  for (const node of namespaces) Object.freeze(node)
  return root as NestedMembers<T>
}

export const readMember = (root: unknown, path: readonly string[]): unknown => {
  let node = root
  for (const part of path) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, part))
      return undefined
    node = Reflect.get(node, part)
  }
  return node
}

export const quotedIdentifier = (name: string): string =>
  name
    .split(".")
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join(".")

/** The native generator camel-cases each segment of the authored accessor. */
export const generatedMemberPath = (key: string): readonly string[] =>
  key.split(".").map(camelCaseName)
