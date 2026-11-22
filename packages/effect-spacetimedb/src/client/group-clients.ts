import type { AnyModuleSpec } from "../contract/module.ts"

export type GroupIdsOf<Module extends AnyModuleSpec> =
  | Module["reducerGroups"][keyof Module["reducerGroups"] & string]
  | Module["procedureGroups"][keyof Module["procedureGroups"] & string]
  | Module["httpGroups"][keyof Module["httpGroups"] & string]

export type ReducerKeysInGroup<
  Module extends AnyModuleSpec,
  Group extends string,
> = {
  readonly [Key in keyof Module["reducerGroups"] &
    string]: Module["reducerGroups"][Key] extends Group ? Key : never
}[keyof Module["reducerGroups"] & string]

export type ProcedureKeysInGroup<
  Module extends AnyModuleSpec,
  Group extends string,
> = {
  readonly [Key in keyof Module["procedureGroups"] &
    string]: Module["procedureGroups"][Key] extends Group ? Key : never
}[keyof Module["procedureGroups"] & string]

export type HttpHandlerKeysInGroup<
  Module extends AnyModuleSpec,
  Group extends string,
> = {
  readonly [Key in keyof Module["httpGroups"] &
    string]: Module["httpGroups"][Key] extends Group ? Key : never
}[keyof Module["httpGroups"] & string]

/** Install enumerable group getters without projecting any callables until first access. */
export const lazyGroups = <Group>(
  ids: Iterable<string>,
  project: (id: string) => Group,
): Readonly<Record<string, Group>> => {
  const groups: Record<string, Group> = Object.create(null)
  for (const id of new Set(ids)) {
    let group: Group | undefined
    Object.defineProperty(groups, id, {
      enumerable: true,
      get: () => (group ??= project(id)),
    })
  }
  return Object.freeze(groups)
}

export const groupMembers = (
  members: object,
  memberships: Readonly<Record<string, string>>,
  id: string,
): Readonly<Record<string, unknown>> => {
  const result: Record<string, unknown> = Object.create(null)
  for (const [key, group] of Object.entries(memberships)) {
    if (group === id && Object.hasOwn(members, key))
      result[key] = Reflect.get(members, key)
  }
  return result
}
