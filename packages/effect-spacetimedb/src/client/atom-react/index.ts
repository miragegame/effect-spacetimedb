import * as AtomReact from "@effect/atom-react"
import type * as Atom from "effect/unstable/reactivity/Atom"

export const useTable = <A>(
  family: (key: string) => Atom.Atom<A>,
  key: string,
) => AtomReact.useAtomValue(family(key))

export const useRow = <A>(
  family: (key: string, primaryKey: unknown) => Atom.Atom<A>,
  key: string,
  primaryKey: unknown,
) => AtomReact.useAtomValue(family(key, primaryKey))

export const useTableGroup = <A>(
  family: (keys: ReadonlyArray<string>) => Atom.Atom<A>,
  keys: ReadonlyArray<string>,
) => AtomReact.useAtomValue(family(keys))
